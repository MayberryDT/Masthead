CREATE TABLE session_import_health (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'repair_required')),
  reason TEXT,
  import_job_id TEXT REFERENCES import_jobs(import_job_id) ON DELETE SET NULL,
  work_unit_id TEXT REFERENCES import_work_units(work_unit_id) ON DELETE SET NULL,
  evidence_revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_import_health_status
  ON session_import_health(status, updated_at DESC);
