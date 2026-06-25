import type { MastheadDatabase } from "./sqlite.ts";

export type CanonicalDeleteResult = {
  sessions: number;
  rawEvents: number;
  enrichments: number;
  auditRows: number;
};

export type DataSummary = {
  sessions: number;
  rawEvents: number;
  messages: number;
  enrichments: number;
  sources: number;
  auditRows: number;
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

export function getDataSummary(db: MastheadDatabase): DataSummary {
  return {
    auditRows: tableCount(db, "mcp_query_log"),
    enrichments: tableCount(db, "session_enrichments"),
    messages: tableCount(db, "messages"),
    rawEvents: tableCount(db, "raw_events"),
    sessions: tableCount(db, "sessions"),
    sources: tableCount(db, "ingest_sources")
  };
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

function tableCount(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function rows(db: MastheadDatabase, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
}
