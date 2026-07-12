import type { AdapterRecord, DiscoveredSource, IngestCursor, RuntimeKind } from "../../adapters/types.ts";
import { upsertCursor } from "../db/cursorRepository.ts";
import { indexCanonicalSessionSearch } from "../db/searchRepository.ts";
import { getImportWorkUnit, recordImportFailureGroup, updateImportWorkUnit } from "../db/importLedgerRepository.ts";
import { listImportImpactSessionIds, recordImportSessionImpact } from "../db/importSessionImpactRepository.ts";
import { ingestAdapterRecord } from "../db/sessionRepository.ts";
import { sourceRecordIsExcluded } from "../db/sourceRepository.ts";
import { sourcePolicyExplicitlyEnabled } from "../db/sourcePolicyRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../db/sqlite.ts";

const CHECKPOINT_RECORD_INTERVAL = 250;

export type ImportWorkUnitCheckpoint = {
  cursorAfter?: Omit<IngestCursor, "cursorId">;
  failed: number;
  imported: number;
  processed: number;
};

export async function runImportWorkUnit(input: {
  db: MastheadDatabase;
  workUnitId: string;
  runtimeKind: RuntimeKind;
  hostId: string;
  hostname?: string;
  now?: () => string;
  adapterBackfill: (source: DiscoveredSource) => AsyncIterable<AdapterRecord>;
  approvedSourceIds?: string[];
  indexSession?: (sessionId: string) => void;
  onSessionImported?: (sessionId: string) => void;
  onSessionHydrated?: (sessionId: string) => void;
  onCheckpoint?: (checkpoint: ImportWorkUnitCheckpoint) => void;
}): Promise<{ imported: number; failed: number; processed: number; sessionIds: string[] }> {
  const now = input.now ?? (() => new Date().toISOString());
  const unit = getImportWorkUnit(input.db, input.workUnitId);
  if (!unit) throw new Error(`Import work unit not found: ${input.workUnitId}`);
  if (unit.status === "skipped" || unit.status === "cancelled") return { failed: 0, imported: 0, processed: 0, sessionIds: [] };
  const sourceAllowed = sourcePolicyExplicitlyEnabled(input.db, "transcript_import", unit.sourceId) ||
    Boolean(input.approvedSourceIds?.some((sourceId) => sourcePolicyExplicitlyEnabled(input.db, "transcript_import", sourceId)));
  if (unit.unitKind === "transcript_file" && !sourceAllowed) {
    const observedAt = now();
    const failureGroup = recordImportFailureGroup(input.db, {
      code: "transcript_permission_required",
      failureKind: "unreadable",
      importJobId: unit.importJobId,
      manifestId: unit.manifestId,
      message: "Transcript import requires explicit source-scoped permission.",
      observedAt,
      retryable: false,
      runtime: unit.runtime,
      samplePath: unit.sourcePath
    });
    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: 1,
      failureGroupId: failureGroup.failureGroupId,
      finishedAt: observedAt,
      heartbeatAt: observedAt,
      processedRecords: 0,
      status: "failed",
      statusReason: "transcript_permission_required"
    });
    return { failed: 1, imported: 0, processed: 0, sessionIds: [] };
  }

  updateImportWorkUnit(input.db, unit.workUnitId, {
    heartbeatAt: now(),
    startedAt: unit.startedAt ?? now(),
    status: "running"
  });

  let processed = unit.processedRecords;
  let imported = unit.importedRecords;
  let failed = unit.failedRecords;
  let recordsSinceYield = 0;
  let recordsSinceCheckpoint = 0;
  let latestCursorAfter = cursorValue(unit.cursorAfter);
  const sessionIds = new Set<string>();
  const pendingImpacts = new Map<string, { impactKind: "enriched" | "transcript_added" | "created" | "updated"; recordCount: number; sessionId: string }>();
  const pendingFailures = new Map<string, {
    code: string;
    count: number;
    failureKind: ReturnType<typeof failureKindForDiagnostic>;
    message: string;
    observedAt: string;
    retryable: boolean;
  }>();
  const source: DiscoveredSource = {
    confidence: unit.confidence,
    path: unit.sourcePath,
    runtime: unit.runtime,
    schemaVersion: unit.schemaVersion,
    sourceId: unit.sourceId,
    sourceKind: unit.sourceKind
  };

  const flushCheckpoint = async (force = false): Promise<void> => {
    if (recordsSinceCheckpoint === 0 || (!force && recordsSinceCheckpoint < CHECKPOINT_RECORD_INTERVAL)) return;
    const heartbeatAt = now();
    withImmediateTransaction(input.db, () => {
      let failureGroupId: string | undefined;
      for (const failure of pendingFailures.values()) {
        const group = recordImportFailureGroup(input.db, {
          ...failure,
          importJobId: unit.importJobId,
          manifestId: unit.manifestId,
          runtime: unit.runtime,
          samplePath: unit.sourcePath
        });
        failureGroupId = group.failureGroupId;
      }
      updateImportWorkUnit(input.db, unit.workUnitId, {
        cursorAfter: latestCursorAfter,
        failedRecords: failed,
        failureGroupId,
        heartbeatAt,
        importedRecords: imported,
        processedRecords: processed,
        status: "running"
      });
      if (latestCursorAfter) upsertCursor(input.db, latestCursorAfter);
      for (const impact of pendingImpacts.values()) {
        recordImportSessionImpact(input.db, {
          importJobId: unit.importJobId,
          impactKind: impact.impactKind,
          observedAt: heartbeatAt,
          recordCount: impact.recordCount,
          runtime: unit.runtime,
          sessionId: impact.sessionId,
          sourceId: unit.sourceId
        });
      }
    });
    pendingImpacts.clear();
    pendingFailures.clear();
    recordsSinceCheckpoint = 0;
    input.onCheckpoint?.({ cursorAfter: latestCursorAfter, failed, imported, processed });
    recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
  };

  try {
    for await (const record of input.adapterBackfill(source)) {
      processed += 1;
      recordsSinceYield += 1;
      recordsSinceCheckpoint += 1;
      latestCursorAfter = record.cursorAfter ?? latestCursorAfter;
      if (record.diagnostics.length > 0) {
        failed += 1;
        const diagnostic = record.diagnostics[0];
        const failureKind = failureKindForDiagnostic(diagnostic.code);
        const failureKey = `${failureKind}\0${diagnostic.code}\0${diagnostic.message}`;
        const pending = pendingFailures.get(failureKey);
        pendingFailures.set(failureKey, {
          code: diagnostic.code,
          count: (pending?.count ?? 0) + 1,
          failureKind,
          message: diagnostic.message,
          observedAt: diagnostic.observedAt || now(),
          retryable: diagnostic.code.includes("locked") || diagnostic.code.includes("busy")
        });
        await flushCheckpoint();
        recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
        continue;
      }

      if (sourceRecordIsExcluded(input.db, record)) {
        await flushCheckpoint();
        recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
        continue;
      }

      const result = ingestAdapterRecord(input.db, record, {
        hostId: input.hostId,
        hostname: input.hostname,
        runtimeKind: input.runtimeKind
      });
      if (result.sessionId) {
        imported += 1;
        sessionIds.add(result.sessionId);
        const impactKind = unit.unitKind === "enrichment_session"
          ? "enriched"
          : unit.unitKind === "transcript_file"
            ? "transcript_added"
            : result.created
              ? "created"
              : "updated";
        const impactKey = `${result.sessionId}\0${impactKind}`;
        const pending = pendingImpacts.get(impactKey);
        pendingImpacts.set(impactKey, { impactKind, recordCount: (pending?.recordCount ?? 0) + 1, sessionId: result.sessionId });
        if (result.recordInserted) input.onSessionImported?.(result.sessionId);
      }
      await flushCheckpoint();
      recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
    }
    await flushCheckpoint(true);
    for (const sessionId of listImportImpactSessionIds(input.db, unit.importJobId, unit.sourceId)) sessionIds.add(sessionId);
    for (const sessionId of sessionIds) {
      if (input.indexSession) {
        input.indexSession(sessionId);
      } else {
        indexCanonicalSessionSearch(input.db, sessionId);
      }
      input.onSessionHydrated?.(sessionId);
    }

    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: failed,
      finishedAt: now(),
      heartbeatAt: now(),
      importedRecords: imported,
      processedRecords: processed,
      status: failed > 0 ? (imported > 0 ? "succeeded_with_issues" : "failed") : "succeeded"
    });
    return { failed, imported, processed, sessionIds: [...sessionIds] };
  } catch (error) {
    await flushCheckpoint(true);
    const failureGroup = recordImportFailureGroup(input.db, {
      code: error instanceof Error ? error.name : "unknown_error",
      failureKind: "unknown",
      importJobId: unit.importJobId,
      manifestId: unit.manifestId,
      message: error instanceof Error ? error.message : String(error),
      observedAt: now(),
      retryable: true,
      runtime: unit.runtime,
      samplePath: unit.sourcePath
    });
    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: Math.max(1, failed),
      failureGroupId: failureGroup.failureGroupId,
      finishedAt: now(),
      heartbeatAt: now(),
      processedRecords: processed,
      status: "failed",
      statusReason: error instanceof Error ? error.message : String(error)
    });
    return { failed: Math.max(1, failed), imported, processed, sessionIds: [...sessionIds] };
  }
}

