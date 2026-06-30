CREATE INDEX IF NOT EXISTS sessions_source_session_idx ON sessions(source_session_id);
CREATE INDEX IF NOT EXISTS session_enrichments_current_kind_session_idx
  ON session_enrichments(status, enrichment_kind, session_id);
