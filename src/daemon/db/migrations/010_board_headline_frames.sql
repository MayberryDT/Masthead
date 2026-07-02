CREATE TABLE IF NOT EXISTS board_headline_frames (
  frame_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  frame_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_board_headline_frames_source_session
  ON board_headline_frames(source_session_id, generated_at DESC);
