CREATE TABLE IF NOT EXISTS live_state_reports (
  report_id TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  source TEXT NOT NULL,
  source_session_id TEXT,
  canonical_session_id TEXT,
  source_event_id TEXT,
  state TEXT NOT NULL,
  authority TEXT NOT NULL,
  message TEXT,
  custom_status TEXT,
  seq INTEGER,
  observed_at TEXT NOT NULL,
  expires_at TEXT,
  cwd TEXT,
  repo_root TEXT,
  branch TEXT,
  pid INTEGER,
  process_name TEXT,
  session_ref_kind TEXT,
  session_ref_value TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_state_reports_session
  ON live_state_reports(runtime, source_session_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_state_reports_canonical
  ON live_state_reports(canonical_session_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_state_reports_source
  ON live_state_reports(source, runtime, observed_at DESC);
