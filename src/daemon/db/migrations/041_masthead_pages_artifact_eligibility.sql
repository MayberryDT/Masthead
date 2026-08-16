CREATE TABLE masthead_pages_artifact_eligibility (
  artifact_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'ineligible', 'error')),
  reason_code TEXT,
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, policy_version),
  FOREIGN KEY (artifact_id)
    REFERENCES session_artifacts(artifact_id)
    ON DELETE CASCADE
);
