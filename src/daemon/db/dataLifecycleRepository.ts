import type { MastheadDatabase } from "./sqlite.ts";
import {
  reconcileWorkbenchArtifactSatisfactionInTransaction,
  type WorkbenchAutomaticKind
} from "./workbenchPipelineRepository.ts";

const SQLITE_BATCH_SIZE = 400;

export type RetentionClass =
  | "canonical_metadata"
  | "searchable_messages"
  | "raw_payloads"
  | "large_outputs"
  | "derived_indexes"
  | "audit_logs";

export type RetentionClassSummary = {
  records: number;
  retention: "indefinite" | "indefinite_configurable" | "configurable" | "short_configurable" | "rebuildable";
  description: string;
};

export type CanonicalDeleteResult = {
  sessions: number;
  rawEvents: number;
  enrichments: number;
  auditRows: number;
};

export type RetentionApplyResult = {
  rawEvents: number;
};

export type DeleteMastheadDataScope =
  | { kind: "all" }
  | { kind: "raw_payloads" }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; project: string }
  | { kind: "runtime"; runtime: string }
  | { kind: "host"; host: string };

export type DataSummary = {
  sessions: number;
  rawEvents: number;
  messages: number;
  enrichments: number;
  sources: number;
  auditRows: number;
  tables: Record<string, number>;
  storageClasses: Record<RetentionClass, RetentionClassSummary>;
};

export type MastheadExportV1 = {
  metadata: {
    format: "masthead.session-graph.v1";
    schemaVersion: 1;
    exportedAt: string;
  };
  hosts: unknown[];
  runtimes: unknown[];
  sessions: unknown[];
  relationships: unknown[];
  turns: unknown[];
  messages: unknown[];
  toolCalls: unknown[];
  toolResults: unknown[];
  fileEffects: unknown[];
  checkpoints: unknown[];
  modelUsage: unknown[];
  enrichments: unknown[];
  topics: unknown[];
  sourcePolicies: unknown[];
};

export function getDataSummary(db: MastheadDatabase, scope: DeleteMastheadDataScope = { kind: "all" }): DataSummary {
  if (scope.kind !== "all") return getScopedDataSummary(db, scope);
  return dataSummaryFromTables(db, {
    adapter_diagnostics: tableCount(db, "adapter_diagnostics"),
    hosts: tableCount(db, "hosts"),
    ingest_sources: tableCount(db, "ingest_sources"),
    mcp_query_log: tableCount(db, "mcp_query_log"),
    messages: tableCount(db, "messages"),
    project_summaries: tableCount(db, "project_summaries"),
    raw_events: tableCount(db, "raw_events"),
    runtimes: tableCount(db, "runtimes"),
    session_enrichments: tableCount(db, "session_enrichments"),
    session_search: tableCount(db, "session_search"),
    sessions: tableCount(db, "sessions"),
    source_policies: tableCount(db, "source_policies"),
    source_scan_runs: tableCount(db, "source_scan_runs"),
    source_setup_state: tableCount(db, "source_setup_state"),
    tool_results: tableCount(db, "tool_results")
  });
}

function dataSummaryFromTables(db: MastheadDatabase, tables: Record<string, number>): DataSummary {
  return {
    auditRows: tables.mcp_query_log ?? 0,
    enrichments: tables.session_enrichments ?? 0,
    messages: tables.messages ?? 0,
    rawEvents: tables.raw_events ?? 0,
    sessions: tables.sessions ?? 0,
    sources: tables.ingest_sources ?? 0,
    storageClasses: {
      audit_logs: {
        description: "MCP query audit records.",
        records: tables.mcp_query_log ?? 0,
        retention: "configurable"
      },
      canonical_metadata: {
        description: "Normalized sessions and durable session capsules.",
        records: (tables.sessions ?? 0) + (tables.session_enrichments ?? 0),
        retention: "indefinite"
      },
      derived_indexes: {
        description: "Rebuildable search indexes and project summaries.",
        records: (tables.session_search ?? 0) + (tables.project_summaries ?? 0),
        retention: "rebuildable"
      },
      large_outputs: {
        description: "Large tool outputs retained for bounded evidence.",
        records: tables.large_outputs ?? largeOutputCount(db),
        retention: "short_configurable"
      },
      raw_payloads: {
        description: "Raw source copies captured before normalization.",
        records: tables.raw_events ?? 0,
        retention: "configurable"
      },
      searchable_messages: {
        description: "Redacted message text used by Logbook and MCP search.",
        records: tables.messages ?? 0,
        retention: "indefinite_configurable"
      }
    },
    tables
  };
}

