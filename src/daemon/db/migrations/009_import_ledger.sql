CREATE TABLE IF NOT EXISTS import_jobs_next (
  import_job_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'succeeded_with_issues', 'failed', 'cancelled', 'cancelling')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  current_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  failure_message TEXT,
  stage TEXT,
  heartbeat_at TEXT,
  total_work_units INTEGER NOT NULL DEFAULT 0,
  completed_work_units INTEGER NOT NULL DEFAULT 0,
  failed_work_units INTEGER NOT NULL DEFAULT 0,
  skipped_work_units INTEGER NOT NULL DEFAULT 0,
  scope_json TEXT,
  summary_json TEXT,
  completion_report_json TEXT
);

INSERT INTO import_jobs_next (
  import_job_id,
  source_id,
  import_kind,
  status,
  discovered_count,
  processed_count,
  imported_count,
  queued_count,
  failure_count,
  current_path,
  started_at,
  finished_at,
  updated_at,
  failure_message
)
SELECT
  import_job_id,
  source_id,
  import_kind,
  status,
  discovered_count,
  processed_count,
  imported_count,
  queued_count,
  failure_count,
  current_path,
  started_at,
  finished_at,
  updated_at,
  failure_message
FROM import_jobs;

DROP TABLE import_jobs;
ALTER TABLE import_jobs_next RENAME TO import_jobs;

CREATE INDEX IF NOT EXISTS import_jobs_source_idx ON import_jobs(source_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS runtime_policies (
  runtime_policy_id TEXT PRIMARY KEY NOT NULL,
  runtime_kind TEXT NOT NULL,
  policy_kind TEXT NOT NULL CHECK (policy_kind IN ('transcript_import', 'enrichment', 'mcp_access')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  decided_at TEXT NOT NULL,
  reason TEXT,
  UNIQUE (runtime_kind, policy_kind)
);

CREATE TABLE IF NOT EXISTS import_manifests (
  manifest_id TEXT PRIMARY KEY NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  runtime_kind TEXT NOT NULL,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  scope_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  total_units INTEGER NOT NULL DEFAULT 0,
  included_units INTEGER NOT NULL DEFAULT 0,
  excluded_units INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  estimated_records INTEGER
);

CREATE INDEX IF NOT EXISTS import_manifests_job_idx ON import_manifests(import_job_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS import_work_units (
  work_unit_id TEXT PRIMARY KEY NOT NULL,
  manifest_id TEXT NOT NULL REFERENCES import_manifests(manifest_id) ON DELETE CASCADE,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  runtime_kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  schema_version TEXT,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('metadata_source', 'transcript_file', 'source_session', 'enrichment_session')),
  source_path TEXT,
  source_session_id TEXT,
  cursor_before_json TEXT,
  cursor_after_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'succeeded_with_issues', 'failed', 'skipped', 'cancelled')),
  status_reason TEXT,
  file_size_bytes INTEGER,
  modified_at TEXT,
  estimated_records INTEGER,
  processed_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  skipped_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  failure_group_id TEXT,
  summary_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS import_work_units_identity_idx
  ON import_work_units(
    manifest_id,
    unit_kind,
    COALESCE(source_path, ''),
    COALESCE(source_session_id, '')
  );
CREATE INDEX IF NOT EXISTS import_work_units_job_idx ON import_work_units(import_job_id, status, source_path);
CREATE INDEX IF NOT EXISTS import_work_units_manifest_idx ON import_work_units(manifest_id, status, source_path);

CREATE TABLE IF NOT EXISTS import_failure_groups (
  failure_group_id TEXT PRIMARY KEY NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  manifest_id TEXT REFERENCES import_manifests(manifest_id) ON DELETE SET NULL,
  runtime_kind TEXT NOT NULL,
  failure_kind TEXT NOT NULL CHECK (failure_kind IN ('unreadable', 'locked', 'malformed', 'schema_drift', 'normalization', 'excluded', 'unknown')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sample_paths_json TEXT NOT NULL,
  UNIQUE (import_job_id, failure_kind, code, message)
);

CREATE INDEX IF NOT EXISTS import_failure_groups_job_idx ON import_failure_groups(import_job_id, count DESC);

CREATE TABLE IF NOT EXISTS import_session_impacts (
  impact_id TEXT PRIMARY KEY NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  runtime_kind TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  impact_kind TEXT NOT NULL CHECK (impact_kind IN ('created', 'updated', 'transcript_added', 'enriched')),
  record_count INTEGER NOT NULL DEFAULT 1,
  observed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS import_session_impacts_identity_idx
  ON import_session_impacts(import_job_id, session_id, impact_kind);
CREATE INDEX IF NOT EXISTS import_session_impacts_job_idx
  ON import_session_impacts(import_job_id, runtime_kind, impact_kind);
