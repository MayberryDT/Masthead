CREATE TABLE IF NOT EXISTS workbench_session_state (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  publication_status TEXT NOT NULL DEFAULT 'publish_path',
  next_action TEXT NOT NULL DEFAULT 'check_transcript',
  transcript_status TEXT NOT NULL DEFAULT 'unchecked',
  quality_status TEXT NOT NULL DEFAULT 'unchecked',
  session_enrichment_status TEXT NOT NULL DEFAULT 'missing',
  session_dossier_status TEXT NOT NULL DEFAULT 'missing',
  bug_fix_trace_status TEXT NOT NULL DEFAULT 'unknown',
  non_publication_reason TEXT,
  published_at TEXT,
  published_activity_id TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (publication_status IN ('publish_path', 'published', 'not_added_to_logbook')),
  CHECK (next_action IN ('check_transcript', 'import_transcript', 'review_quality', 'enrich', 'create_dossier', 'publish', 'active', 'blocked', 'none')),
  CHECK (transcript_status IN ('unchecked', 'available', 'imported', 'missing', 'permission_needed')),
  CHECK (quality_status IN ('unchecked', 'passed', 'failed')),
  CHECK (session_enrichment_status IN ('missing', 'satisfied')),
  CHECK (session_dossier_status IN ('missing', 'satisfied')),
  CHECK (bug_fix_trace_status IN ('unknown', 'required', 'satisfied', 'not_applicable'))
);

CREATE TABLE IF NOT EXISTS workbench_activity (
  activity_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  related_run_id TEXT,
  related_claim_id TEXT
);

CREATE TABLE IF NOT EXISTS workbench_claims (
  claim_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  claim_kind TEXT NOT NULL DEFAULT 'publish_path',
  claimed_by TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT,
  CHECK (claim_kind IN ('publish_path'))
);

CREATE INDEX IF NOT EXISTS idx_workbench_session_state_publication
  ON workbench_session_state(publication_status, next_action, updated_at);

CREATE INDEX IF NOT EXISTS idx_workbench_activity_session_time
  ON workbench_activity(session_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_workbench_activity_type_time
  ON workbench_activity(event_type, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_workbench_claims_active
  ON workbench_claims(session_id, expires_at)
  WHERE released_at IS NULL;
