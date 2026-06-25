PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session_sources (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  imported_record_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, source_id)
);

CREATE INDEX IF NOT EXISTS session_sources_source_idx ON session_sources(source_id, last_seen_at DESC);
