PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  adapter TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_path TEXT,
  endpoint TEXT,
  schema_version TEXT,
  runtime_version TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('authoritative', 'inferred', 'heuristic')),
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  excluded_at TEXT,
  exclusion_reason TEXT
);

CREATE TABLE IF NOT EXISTS source_exclusions (
  exclusion_id TEXT PRIMARY KEY NOT NULL,
  exclusion_kind TEXT NOT NULL CHECK (exclusion_kind IN ('source', 'project', 'path')),
  pattern TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT,
  UNIQUE (exclusion_kind, pattern)
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  cursor_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  source_path TEXT,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT,
  content_fingerprint TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, source_path)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  import_job_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  failure_message TEXT
);

CREATE TABLE IF NOT EXISTS adapter_diagnostics (
  diagnostic_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  adapter TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS raw_events (
  raw_event_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  source_record_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_path TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  adapter_diagnostics_json TEXT,
  UNIQUE (source_id, source_record_key)
);

CREATE TABLE IF NOT EXISTS hosts (
  host_id TEXT PRIMARY KEY NOT NULL,
  hostname TEXT,
  machine_label TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtimes (
  runtime_id TEXT PRIMARY KEY NOT NULL,
  runtime_kind TEXT NOT NULL,
  runtime_version TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (runtime_kind, runtime_version)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(host_id),
  runtime_id TEXT NOT NULL REFERENCES runtimes(runtime_id),
  source_session_id TEXT NOT NULL,
  project_label TEXT,
  repo_root TEXT,
  worktree_path TEXT,
  branch TEXT,
  title TEXT,
  objective TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'unknown',
  outcome_label TEXT,
  started_at TEXT,
  last_activity_at TEXT NOT NULL,
  ended_at TEXT,
  source_confidence TEXT NOT NULL CHECK (source_confidence IN ('authoritative', 'inferred', 'heuristic')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  excluded_from_mcp_at TEXT,
  UNIQUE (host_id, runtime_id, source_session_id)
);

CREATE TABLE IF NOT EXISTS session_aliases (
  alias_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  alias_kind TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('authoritative', 'inferred', 'heuristic')),
  UNIQUE (alias_kind, alias_value)
);

CREATE TABLE IF NOT EXISTS session_relationships (
  relationship_id TEXT PRIMARY KEY NOT NULL,
  from_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  to_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  relationship_kind TEXT NOT NULL CHECK (relationship_kind IN ('resumed', 'forked', 'compacted', 'parent', 'child')),
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('authoritative', 'inferred', 'heuristic')),
  observed_at TEXT NOT NULL,
  UNIQUE (from_session_id, to_session_id, relationship_kind)
);

CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_turn_id TEXT,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  source_ref_json TEXT NOT NULL,
  UNIQUE (session_id, turn_index, role, source_turn_id)
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(turn_id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  text_redacted TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_ref_json TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('authoritative', 'inferred', 'heuristic')),
  UNIQUE (session_id, text_hash, observed_at, role)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(turn_id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arguments_redacted_json TEXT,
  started_at TEXT,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_results (
  tool_result_id TEXT PRIMARY KEY NOT NULL,
  tool_call_id TEXT NOT NULL REFERENCES tool_calls(tool_call_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  output_redacted TEXT,
  output_hash TEXT,
  exit_code INTEGER,
  completed_at TEXT,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_effects (
  file_effect_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  effect_kind TEXT NOT NULL,
  staged INTEGER NOT NULL DEFAULT 0,
  additions INTEGER,
  deletions INTEGER,
  observed_at TEXT NOT NULL,
  source_ref_json TEXT NOT NULL,
  UNIQUE (session_id, path, effect_kind, observed_at)
);

CREATE TABLE IF NOT EXISTS runtime_signals (
  signal_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  signal_kind TEXT NOT NULL,
  severity TEXT,
  title TEXT NOT NULL,
  details_json TEXT,
  observed_at TEXT NOT NULL,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS background_tasks (
  background_task_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  task_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  checkpoint_kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_usage (
  usage_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  model TEXT,
  provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_micros INTEGER,
  observed_at TEXT NOT NULL,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_dispositions (
  disposition_id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  status TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  snoozed_until TEXT,
  reviewer TEXT,
  reason TEXT,
  source_ref_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_sessions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  projection_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_enrichments (
  enrichment_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  enrichment_kind TEXT NOT NULL CHECK (enrichment_kind IN ('live_summary', 'session_capsule', 'search_projection')),
  status TEXT NOT NULL CHECK (status IN ('current', 'stale', 'failed', 'disabled')),
  content_fingerprint TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  generated_at TEXT,
  content_json TEXT,
  source_refs_json TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  UNIQUE (session_id, enrichment_kind, prompt_version, content_fingerprint)
);

CREATE TABLE IF NOT EXISTS mcp_query_log (
  mcp_query_id TEXT PRIMARY KEY NOT NULL,
  tool_name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  bounded_bytes INTEGER,
  session_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'denied')),
  failure_message TEXT
);

CREATE TABLE IF NOT EXISTS session_topics (
  topic_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('authoritative', 'inferred', 'heuristic')),
  UNIQUE (session_id, topic, source)
);

CREATE TABLE IF NOT EXISTS project_summaries (
  project_summary_id TEXT PRIMARY KEY NOT NULL,
  project_key TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
  session_id UNINDEXED,
  title,
  capsule,
  first_prompt,
  final_response,
  normalized_text,
  commands,
  tool_names,
  file_paths,
  project_aliases,
  tags,
  tokenize = 'porter unicode61'
);

CREATE INDEX IF NOT EXISTS raw_events_observed_idx ON raw_events(observed_at);
CREATE INDEX IF NOT EXISTS raw_events_source_idx ON raw_events(source_id, observed_at);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_cursors_source_path_unique_idx ON ingest_cursors(source_id, COALESCE(source_path, ''));
CREATE INDEX IF NOT EXISTS import_jobs_source_idx ON import_jobs(source_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS runtimes_kind_version_unique_idx ON runtimes(runtime_kind, COALESCE(runtime_version, ''));
CREATE INDEX IF NOT EXISTS sessions_activity_idx ON sessions(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS sessions_runtime_idx ON sessions(runtime_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_label, last_activity_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS turns_session_role_source_unique_idx ON turns(session_id, turn_index, role, COALESCE(source_turn_id, ''));
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, observed_at);
CREATE INDEX IF NOT EXISTS tool_calls_session_idx ON tool_calls(session_id, started_at);
CREATE INDEX IF NOT EXISTS file_effects_session_idx ON file_effects(session_id, path);
CREATE INDEX IF NOT EXISTS mcp_query_log_requested_idx ON mcp_query_log(requested_at DESC);
