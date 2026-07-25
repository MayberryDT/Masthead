CREATE TABLE workbench_authoring_v5_request_preparations (
  request_id TEXT PRIMARY KEY,
  creation_token TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  creation_instance_id TEXT NOT NULL,
  instance_manifest TEXT NOT NULL,
  base_url TEXT NOT NULL,
  database_id TEXT NOT NULL,
  build_sha TEXT NOT NULL,
  requested_session_ids_json TEXT NOT NULL,
  readiness_json TEXT NOT NULL,
  evidence_cutoffs_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing','ready','failed')),
  selection_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE workbench_authoring_v5_preparation_sessions (
  request_id TEXT NOT NULL REFERENCES workbench_authoring_v5_request_preparations(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('eligible','excluded')),
  exclusion_reason TEXT,
  session_digest TEXT,
  PRIMARY KEY (request_id, session_id),
  UNIQUE (request_id, ordinal)
);

CREATE TABLE workbench_authoring_v5_preparation_evidence_pages (
  request_id TEXT NOT NULL REFERENCES workbench_authoring_v5_request_preparations(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  page_ordinal INTEGER NOT NULL,
  item_offset INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  usable_evidence INTEGER NOT NULL CHECK (usable_evidence IN (0, 1)),
  page_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (request_id, session_id, page_ordinal),
  UNIQUE (request_id, session_id, item_offset)
);

CREATE INDEX idx_authoring_v5_preparation_status
  ON workbench_authoring_v5_request_preparations(status, updated_at);

ALTER TABLE workbench_authoring_v5_evidence_snapshots
  RENAME TO workbench_authoring_v5_evidence_snapshots_v38;

CREATE TABLE workbench_authoring_v5_evidence_snapshots (
  request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_digest TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, session_id)
);

INSERT INTO workbench_authoring_v5_evidence_snapshots (
  request_id, session_id, session_digest, evidence_json, created_at
)
SELECT request_id, session_id, session_digest, evidence_json, created_at
FROM workbench_authoring_v5_evidence_snapshots_v38;

DROP TABLE workbench_authoring_v5_evidence_snapshots_v38;

CREATE TRIGGER delete_authoring_v5_snapshots_with_request
AFTER DELETE ON workbench_authoring_v5_requests
BEGIN
  DELETE FROM workbench_authoring_v5_evidence_snapshots WHERE request_id = OLD.request_id;
  DELETE FROM workbench_authoring_v5_request_preparations WHERE request_id = OLD.request_id;
END;

CREATE TRIGGER delete_authoring_v5_snapshots_with_preparation
AFTER DELETE ON workbench_authoring_v5_request_preparations
WHEN NOT EXISTS (
  SELECT 1 FROM workbench_authoring_v5_requests WHERE request_id = OLD.request_id
)
BEGIN
  DELETE FROM workbench_authoring_v5_evidence_snapshots WHERE request_id = OLD.request_id;
END;

CREATE TRIGGER freeze_authoring_v5_messages_update
BEFORE UPDATE ON messages
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.messages') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_messages_delete
BEFORE DELETE ON messages
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.messages') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_tool_calls_update
BEFORE UPDATE ON tool_calls
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.toolCalls') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_tool_calls_delete
BEFORE DELETE ON tool_calls
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.toolCalls') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_tool_results_update
BEFORE UPDATE ON tool_results
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.toolResults') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_tool_results_delete
BEFORE DELETE ON tool_results
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.toolResults') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_file_effects_update
BEFORE UPDATE ON file_effects
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.fileEffects') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_file_effects_delete
BEFORE DELETE ON file_effects
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.fileEffects') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_checkpoints_update
BEFORE UPDATE ON checkpoints
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.checkpoints') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_checkpoints_delete
BEFORE DELETE ON checkpoints
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.checkpoints') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_runtime_signals_update
BEFORE UPDATE ON runtime_signals
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.runtimeSignals') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;

CREATE TRIGGER freeze_authoring_v5_runtime_signals_delete
BEFORE DELETE ON runtime_signals
WHEN EXISTS (
  SELECT 1 FROM workbench_authoring_v5_request_preparations AS preparation,
    json_each(preparation.requested_session_ids_json) AS selected
  WHERE (preparation.status = 'preparing' OR (
      preparation.status = 'failed' AND COALESCE(preparation.error_code, '') <> 'authoring_v5_no_eligible_sessions'
    )) AND selected.value = OLD.session_id
    AND OLD.rowid <= CAST(json_extract(preparation.evidence_cutoffs_json, '$.runtimeSignals') AS INTEGER)
)
BEGIN SELECT RAISE(ABORT, 'authoring_v5_evidence_frozen'); END;
