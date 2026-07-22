CREATE TABLE workbench_authoring_v5_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  creation_instance_id TEXT NOT NULL,
  instance_manifest TEXT NOT NULL,
  base_url TEXT NOT NULL,
  database_id TEXT NOT NULL,
  build_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','active','completed','cancelled')),
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE workbench_authoring_v5_request_sessions (
  request_id TEXT NOT NULL REFERENCES workbench_authoring_v5_requests(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','assigned','published','soft_flagged','rejected')),
  PRIMARY KEY (request_id, session_id)
);

CREATE TABLE workbench_authoring_v5_packs (
  pack_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES workbench_authoring_v5_requests(request_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','available','active','saved','completed')),
  evidence_revision TEXT NOT NULL,
  current_draft_revision INTEGER NOT NULL DEFAULT 0,
  draft_json TEXT,
  outcomes_json TEXT,
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (request_id, ordinal),
  UNIQUE (pack_id, request_id)
);

CREATE TABLE workbench_authoring_v5_pack_sessions (
  pack_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (pack_id, session_id),
  UNIQUE (pack_id, request_id, session_id),
  FOREIGN KEY (pack_id, request_id) REFERENCES workbench_authoring_v5_packs(pack_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, session_id) REFERENCES workbench_authoring_v5_request_sessions(request_id, session_id) ON DELETE CASCADE
);

CREATE TABLE workbench_authoring_v5_evidence_access (
  pack_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, session_id, evidence_revision, evidence_ref),
  FOREIGN KEY (pack_id, request_id, session_id) REFERENCES workbench_authoring_v5_pack_sessions(pack_id, request_id, session_id) ON DELETE CASCADE
);

CREATE INDEX idx_authoring_v5_request_status ON workbench_authoring_v5_requests(status, updated_at DESC);
CREATE INDEX idx_authoring_v5_pack_request ON workbench_authoring_v5_packs(request_id, ordinal);
