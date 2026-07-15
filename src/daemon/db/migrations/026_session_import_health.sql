CREATE TABLE session_import_health (
  work_unit_id TEXT PRIMARY KEY NOT NULL REFERENCES import_work_units(work_unit_id) ON DELETE CASCADE,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'repair_required')),
  reason TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  evidence_revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_import_health_status
  ON session_import_health(status, updated_at DESC);

CREATE INDEX idx_session_import_health_session
  ON session_import_health(session_id, updated_at DESC);
