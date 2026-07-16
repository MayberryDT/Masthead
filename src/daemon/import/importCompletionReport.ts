import type { RuntimeKind } from "../../adapters/types.ts";
import type {
  ImportAnomaly,
  ImportCompletionReportDto,
  ImportTimestampBasis,
  ImportVisibilityState
} from "../../shared/sourceImport.ts";
import { getImportManifestSummary, listAllImportWorkUnits } from "../db/importLedgerRepository.ts";
import { listImportImpactSessionIds, summarizeImportSessionImpacts } from "../db/importSessionImpactRepository.ts";
import {
  countRepairRequiredSessions,
  sessionImportRequiresRepair,
  summarizeSessionImportHealth
} from "../db/sessionImportHealthRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { reconcileImportedTranscript } from "../../workbench/transcriptQualityReconciler.ts";
import { detectImportAnomalies } from "./importAnomalyDetector.ts";

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
  const importHealth = summarizeSessionImportHealth(db, input.importJobId);
  const evidence = summarizeImportEvidence(db, input.importJobId, input.generatedAt, {
    recordsProcessed: input.recordsImported + input.recordsFailed,
    recordsRejected: input.recordsFailed
  });
  const anomalies = detectImportAnomalies({
    epochTimestampSessions: evidence.epochTimestampSessions,
    oneMessageSessions: evidence.oneMessageSessions,
    outOfRangeSessions: evidence.outOfRangeSessions,
    recordsRecognized: evidence.recordsRecognized,
    recordsRejected: evidence.recordsRejected,
    sessionsFinalized: impact.sessionsAffected,
    sessionsWithUserOrAssistant: evidence.sessionsWithUserOrAssistant,
    structuredToolItems: evidence.structuredToolItems,
    toolRoleMessages: evidence.toolRoleMessages
  });
  const hasErrorAnomaly = anomalies.some((anomaly) => anomaly.severity === "error");
  const status = input.status === "succeeded" && (importHealth.repairRequired > 0 || hasErrorAnomaly)
    ? "succeeded_with_issues"
    : input.status;
  const nextActions: ImportCompletionReportDto["nextActions"] = [];
  if (input.failedUnits > 0) nextActions.push("retry_failed_units");
  if (hasErrorAnomaly) nextActions.push("repair_import");
  if (status === "succeeded" || status === "succeeded_with_issues") {
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
    anomalies,
    cappedUnits: evidence.cappedUnits,
    dossierReadySessions: transcriptReady,
    enrichedSessions: enriched,
    failedUnits: input.failedUnits,
    generatedAt: input.generatedAt,
    importJobId: input.importJobId,
    importHealth,
    logbookSearchableSessions: logbookSearchable,
    mcpVisibleSessions: mcpVisible,
    nextActions: [...new Set(nextActions)],
    outOfRangeSessions: evidence.outOfRangeSessions,
    recordsFailed: input.recordsFailed,
    recordsImported: input.recordsImported,
    recordsRecognized: evidence.recordsRecognized,
    recordsRejected: evidence.recordsRejected,
    recordsSkipped: input.recordsSkipped,
    runtime: input.runtime,
    sessionsCreated: impact.sessionsCreated,
    sessionsDiscovered: impact.sessionsAffected,
    sessionsFinalized: impact.sessionsAffected,
    sessionsHydrated: impact.transcriptSessions,
    sessionsUpdated: impact.sessionsUpdated,
    sessionsOnPackagePath: evidence.sessionsOnPackagePath,
    sessionsRepairRequired: countRepairRequiredSessions(db, input.importJobId),
    sessionsSuppressed: evidence.sessionsSuppressed,
    skippedUnits: input.skippedUnits,
    sourceUnitsDeferred,
    sourceUnitsDiscovered,
    sourceUnitsFailed,
    sourceUnitsHydrated,
    sourceUnitsRemaining,
    status,
    timestampBasis: evidence.timestampBasis,
    transcriptsImported: impact.transcriptSessions
  };
}

export function settleImportSessionClassifications(
  db: MastheadDatabase,
  input: {
    anomalies: ImportAnomaly[];
    finalizeNoise: boolean;
    importJobId: string;
  }
): void {
  const holdForRepair = input.anomalies.some((anomaly) => anomaly.severity === "error");
  if (!holdForRepair && !input.finalizeNoise) return;
  for (const sessionId of listImportImpactSessionIds(db, input.importJobId)) {
    const sessionHoldForRepair = holdForRepair || sessionImportRequiresRepair(db, input.importJobId, sessionId);
    reconcileImportedTranscript(db, sessionId, {
      finalizeNoise: input.finalizeNoise && !sessionHoldForRepair,
      holdForRepair: sessionHoldForRepair
    });
  }
}