function getScopedDataSummary(db: MastheadDatabase, scope: Exclude<DeleteMastheadDataScope, { kind: "all" }>): DataSummary {
  if (scope.kind === "raw_payloads") {
    return dataSummaryFromTables(db, {
      adapter_diagnostics: 0,
      hosts: 0,
      ingest_sources: 0,
      mcp_query_log: 0,
      messages: 0,
      project_summaries: 0,
      raw_events: tableCount(db, "raw_events"),
      runtimes: 0,
      session_enrichments: 0,
      session_search: 0,
      sessions: 0,
      source_policies: 0,
      tool_results: 0
    });
  }

  const sessions = sessionRowsForScope(db, scope);
  const sessionIds = sessions.map((session) => session.session_id);
  const sourceSessionIds = new Set(sessions.map((session) => session.source_session_id));
  const projects = affectedProjects(scope, sessions);
  return dataSummaryFromTables(db, {
    adapter_diagnostics: 0,
    hosts: 0,
    ingest_sources: 0,
    mcp_query_log: countMcpAuditRowsForSessions(db, sessionIds),
    messages: countWhereIn(db, "messages", "session_id", sessionIds),
    project_summaries: countWhereIn(db, "project_summaries", "project_key", projects),
    raw_events: rawEventCountForScope(db, scope, sourceSessionIds),
    runtimes: 0,
    session_enrichments: countWhereIn(db, "session_enrichments", "session_id", sessionIds),
    session_search: countWhereIn(db, "session_search", "session_id", sessionIds),
    sessions: sessionIds.length,
    source_policies: 0,
    tool_results: countWhereIn(db, "tool_results", "session_id", sessionIds),
    large_outputs: largeOutputCount(db, sessionIds)
  });
}

export function exportSessionGraph(db: MastheadDatabase, exportedAt = new Date().toISOString()): MastheadExportV1 {
  return {
    metadata: {
      exportedAt,
      format: "masthead.session-graph.v1",
      schemaVersion: 1
    },
    checkpoints: rows(db, "checkpoints"),
    enrichments: rows(db, "session_enrichments"),
    fileEffects: rows(db, "file_effects"),
    hosts: rows(db, "hosts"),
    messages: rows(db, "messages"),
    modelUsage: rows(db, "model_usage"),
    relationships: rows(db, "session_relationships"),
    runtimes: rows(db, "runtimes"),
    sessions: rows(db, "sessions"),
    sourcePolicies: rows(db, "source_policies"),
    topics: rows(db, "session_topics"),
    toolCalls: rows(db, "tool_calls"),
    toolResults: rows(db, "tool_results"),
    turns: rows(db, "turns")
  };
}

export function deleteAllMastheadData(db: MastheadDatabase): CanonicalDeleteResult {
  return deleteMastheadData(db, { kind: "all" });
}

