import type { AdapterRecord, DiscoveredSource, RuntimeKind } from "../../adapters/types.ts";
import { indexCanonicalSessionSearch } from "../db/searchRepository.ts";
import { getImportWorkUnit, recordImportFailureGroup, updateImportWorkUnit } from "../db/importLedgerRepository.ts";
import { recordImportSessionImpact } from "../db/importSessionImpactRepository.ts";
import { ingestAdapterRecord } from "../db/sessionRepository.ts";
import { sourceRecordIsExcluded } from "../db/sourceRepository.ts";
import { sourcePolicyExplicitlyEnabled } from "../db/sourcePolicyRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

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

  let processed = 0;
  let imported = 0;
  let failed = 0;
  let recordsSinceYield = 0;
  const sessionIds = new Set<string>();
  const source: DiscoveredSource = {
    confidence: unit.confidence,
    path: unit.sourcePath,
    runtime: unit.runtime,
    schemaVersion: unit.schemaVersion,
    sourceId: unit.sourceId,
    sourceKind: unit.sourceKind
  };

  try {
    for await (const record of input.adapterBackfill(source)) {
      processed += 1;
      recordsSinceYield += 1;
      if (record.diagnostics.length > 0) {
        failed += 1;
        const diagnostic = record.diagnostics[0];
        const failureGroup = recordImportFailureGroup(input.db, {
          code: diagnostic.code,
          failureKind: failureKindForDiagnostic(diagnostic.code),
          importJobId: unit.importJobId,
          manifestId: unit.manifestId,
          message: diagnostic.message,
          observedAt: diagnostic.observedAt || now(),
          retryable: diagnostic.code.includes("locked") || diagnostic.code.includes("busy"),
          runtime: unit.runtime,
          samplePath: unit.sourcePath
        });
        updateImportWorkUnit(input.db, unit.workUnitId, {
          failedRecords: failed,
          failureGroupId: failureGroup.failureGroupId,
          heartbeatAt: now(),
          processedRecords: processed,
          status: "running"
        });
        recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
        continue;
      }

      if (sourceRecordIsExcluded(input.db, record)) {
        updateImportWorkUnit(input.db, unit.workUnitId, {
          heartbeatAt: now(),
          processedRecords: processed,
          status: "running"
        });
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
        recordImportSessionImpact(input.db, {
          importJobId: unit.importJobId,
          impactKind: unit.unitKind === "enrichment_session"
            ? "enriched"
            : unit.unitKind === "transcript_file"
              ? "transcript_added"
              : result.created
                ? "created"
                : "updated",
          observedAt: now(),
          recordCount: 1,
          runtime: unit.runtime,
          sessionId: result.sessionId,
          sourceId: unit.sourceId
        });
        input.onSessionImported?.(result.sessionId);
      }
      updateImportWorkUnit(input.db, unit.workUnitId, {
        heartbeatAt: now(),
        importedRecords: imported,
        processedRecords: processed,
        status: "running"
      });
      recordsSinceYield = await yieldToRequestHandling(recordsSinceYield);
    }
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

function failureKindForDiagnostic(code: string): "unreadable" | "locked" | "malformed" | "schema_drift" | "normalization" | "unknown" {
  if (code.includes("permission") || code.includes("missing") || code.includes("unreadable")) return "unreadable";
  if (code.includes("locked") || code.includes("busy")) return "locked";
  if (code.includes("malformed") || code.includes("json")) return "malformed";
  if (code.includes("schema")) return "schema_drift";
  if (code.includes("normalization")) return "normalization";
  return "unknown";
}
