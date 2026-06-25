CREATE TABLE IF NOT EXISTS import_jobs_next (
  import_job_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'cancelling')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  current_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  failure_message TEXT
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
  0,
  imported_count,
  queued_count,
  failure_count,
  NULL,
  started_at,
  finished_at,
  updated_at,
  failure_message
FROM import_jobs;

DROP TABLE import_jobs;
ALTER TABLE import_jobs_next RENAME TO import_jobs;

CREATE INDEX IF NOT EXISTS import_jobs_source_idx ON import_jobs(source_id, updated_at DESC);