export function applyDefaultRetention(db: MastheadDatabase): RetentionApplyResult {
  const result = {
    rawEvents: tableCount(db, "raw_events")
  };

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec("DELETE FROM raw_events;");
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function deleteMastheadData(db: MastheadDatabase, scope: DeleteMastheadDataScope = { kind: "all" }): CanonicalDeleteResult {
  if (scope.kind === "all") return deleteAllCanonicalData(db);
  if (scope.kind === "raw_payloads") return deleteRawPayloads(db);
  return deleteSessionScope(db, scope);
}

function deleteAllCanonicalData(db: MastheadDatabase): CanonicalDeleteResult {
  const result = {
    auditRows: tableCount(db, "mcp_query_log"),
    enrichments: tableCount(db, "session_enrichments"),
    rawEvents: tableCount(db, "raw_events"),
    sessions: tableCount(db, "sessions")
  };

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      DELETE FROM session_search;
      DELETE FROM session_artifact_search;
      DELETE FROM session_artifact_provenance;
      DELETE FROM session_artifacts;
      DELETE FROM workbench_authoring_runs;
      DELETE FROM workbench_runs;
      DELETE FROM mcp_query_log;
      DELETE FROM project_summaries;
      DELETE FROM session_topics;
      DELETE FROM session_enrichments;
      DELETE FROM board_sessions;
      DELETE FROM review_dispositions;
      DELETE FROM sessions;
      DELETE FROM raw_events;
      DELETE FROM adapter_diagnostics;
      DELETE FROM import_jobs;
      DELETE FROM ingest_cursors;
      DELETE FROM source_policies;
      DELETE FROM source_exclusions;
      DELETE FROM source_setup_state;
      DELETE FROM source_scan_runs;
      DELETE FROM ingest_sources;
      DELETE FROM runtimes;
      DELETE FROM hosts;
      DELETE FROM app_settings WHERE setting_key <> 'database_identity';
      DELETE FROM legacy_migrations;
    `);
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function deleteRawPayloads(db: MastheadDatabase): CanonicalDeleteResult {
  const result = {
    auditRows: 0,
    enrichments: 0,
    rawEvents: tableCount(db, "raw_events"),
    sessions: 0
  };

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec("DELETE FROM raw_events;");
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function deleteSessionScope(
  db: MastheadDatabase,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>
): CanonicalDeleteResult {
  const sessions = sessionRowsForScope(db, scope);
  const sessionIds = sessions.map((session) => session.session_id);
  const sourceSessionIds = new Set(sessions.map((session) => session.source_session_id));
  const projects = affectedProjects(scope, sessions);
  const rawEventIds = rawEventIdsForScope(db, scope, sourceSessionIds);
  const result = {
    auditRows: sessionIds.length === 0 ? 0 : countMcpAuditRowsForSessions(db, sessionIds),
    enrichments: sessionIds.length === 0 ? 0 : countWhereIn(db, "session_enrichments", "session_id", sessionIds),
    rawEvents: rawEventIds.length,
    sessions: sessionIds.length
  };

  db.exec("BEGIN IMMEDIATE;");
  try {
    deleteAuthoredDataForSessions(db, sessionIds);
    deleteWhereIn(db, "session_search", "session_id", sessionIds);
    deleteWhereIn(db, "raw_events", "raw_event_id", rawEventIds);
    deleteReviewDispositionsForSessions(db, sessionIds);
    deleteMcpAuditRowsForSessions(db, sessionIds);
    deleteWhereIn(db, "project_summaries", "project_key", projects);
    deleteWhereIn(db, "sessions", "session_id", sessionIds);
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function deleteAuthoredDataForSessions(db: MastheadDatabase, sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  const artifactIds = new Set<string>();
  if (tableCount(db, "session_artifacts") > 0) {
    for (const batch of batches(sessionIds)) {
      const placeholders = sqlPlaceholders(batch);
      const rows = db
        .prepare(
          `SELECT DISTINCT artifacts.artifact_id AS artifactId
           FROM session_artifacts AS artifacts
           LEFT JOIN session_artifact_provenance AS provenance
             ON provenance.artifact_id = artifacts.artifact_id
           WHERE artifacts.session_id IN (${placeholders})
              OR provenance.session_id IN (${placeholders})`
        )
        .all(...batch, ...batch) as Array<{ artifactId: string }>;
      for (const row of rows) artifactIds.add(row.artifactId);
    }
  }

  const runIds = new Set<string>();
  if (tableCount(db, "workbench_authoring_run_sessions") > 0) {
    for (const batch of batches(sessionIds)) {
      const rows = db
        .prepare(
          `SELECT DISTINCT run_id AS runId
           FROM workbench_authoring_run_sessions
           WHERE session_id IN (${sqlPlaceholders(batch)})`
        )
        .all(...batch) as Array<{ runId: string }>;
      for (const row of rows) runIds.add(row.runId);
    }
  }
  if (artifactIds.size > 0) {
    const runs = db
      .prepare(
        `SELECT run_id AS runId, bundle_json AS bundleJson, receipt_json AS receiptJson
         FROM workbench_authoring_runs`
      )
      .all() as Array<{ bundleJson: string | null; receiptJson: string | null; runId: string }>;
    for (const run of runs) {
      if (authoringRunReferencesArtifacts(run, artifactIds)) runIds.add(run.runId);
    }
  }

  const claimIds = new Set<string>();
  for (const batch of batches([...runIds])) {
    const rows = db
      .prepare(
        `SELECT DISTINCT claim_id AS claimId
         FROM workbench_authoring_run_sessions
         WHERE run_id IN (${sqlPlaceholders(batch)})`
      )
      .all(...batch) as Array<{ claimId: string }>;
    for (const row of rows) claimIds.add(row.claimId);
  }
  const artifactActivityIds = artifactLinkedActivityIds(db, artifactIds);
  const affectedSessionsByKind = artifactSessionsByAutomaticKind(db, artifactIds);
  const deletedSessionIds = new Set(sessionIds);
  const artifactIdList = [...artifactIds];
  const runIdList = [...runIds];
  const claimIdList = [...claimIds];

  deleteWhereIn(db, "session_artifact_search", "artifact_id", artifactIdList);
  deleteWhereIn(db, "session_artifact_provenance", "artifact_id", artifactIdList);
  deleteWhereIn(db, "workbench_runs", "artifact_id", artifactIdList);
  deleteWhereIn(db, "session_artifacts", "artifact_id", artifactIdList);
  deleteWhereIn(db, "workbench_activity", "activity_id", artifactActivityIds);
  deleteWhereIn(db, "workbench_activity", "related_run_id", runIdList);
  deleteWhereIn(db, "workbench_activity", "related_claim_id", claimIdList);
  deleteWhereIn(db, "workbench_authoring_runs", "run_id", runIdList);
  deleteUnreferencedClaims(db, claimIdList);
  deleteWhereIn(db, "workbench_runs", "session_id", sessionIds);

  for (const [artifactKind, affectedSessionIds] of affectedSessionsByKind) {
    reconcileWorkbenchArtifactSatisfactionInTransaction(db, {
      artifactKind,
      sessionIds: [...affectedSessionIds].filter((sessionId) => !deletedSessionIds.has(sessionId))
    });
  }
}

function authoringRunReferencesArtifacts(
  run: { bundleJson: string | null; receiptJson: string | null },
  artifactIds: ReadonlySet<string>
): boolean {
  const bundle = parseJsonRecord(run.bundleJson);
  if (
    unknownArray(bundle.contributions).some((value) =>
      artifactIds.has(stringValue(objectRecord(value).publishedArtifactId) ?? "")
    )
  ) {
    return true;
  }
  const receipt = parseJsonRecord(run.receiptJson);
  if (unknownArray(receipt.publishedArtifactIds).some((value) => artifactIds.has(stringValue(value) ?? ""))) return true;
  return unknownArray(receipt.contributions).some((value) =>
    artifactIds.has(stringValue(objectRecord(value).artifactId) ?? "")
  );
}

function artifactLinkedActivityIds(db: MastheadDatabase, artifactIds: ReadonlySet<string>): string[] {
  if (artifactIds.size === 0) return [];
  const rows = db
    .prepare("SELECT activity_id AS activityId, details_json AS detailsJson FROM workbench_activity")
    .all() as Array<{ activityId: string; detailsJson: string }>;
  return rows.filter((row) => activityReferencesArtifacts(row.detailsJson, artifactIds)).map((row) => row.activityId);
}

function activityReferencesArtifacts(detailsJson: string, artifactIds: ReadonlySet<string>): boolean {
  const details = parseJsonRecord(detailsJson);
  if (artifactIds.has(stringValue(details.artifactId) ?? "")) return true;
  if (artifactIds.has(stringValue(details.publishedArtifactId) ?? "")) return true;
  if (unknownArray(details.publishedArtifactIds).some((value) => artifactIds.has(stringValue(value) ?? ""))) return true;
  const reason = stringValue(details.reason);
  if (reason?.startsWith("contributed_to:") && artifactIds.has(reason.slice("contributed_to:".length))) return true;
  return unknownArray(details.contributions).some((value) => {
    const contribution = objectRecord(value);
    return (
      artifactIds.has(stringValue(contribution.artifactId) ?? "") ||
      artifactIds.has(stringValue(contribution.publishedArtifactId) ?? "")
    );
  });
}

function artifactSessionsByAutomaticKind(
  db: MastheadDatabase,
  artifactIds: ReadonlySet<string>
): Map<WorkbenchAutomaticKind, Set<string>> {
  const result = new Map<WorkbenchAutomaticKind, Set<string>>();
  for (const batch of batches([...artifactIds])) {
    const rows = db
      .prepare(
        `SELECT artifacts.artifact_kind AS artifactKind,
                artifacts.session_id AS seedSessionId,
                provenance.session_id AS provenanceSessionId
         FROM session_artifacts AS artifacts
         LEFT JOIN session_artifact_provenance AS provenance
           ON provenance.artifact_id = artifacts.artifact_id
         WHERE artifacts.artifact_id IN (${sqlPlaceholders(batch)})`
      )
      .all(...batch) as Array<{
      artifactKind: string;
      provenanceSessionId: string | null;
      seedSessionId: string;
    }>;
    for (const row of rows) {
      if (!isWorkbenchAutomaticKind(row.artifactKind)) continue;
      const sessionIds = result.get(row.artifactKind) ?? new Set<string>();
      sessionIds.add(row.seedSessionId);
      if (row.provenanceSessionId) sessionIds.add(row.provenanceSessionId);
      result.set(row.artifactKind, sessionIds);
    }
  }
  return result;
}

function isWorkbenchAutomaticKind(value: string): value is WorkbenchAutomaticKind {
  return value === "runbook" || value === "adr" || value === "incident_timeline";
}

function sessionRowsForScope(
  db: MastheadDatabase,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>
): Array<{ session_id: string; project_label: string | null; source_session_id: string }> {
  if (scope.kind === "session") {
    return db
      .prepare("SELECT session_id, project_label, source_session_id FROM sessions WHERE session_id = ? OR source_session_id = ?")
      .all(scope.sessionId, scope.sessionId) as Array<{ session_id: string; project_label: string | null; source_session_id: string }>;
  }
  if (scope.kind === "project") {
    return db
      .prepare("SELECT session_id, project_label, source_session_id FROM sessions WHERE project_label = ?")
      .all(scope.project) as Array<{ session_id: string; project_label: string | null; source_session_id: string }>;
  }
  if (scope.kind === "runtime") {
    return db
      .prepare(
        `SELECT sessions.session_id AS session_id, sessions.project_label AS project_label, sessions.source_session_id AS source_session_id
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        WHERE runtimes.runtime_id = ? OR runtimes.runtime_kind = ?`
      )
      .all(scope.runtime, scope.runtime) as Array<{ session_id: string; project_label: string | null; source_session_id: string }>;
  }
  return db
    .prepare(
      `SELECT sessions.session_id AS session_id, sessions.project_label AS project_label, sessions.source_session_id AS source_session_id
      FROM sessions
      JOIN hosts ON hosts.host_id = sessions.host_id
      WHERE hosts.host_id = ? OR hosts.hostname = ?`
    )
    .all(scope.host, scope.host) as Array<{ session_id: string; project_label: string | null; source_session_id: string }>;
}

function affectedProjects(
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sessions: Array<{ project_label: string | null }>
): string[] {
  const projects = new Set(sessions.map((session) => session.project_label).filter((project): project is string => Boolean(project)));
  if (scope.kind === "project") projects.add(scope.project);
  return [...projects];
}

function rawEventCountForScope(
  db: MastheadDatabase,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): number {
  return rawEventIdsForScope(db, scope, sourceSessionIds).length;
}

function rawEventIdsForScope(
  db: MastheadDatabase,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): string[] {
  const rows = db
    .prepare("SELECT raw_event_id, source_id, source_record_key, source_path, payload_json FROM raw_events")
    .all() as Array<{
    raw_event_id: string;
    source_id: string;
    source_record_key: string;
    source_path: string | null;
    payload_json: string;
  }>;
  return rows
    .filter((row) => rawEventMatchesScope(row, scope, sourceSessionIds))
    .map((row) => row.raw_event_id);
}

function rawEventMatchesScope(
  row: { source_id: string; source_record_key: string; source_path: string | null; payload_json: string },
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): boolean {
  if (rawEventPayloadMatchesScope(row.payload_json, scope, sourceSessionIds)) return true;
  return false;
}

function rawEventPayloadMatchesScope(
  payloadJson: string,
  scope: Exclude<DeleteMastheadDataScope, { kind: "all" } | { kind: "raw_payloads" }>,
  sourceSessionIds: Set<string>
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return false;
  }
  const record = objectRecord(parsed);
  const value = objectRecord(record.value);
  const payload = objectRecord(record.payload);
  const directSessionId =
    stringValue(record.sessionId) ??
    stringValue(record.session_id) ??
    stringValue(payload.sessionId) ??
    stringValue(payload.session_id) ??
    stringValue(payload.conversationId) ??
    stringValue(payload.conversation_id);
  if (directSessionId && sourceSessionIds.has(directSessionId)) return true;
  if (record.recordType === "event") {
    const sessionId = stringValue(value.sessionId);
    if (sessionId && sourceSessionIds.has(sessionId)) return true;
    if (scope.kind === "session") return sessionId === scope.sessionId;
    if (scope.kind === "project") return stringValue(objectRecord(value.payload).project) === scope.project;
    if (scope.kind === "runtime") return stringValue(objectRecord(value.source).adapter) === scope.runtime;
    return false;
  }
  if (record.recordType === "git_snapshot") {
    const sessionId = stringValue(value.sessionId);
    return Boolean(sessionId && sourceSessionIds.has(sessionId));
  }
  return false;
}

function countWhereIn(db: MastheadDatabase, table: string, column: string, values: string[]): number {
  let count = 0;
  for (const batch of batches(values)) {
    count += (
      db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${sqlPlaceholders(batch)})`).get(
        ...batch
      ) as { count: number }
    ).count;
  }
  return count;
}

