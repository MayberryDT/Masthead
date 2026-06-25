import type { MastheadDatabase } from "./sqlite.ts";

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
      DELETE FROM ingest_sources;
      DELETE FROM runtimes;
      DELETE FROM hosts;
      DELETE FROM app_settings;
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
  const projects = affectedProjects(scope, sessions);
  const result = {
    auditRows: sessionIds.length === 0 ? 0 : countMcpAuditRowsForSessions(db, sessionIds),
    enrichments: sessionIds.length === 0 ? 0 : countWhereIn(db, "session_enrichments", "session_id", sessionIds),
    rawEvents: 0,
    sessions: sessionIds.length
  };

  db.exec("BEGIN IMMEDIATE;");
  try {
    deleteWhereIn(db, "session_search", "session_id", sessionIds);
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
  const rows = db.prepare("SELECT payload_json FROM raw_events").all() as Array<{ payload_json: string }>;
  return rows.filter((row) => rawEventPayloadMatchesScope(row.payload_json, scope, sourceSessionIds)).length;
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
  if (values.length === 0) return 0;
  const placeholders = values.map(() => "?").join(", ");
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} IN (${placeholders})`).get(...values) as { count: number }
  ).count;
}

function deleteWhereIn(db: MastheadDatabase, table: string, column: string, values: string[]): void {
  if (values.length === 0) return;
  const placeholders = values.map(() => "?").join(", ");
  db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...values);
}

function deleteReviewDispositionsForSessions(db: MastheadDatabase, sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  const placeholders = sessionIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM review_dispositions WHERE subject_type = 'session' AND subject_id IN (${placeholders})`).run(...sessionIds);
}

function countMcpAuditRowsForSessions(db: MastheadDatabase, sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0;
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM mcp_query_log WHERE ${mcpAuditSessionPredicate(sessionIds)}`).get(
      ...sessionIds.map((sessionId) => `%${escapeLike(JSON.stringify(sessionId))}%`)
    ) as { count: number }
  ).count;
}

function deleteMcpAuditRowsForSessions(db: MastheadDatabase, sessionIds: string[]): void {
  if (sessionIds.length === 0) return;
  db.prepare(`DELETE FROM mcp_query_log WHERE ${mcpAuditSessionPredicate(sessionIds)}`).run(
    ...sessionIds.map((sessionId) => `%${escapeLike(JSON.stringify(sessionId))}%`)
  );
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function tableCount(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function largeOutputCount(db: MastheadDatabase, sessionIds?: string[]): number {
  if (sessionIds) {
    if (sessionIds.length === 0) return 0;
    const placeholders = sessionIds.map(() => "?").join(", ");
    return (
      db.prepare(
        `SELECT COUNT(*) AS count
        FROM tool_results
        WHERE session_id IN (${placeholders})
          AND (output_redacted IS NOT NULL OR output_hash IS NOT NULL)`
      ).get(...sessionIds) as { count: number }
    ).count;
  }
  return (
    db.prepare(
      `SELECT COUNT(*) AS count
      FROM tool_results
      WHERE output_redacted IS NOT NULL OR output_hash IS NOT NULL`
    ).get() as { count: number }
  ).count;
}

function rows(db: MastheadDatabase, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
}
