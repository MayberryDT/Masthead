CREATE TABLE guided_authoring_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  creation_instance_id TEXT NOT NULL,
  instance_manifest TEXT NOT NULL,
  base_url TEXT NOT NULL,
  database_id TEXT NOT NULL,
  build_sha TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','awaiting_canary_approval','active','completed','cancelled')),
  canary_approved_at TEXT,
  canary_approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE guided_authoring_request_sessions (
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  group_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','assigned','completed','excluded')),
  excluded_reason TEXT,
  PRIMARY KEY (request_id, session_id)
);

CREATE TABLE guided_authoring_opportunities (
  opportunity_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  suggested_kind TEXT NOT NULL CHECK (suggested_kind IN ('runbook','adr','incident_timeline')),
  signal_strength TEXT NOT NULL CHECK (signal_strength IN ('high','medium')),
  summary TEXT NOT NULL,
  signature_key TEXT,
  evidence_refs_json TEXT NOT NULL,
  provenance_session_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, opportunity_id)
);

CREATE TABLE guided_authoring_assignments (
  assignment_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('investigating','drafting','needs_revision','ready_to_finish','staged_canary','completed')),
  canary INTEGER NOT NULL CHECK (canary IN (0,1)),
  evidence_revision TEXT NOT NULL,
  current_draft_revision INTEGER NOT NULL DEFAULT 0,
  accepted_draft_revision INTEGER,
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (request_id, ordinal),
  UNIQUE (assignment_id, request_id)
);

CREATE TABLE guided_authoring_assignment_sessions (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, session_id),
  UNIQUE (assignment_id, request_id, session_id),
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, session_id) REFERENCES guided_authoring_request_sessions(request_id, session_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_assignment_opportunities (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, opportunity_id),
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, opportunity_id) REFERENCES guided_authoring_opportunities(request_id, opportunity_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_evidence_access (
  assignment_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, session_id, evidence_revision, evidence_ref),
  FOREIGN KEY (assignment_id, request_id, session_id) REFERENCES guided_authoring_assignment_sessions(assignment_id, request_id, session_id) ON DELETE CASCADE
);

CREATE TABLE guided_authoring_draft_reviews (
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  evidence_revision TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (assignment_id, revision)
);

CREATE TABLE guided_authoring_operator_reviews (
  review_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES guided_authoring_requests(request_id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES guided_authoring_assignments(assignment_id) ON DELETE CASCADE,
  draft_revision INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  notes TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id, request_id) REFERENCES guided_authoring_assignments(assignment_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id, draft_revision) REFERENCES guided_authoring_draft_reviews(assignment_id, revision)
);

CREATE INDEX idx_guided_request_status ON guided_authoring_requests(status, updated_at DESC);
CREATE INDEX idx_guided_request_sessions_state ON guided_authoring_request_sessions(request_id, state, ordinal);
CREATE INDEX idx_guided_assignment_request ON guided_authoring_assignments(request_id, ordinal);
CREATE INDEX idx_guided_opportunity_request ON guided_authoring_opportunities(request_id, opportunity_id);
CREATE INDEX idx_guided_operator_review_assignment ON guided_authoring_operator_reviews(assignment_id, reviewed_at, review_id);
CREATE UNIQUE INDEX idx_guided_operator_review_revision ON guided_authoring_operator_reviews(assignment_id, draft_revision);
