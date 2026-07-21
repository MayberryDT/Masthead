CREATE TABLE guided_authoring_enrichment_provenance (
  enrichment_id TEXT NOT NULL CHECK (length(trim(enrichment_id)) > 0),
  request_id TEXT NOT NULL CHECK (length(trim(request_id)) > 0),
  assignment_id TEXT NOT NULL CHECK (length(trim(assignment_id)) > 0),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  draft_revision INTEGER NOT NULL CHECK (typeof(draft_revision) = 'integer' AND draft_revision > 0),
  evidence_revision TEXT NOT NULL CHECK (length(trim(evidence_revision)) > 0),
  policy_version TEXT NOT NULL CHECK (policy_version = 'guided-authoring-v1'),
  source TEXT NOT NULL CHECK (source = 'guided_authoring'),
  applied_at TEXT NOT NULL CHECK (length(trim(applied_at)) > 0),
  PRIMARY KEY (enrichment_id, assignment_id),
  FOREIGN KEY (enrichment_id) REFERENCES session_enrichments(enrichment_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id, request_id, session_id)
    REFERENCES guided_authoring_assignment_sessions(assignment_id, request_id, session_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_guided_enrichment_provenance_assignment
  ON guided_authoring_enrichment_provenance(assignment_id, session_id, enrichment_id);
