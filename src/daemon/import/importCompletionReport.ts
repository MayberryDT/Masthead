import type { RuntimeKind } from "../../adapters/types.ts";
import type { ImportCompletionReportDto, ImportVisibilityState } from "../../shared/sourceImport.ts";
import { summarizeImportSessionImpacts } from "../db/importSessionImpactRepository.ts";
import { summarizeSessionImportHealth } from "../db/sessionImportHealthRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export function buildImportCompletionReport(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    runtime: RuntimeKind;
    status: ImportVisibilityState;
    generatedAt: string;
    recordsImported: number;
    recordsSkipped: number;
    recordsFailed: number;
    transcriptsImported: number;
    failedUnits: number;
    skippedUnits: number;
    sourceUnitsDiscovered?: number;
    sourceUnitsHydrated?: number;
    sourceUnitsRemaining?: number;
  }
): ImportCompletionReportDto {
  const impact = summarizeImportSessionImpacts(db, input.importJobId);
  const runtimeSessionStats = countRuntimeSessions(db, input.runtime);
  const logbookSearchable = countLogbookSearchableSessions(db, input.runtime);
  const transcriptReady = countTranscriptReadySessions(db, input.runtime);
  const enriched = countEnrichedSessions(db, input.runtime);
  const mcpVisible = countMcpVisibleSessions(db, input.runtime);
  const nextActions: ImportCompletionReportDto["nextActions"] = [];
  if (input.failedUnits > 0) nextActions.push("retry_failed_units");
  if (input.status === "succeeded" || input.status === "succeeded_with_issues") {
    nextActions.push("open_logbook", "import_full_archive");
  }
  if (enriched < runtimeSessionStats) nextActions.push("run_enrichment");
  const sourceUnitsDeferred = input.skippedUnits;
  const sourceUnitsFailed = input.failedUnits;
  const sourceUnitsRemaining = input.sourceUnitsRemaining ?? 0;
  const sourceUnitsHydrated = input.sourceUnitsHydrated ?? Math.max(
    0,
    (input.sourceUnitsDiscovered ?? 0) - sourceUnitsDeferred - sourceUnitsFailed - sourceUnitsRemaining
  );
  const sourceUnitsDiscovered = input.sourceUnitsDiscovered ??
    sourceUnitsHydrated + sourceUnitsDeferred + sourceUnitsFailed + sourceUnitsRemaining;
  if (sourceUnitsDiscovered !== sourceUnitsHydrated + sourceUnitsDeferred + sourceUnitsFailed + sourceUnitsRemaining) {
    throw new Error("Import reconciliation invariant failed: discovered units are not fully accounted for.");
  }

  return {
    dossierReadySessions: transcriptReady,
    enrichedSessions: enriched,
    failedUnits: input.failedUnits,
    generatedAt: input.generatedAt,
    importJobId: input.importJobId,
    importHealth: summarizeSessionImportHealth(db, input.importJobId),
    logbookSearchableSessions: logbookSearchable,
    mcpVisibleSessions: mcpVisible,
    nextActions: [...new Set(nextActions)],
    recordsFailed: input.recordsFailed,
    recordsImported: input.recordsImported,
    recordsSkipped: input.recordsSkipped,
    runtime: input.runtime,
    sessionsCreated: impact.sessionsCreated,
    sessionsDiscovered: impact.sessionsAffected,
    sessionsHydrated: impact.transcriptSessions,
    sessionsUpdated: impact.sessionsUpdated,
    skippedUnits: input.skippedUnits,
    sourceUnitsDeferred,
    sourceUnitsDiscovered,
    sourceUnitsFailed,
    sourceUnitsHydrated,
    sourceUnitsRemaining,
    status: input.status,
    transcriptsImported: impact.transcriptSessions
  };
}

function countRuntimeSessions(db: MastheadDatabase, runtime: RuntimeKind): number {
  return count(
    db,
    `SELECT COUNT(*) AS count
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    WHERE runtimes.runtime_kind = ?
      AND sessions.deleted_at IS NULL`,
    runtime
  );
}

function countLogbookSearchableSessions(db: MastheadDatabase, runtime: RuntimeKind): number {
  return count(
    db,
    `SELECT COUNT(*) AS count
    FROM session_search
    JOIN sessions ON sessions.session_id = session_search.session_id
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    WHERE runtimes.runtime_kind = ?
      AND sessions.deleted_at IS NULL`,
    runtime
  );
}

function countTranscriptReadySessions(db: MastheadDatabase, runtime: RuntimeKind): number {
  return count(
    db,
    `SELECT COUNT(DISTINCT sessions.session_id) AS count
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    JOIN messages ON messages.session_id = sessions.session_id
    WHERE runtimes.runtime_kind = ?
      AND sessions.deleted_at IS NULL`,
    runtime
  );
}

function countEnrichedSessions(db: MastheadDatabase, runtime: RuntimeKind): number {
  return count(
    db,
    `SELECT COUNT(DISTINCT sessions.session_id) AS count
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    JOIN session_enrichments ON session_enrichments.session_id = sessions.session_id
    WHERE runtimes.runtime_kind = ?
      AND sessions.deleted_at IS NULL
      AND session_enrichments.status = 'current'`,
    runtime
  );
}

function countMcpVisibleSessions(db: MastheadDatabase, runtime: RuntimeKind): number {
  return count(
    db,
    `SELECT COUNT(*) AS count
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    WHERE runtimes.runtime_kind = ?
      AND sessions.deleted_at IS NULL
      AND sessions.excluded_from_mcp_at IS NULL`,
    runtime
  );
}

function count(db: MastheadDatabase, sql: string, runtime: RuntimeKind): number {
  const row = db.prepare(sql).get(runtime) as { count: number } | undefined;
  return row?.count ?? 0;
}