function deleteWhereIn(db: MastheadDatabase, table: string, column: string, values: string[]): void {
  for (const batch of batches(values)) {
    db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${sqlPlaceholders(batch)})`).run(...batch);
  }
}

function deleteUnreferencedClaims(db: MastheadDatabase, claimIds: string[]): void {
  for (const batch of batches(claimIds)) {
    db.prepare(
      `DELETE FROM workbench_claims
       WHERE claim_id IN (${sqlPlaceholders(batch)})
         AND NOT EXISTS (
           SELECT 1
           FROM workbench_authoring_run_sessions
           WHERE workbench_authoring_run_sessions.claim_id = workbench_claims.claim_id
         )`
    ).run(...batch);
  }
}

function deleteReviewDispositionsForSessions(db: MastheadDatabase, sessionIds: string[]): void {
  for (const batch of batches(sessionIds)) {
    db.prepare(
      `DELETE FROM review_dispositions
       WHERE subject_type = 'session' AND subject_id IN (${sqlPlaceholders(batch)})`
    ).run(...batch);
  }
}

function countMcpAuditRowsForSessions(db: MastheadDatabase, sessionIds: string[]): number {
  if (sessionIds.length === 0 || tableCount(db, "mcp_query_log") === 0) return 0;
  const auditIds = new Set<string>();
  for (const batch of batches(sessionIds)) {
    const rows = db
      .prepare(`SELECT mcp_query_id AS auditId FROM mcp_query_log WHERE ${mcpAuditSessionPredicate(batch)}`)
      .all(...batch.map((sessionId) => `%${escapeLike(JSON.stringify(sessionId))}%`)) as Array<{ auditId: string }>;
    for (const row of rows) auditIds.add(row.auditId);
  }
  return auditIds.size;
}

function deleteMcpAuditRowsForSessions(db: MastheadDatabase, sessionIds: string[]): void {
  for (const batch of batches(sessionIds)) {
    db.prepare(`DELETE FROM mcp_query_log WHERE ${mcpAuditSessionPredicate(batch)}`).run(
      ...batch.map((sessionId) => `%${escapeLike(JSON.stringify(sessionId))}%`)
    );
  }
}

function mcpAuditSessionPredicate(sessionIds: string[]): string {
  return sessionIds.map(() => "session_ids_json LIKE ? ESCAPE '\\'").join(" OR ");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return objectRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tableCount(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function largeOutputCount(db: MastheadDatabase, sessionIds?: string[]): number {
  if (sessionIds) {
    let count = 0;
    for (const batch of batches(sessionIds)) {
      count += (
        db.prepare(
          `SELECT COUNT(*) AS count
           FROM tool_results
           WHERE session_id IN (${sqlPlaceholders(batch)})
             AND (output_redacted IS NOT NULL OR output_hash IS NOT NULL)`
        ).get(...batch) as { count: number }
      ).count;
    }
    return count;
  }
  return (
    db.prepare(
      `SELECT COUNT(*) AS count
      FROM tool_results
      WHERE output_redacted IS NOT NULL OR output_hash IS NOT NULL`
    ).get() as { count: number }
  ).count;
}

function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += SQLITE_BATCH_SIZE) {
    result.push(values.slice(offset, offset + SQLITE_BATCH_SIZE));
  }
  return result;
}

function sqlPlaceholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function rows(db: MastheadDatabase, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
}
