CREATE TABLE workbench_authoring_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  bundle_json TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (status IN ('open', 'needs_revision', 'ready_to_finish', 'completed'))
);

CREATE TABLE workbench_authoring_run_sessions (
  run_id TEXT NOT NULL REFERENCES workbench_authoring_runs(run_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES workbench_claims(claim_id),
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (run_id, session_id)
);

CREATE INDEX idx_workbench_authoring_run_status
  ON workbench_authoring_runs(status, updated_at DESC);

CREATE INDEX idx_workbench_authoring_run_session
  ON workbench_authoring_run_sessions(session_id, run_id);

UPDATE workbench_session_state
SET runbook_status = CASE
      WHEN runbook_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'runbook'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN runbook_status = 'satisfied' THEN 'applied'
      ELSE runbook_status
    END,
    adr_status = CASE
      WHEN adr_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'adr'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN adr_status = 'satisfied' THEN 'applied'
      ELSE adr_status
    END,
    incident_timeline_status = CASE
      WHEN incident_timeline_status = 'satisfied' AND EXISTS (
        SELECT 1
        FROM session_artifacts
        JOIN session_artifact_provenance
          ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
        WHERE session_artifacts.artifact_kind = 'incident_timeline'
          AND session_artifacts.status = 'current'
          AND session_artifacts.publication_status = 'published'
          AND session_artifact_provenance.session_id = workbench_session_state.session_id
      ) THEN 'published'
      WHEN incident_timeline_status = 'satisfied' THEN 'applied'
      ELSE incident_timeline_status
    END;
