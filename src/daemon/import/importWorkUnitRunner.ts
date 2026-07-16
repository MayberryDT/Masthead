import { createHash } from "node:crypto";
import type { AdapterRecord, DiscoveredSource, IngestCursor, RuntimeKind } from "../../adapters/types.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../../adapters/transcriptUnits.ts";
import { upsertCursor } from "../db/cursorRepository.ts";
import { indexCanonicalSessionSearch } from "../db/searchRepository.ts";
import { getImportWorkUnit, recordImportFailureGroup, updateImportWorkUnit } from "../db/importLedgerRepository.ts";
import { recordImportSessionImpact } from "../db/importSessionImpactRepository.ts";
import { ingestAdapterRecord } from "../db/sessionRepository.ts";
import { recordSessionImportHealth, sessionImportRequiresRepair } from "../db/sessionImportHealthRepository.ts";
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
  adapterBackfill?: (source: DiscoveredSource) => AsyncIterable<AdapterRecord>;
  parseTranscriptUnit?: (unit: TranscriptUnitPlan, cursor?: IngestCursor) => Promise<ParsedTranscriptUnit>;
  approvedSourceIds?: string[];
  indexSession?: (sessionId: string) => void;
  onSessionImported?: (sessionId: string) => void;
  onSessionHydrated?: (sessionId: string, options: { holdForRepair: boolean }) => void;
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
  let latestCursorAfter = cursorValue(unit.cursorAfter ?? unit.cursorBefore);
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
  const transcriptUnit: TranscriptUnitPlan = {
    fileSizeBytes: unit.fileSizeBytes,
    modifiedAt: unit.modifiedAt,
    runtime: unit.runtime,
    semanticActivityAt: unit.semanticActivityAt,
    source,
    sourceSessionId: unit.sourceSessionId,
    timestampBasis: unit.timestampBasis,
    unitId: unit.workUnitId
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
    const parsedUnit = input.parseTranscriptUnit
      ? await input.parseTranscriptUnit(transcriptUnit, latestCursorAfter ? { cursorId: "", ...latestCursorAfter } : undefined)
      : undefined;
    const records = parsedUnit
      ? recordsFromParsedUnit(parsedUnit)
      : input.adapterBackfill?.(source);
    if (!records) throw new Error("Import work unit runner requires a transcript parser or adapter backfill.");
    for await (const record of records) {
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
        const impactKinds = unit.unitKind === "enrichment_session"
          ? ["enriched" as const]
          : unit.unitKind === "transcript_file"
            ? ["transcript_added" as const, ...(result.created ? ["created" as const] : [])]
            : [result.created ? "created" as const : "updated" as const];
        for (const impactKind of impactKinds) {
          const impactKey = `${result.sessionId}\0${impactKind}`;
          const pending = pendingImpacts.get(impactKey);
          pendingImpacts.set(impactKey, {
            impactKind,
            recordCount: (pending?.recordCount ?? 0) + 1,
            sessionId: result.sessionId
          });
        }
        if (result.recordInserted) input.onSessionImported?.(result.sessionId);
      }
      await flushCheckpoint();
      recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
    }
    await flushCheckpoint(true);
    const healthSessionId = parsedUnit
      ? sessionIdForParsedUnit(input.db, parsedUnit, unit.runtime, input.hostId, sessionIds)
      : undefined;
    const health = unit.unitKind === "transcript_file" && parsedUnit
      ? recordHealthForParsedUnit(input.db, parsedUnit, healthSessionId, unit, now())
      : undefined;
    for (const sessionId of sessionIds) {
      if (input.indexSession) {
        input.indexSession(sessionId);
      } else {
        indexCanonicalSessionSearch(input.db, sessionId);
      }
      const holdForRepair = health?.status === "repair_required" ||
        sessionImportRequiresRepair(input.db, unit.importJobId, sessionId);
      input.onSessionHydrated?.(sessionId, { holdForRepair });
    }

    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: failed,
      finishedAt: now(),
      heartbeatAt: now(),
      importedRecords: imported,
      processedRecords: processed,
      status: health?.status === "repair_required"
        ? "succeeded_with_issues"
        : failed > 0
          ? (imported > 0 ? "succeeded_with_issues" : "failed")
          : "succeeded"
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

async function* recordsFromParsedUnit(unit: ParsedTranscriptUnit): AsyncIterable<AdapterRecord> {
  yield* unit.records;
}

function recordHealthForParsedUnit(
  db: MastheadDatabase,
  parsedUnit: ParsedTranscriptUnit,
  sessionId: string | undefined,
  unit: NonNullable<ReturnType<typeof getImportWorkUnit>>,
  updatedAt: string
) {
  const incrementalNoop = Boolean(unit.cursorAfter ?? unit.cursorBefore) &&
    parsedUnit.completeness === "complete" &&
    parsedUnit.records.length === 0 &&
    parsedUnit.diagnostics.length === 0;
  const reason = incrementalNoop ? undefined : importHealthReason(parsedUnit);
  return recordSessionImportHealth(db, {
    diagnostics: parsedUnit.diagnostics.map(({ code, message, severity }) => ({ code, message, severity })),
    evidenceRevision: importEvidenceRevision(parsedUnit),
    importJobId: unit.importJobId,
    ...(reason ? { reason } : {}),
    ...(sessionId ? { sessionId } : {}),
    status: reason ? "repair_required" : "complete",
    updatedAt,
    workUnitId: unit.workUnitId
  });
}

function importHealthReason(unit: ParsedTranscriptUnit): string | undefined {
  if (unit.sourceSessionIds.length === 0) return "missing_identity";
  if (unit.sourceSessionIds.length > 1) return "ambiguous_identity";
  if (unit.completeness === "partial") return "partial_parse";
  if (unit.completeness === "unrecognized") return "unrecognized_schema";
  return undefined;
}

function sessionIdForParsedUnit(
  db: MastheadDatabase,
  unit: ParsedTranscriptUnit,
  runtime: RuntimeKind,
  hostId: string,
  affectedSessionIds: Set<string>
): string | undefined {
  if (unit.sourceSessionIds.length !== 1) return undefined;
  const rows = db.prepare(
    `SELECT sessions.session_id AS sessionId
     FROM sessions
     JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
     WHERE sessions.source_session_id = ?
       AND runtimes.runtime_kind = ?
       AND sessions.host_id = ?
       AND sessions.deleted_at IS NULL`
  ).all(unit.sourceSessionIds[0], runtime, hostId) as Array<{ sessionId: string }>;
  for (const row of rows) affectedSessionIds.add(row.sessionId);
  return rows.length === 1 ? rows[0].sessionId : undefined;
}

function importEvidenceRevision(unit: ParsedTranscriptUnit): string {
  const evidence = JSON.stringify({
    completeness: unit.completeness,
    diagnostics: unit.diagnostics.map(({ code, message, severity }) => ({ code, message, severity })),
    records: unit.records.map((record) => record.payloadHash),
    sourceSessionIds: unit.sourceSessionIds,
    unitId: unit.unit.unitId
  });
  return `sha256:${createHash("sha256").update(evidence).digest("hex")}`;
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