function summarizeImportEvidence(
  db: MastheadDatabase,
  importJobId: string,
  generatedAt: string,
  fallbackRecords: { recordsProcessed: number; recordsRejected: number }
): {
  cappedUnits: number;
  epochTimestampSessions: number;
  oneMessageSessions: number;
  outOfRangeSessions: number;
  recordsRecognized: number;
  recordsRejected: number;
  sessionsOnPackagePath: number;
  sessionsSuppressed: number;
  sessionsWithUserOrAssistant: number;
  structuredToolItems: number;
  timestampBasis: Record<ImportTimestampBasis, number>;
  toolRoleMessages: number;
} {
  const units = listAllImportWorkUnits(db, { importJobId });
  const manifest = units[0] ? getImportManifestSummary(db, units[0].manifestId) : undefined;
  const recordsProcessed = units.length > 0
    ? units.reduce((total, unit) => total + unit.processedRecords, 0)
    : fallbackRecords.recordsProcessed;
  const recordsRejected = units.length > 0
    ? units.reduce((total, unit) => total + Math.min(unit.processedRecords, unit.failedRecords), 0)
    : fallbackRecords.recordsRejected;
  const timestampBasis: Record<ImportTimestampBasis, number> = {
    file_modified: 0,
    semantic: 0,
    source_path: 0,
    unknown: 0
  };
  for (const unit of units) timestampBasis[unit.timestampBasis] += 1;
  const sessions = db.prepare(
    `SELECT sessions.session_id AS sessionId,
      sessions.last_activity_at AS lastActivityAt,
      impacts.was_created AS wasCreated,
      COUNT(messages.message_id) AS messageCount,
      SUM(CASE WHEN messages.role IN ('user', 'assistant') THEN 1 ELSE 0 END) AS conversationMessages,
      SUM(CASE WHEN messages.role = 'tool' THEN 1 ELSE 0 END) AS toolRoleMessages,
      (SELECT COUNT(*) FROM tool_calls WHERE tool_calls.session_id = sessions.session_id) +
        (SELECT COUNT(*) FROM tool_results WHERE tool_results.session_id = sessions.session_id) AS structuredToolItems,
      workbench_session_state.publication_status AS publicationStatus,
      workbench_session_state.quality_decision_source AS qualityDecisionSource,
      workbench_session_state.suppression_category AS suppressionCategory
    FROM (
      SELECT session_id, MAX(CASE WHEN impact_kind = 'created' THEN 1 ELSE 0 END) AS was_created
      FROM import_session_impacts
      WHERE import_job_id = ?
      GROUP BY session_id
    ) AS impacts
    JOIN sessions ON sessions.session_id = impacts.session_id
    LEFT JOIN messages ON messages.session_id = sessions.session_id
    LEFT JOIN workbench_session_state ON workbench_session_state.session_id = sessions.session_id
    GROUP BY sessions.session_id`
  ).all(importJobId) as Array<{
    conversationMessages: number;
    lastActivityAt: string;
    messageCount: number;
    publicationStatus: string | null;
    qualityDecisionSource: string | null;
    sessionId: string;
    structuredToolItems: number;
    suppressionCategory: string | null;
    toolRoleMessages: number;
    wasCreated: number;
  }>;
  const scopeStart = manifest?.scope.mode === "transcript_recent" && manifest.scope.days !== undefined
    ? new Date(generatedAt).getTime() - manifest.scope.days * 24 * 60 * 60 * 1_000
    : undefined;
  return {
    cappedUnits: manifest?.cappedUnits ?? units.filter((unit) => unit.scopeReason === "deferred_by_unit_limit").length,
    epochTimestampSessions: sessions.filter((session) => isUnixEpoch(session.lastActivityAt)).length,
    oneMessageSessions: sessions.filter((session) => session.messageCount === 1).length,
    outOfRangeSessions: scopeStart === undefined
      ? 0
      : sessions.filter((session) => session.wasCreated === 1 && new Date(session.lastActivityAt).getTime() < scopeStart).length,
    recordsRecognized: Math.max(0, recordsProcessed - recordsRejected),
    recordsRejected,
    sessionsOnPackagePath: sessions.filter((session) => session.publicationStatus === "publish_path").length,
    sessionsSuppressed: sessions.filter((session) =>
      session.publicationStatus === "not_added_to_logbook" &&
      session.qualityDecisionSource === "automatic" &&
      session.suppressionCategory === "confirmed_noise"
    ).length,
    sessionsWithUserOrAssistant: sessions.filter((session) => session.conversationMessages > 0).length,
    structuredToolItems: sessions.reduce((total, session) => total + session.structuredToolItems, 0),
    timestampBasis,
    toolRoleMessages: sessions.reduce((total, session) => total + session.toolRoleMessages, 0)
  };
}

function isUnixEpoch(value: string): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp < 24 * 60 * 60 * 1_000;
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