async function yieldToRequestHandling(recordsSinceYield: number): Promise<number> {
  if (recordsSinceYield < 25) return recordsSinceYield;
  await new Promise<void>((resolve) => setImmediate(resolve));
  return 0;
}

function cursorValue(value: unknown): Omit<IngestCursor, "cursorId"> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<IngestCursor>;
  if (typeof candidate.byteOffset !== "number" || typeof candidate.sourceId !== "string") return undefined;
  return {
    byteOffset: candidate.byteOffset,
    contentFingerprint: candidate.contentFingerprint,
    cwd: candidate.cwd,
    model: candidate.model,
    modifiedAt: candidate.modifiedAt,
    sourceId: candidate.sourceId,
    sourcePath: candidate.sourcePath,
    sourceSessionId: candidate.sourceSessionId
  };
}

function failureKindForDiagnostic(code: string): "unreadable" | "locked" | "malformed" | "schema_drift" | "normalization" | "unknown" {
  if (code.includes("permission") || code.includes("missing") || code.includes("unreadable")) return "unreadable";
  if (code.includes("locked") || code.includes("busy")) return "locked";
  if (code.includes("malformed") || code.includes("json")) return "malformed";
  if (code.includes("schema")) return "schema_drift";
  if (code.includes("normalization")) return "normalization";
  return "unknown";
}
