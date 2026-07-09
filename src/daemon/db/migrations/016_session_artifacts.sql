CREATE TABLE IF NOT EXISTS session_artifacts (
  artifact_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  title TEXT,
  content_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(session_id),
  UNIQUE(session_id, artifact_kind, schema_version, content_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_session_artifacts_session
  ON session_artifacts(session_id, artifact_kind, status);

CREATE INDEX IF NOT EXISTS idx_session_artifacts_kind
  ON session_artifacts(artifact_kind, status, updated_at);

