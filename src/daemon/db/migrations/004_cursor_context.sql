PRAGMA foreign_keys = ON;

ALTER TABLE ingest_cursors ADD COLUMN source_session_id TEXT;
ALTER TABLE ingest_cursors ADD COLUMN cwd TEXT;
ALTER TABLE ingest_cursors ADD COLUMN model TEXT;
