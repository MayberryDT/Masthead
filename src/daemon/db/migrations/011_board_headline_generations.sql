CREATE TABLE IF NOT EXISTS board_headline_generations (
  generation_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  latency_ms INTEGER,
  refresh_key_hash TEXT NOT NULL,
  transcript_excerpt_count INTEGER NOT NULL,
  transcript_excerpt_sample_json TEXT NOT NULL,
  headline TEXT,
  frame_json TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_board_headline_generations_source_session
  ON board_headline_generations(source_session_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_board_headline_generations_status
  ON board_headline_generations(status, completed_at DESC);
