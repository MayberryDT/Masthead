CREATE TABLE IF NOT EXISTS source_scan_runs (
  scan_id TEXT PRIMARY KEY NOT NULL,
  generated_at TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS source_scan_runs_generated_idx ON source_scan_runs(generated_at DESC);

CREATE TABLE IF NOT EXISTS source_setup_state (
  setup_id TEXT PRIMARY KEY NOT NULL,
  updated_at TEXT NOT NULL,
  state_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS source_setup_state_updated_idx ON source_setup_state(updated_at DESC);
