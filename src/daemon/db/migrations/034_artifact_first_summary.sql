CREATE INDEX IF NOT EXISTS idx_session_artifacts_current_published_project
  ON session_artifacts(status, publication_status, project_label, published_at);
