ALTER TABLE board_headline_frames ADD COLUMN refresh_key_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_board_headline_frames_refresh_key
  ON board_headline_frames(source_session_id, refresh_key_hash, generated_at DESC);
