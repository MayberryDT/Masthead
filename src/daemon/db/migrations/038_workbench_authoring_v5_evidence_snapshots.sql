CREATE TABLE workbench_authoring_v5_evidence_snapshots (
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, session_id),
  FOREIGN KEY (request_id, session_id)
    REFERENCES workbench_authoring_v5_request_sessions(request_id, session_id)
    ON DELETE CASCADE
);
