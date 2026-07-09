CREATE TABLE IF NOT EXISTS workbench_runs (
  run_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  session_id TEXT,
  artifact_id TEXT,
  details_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_workbench_runs_session
  ON workbench_runs(session_id, started_at);

