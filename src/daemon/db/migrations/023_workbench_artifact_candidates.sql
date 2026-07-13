CREATE TABLE workbench_artifact_candidates (
  candidate_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  seed_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  provenance_session_ids_json TEXT NOT NULL,
  signal_evidence_refs_json TEXT NOT NULL,
  signal_summary TEXT NOT NULL,
  signature_key TEXT,
  evidence_revision TEXT NOT NULL,
  supersedes_candidate_id TEXT REFERENCES workbench_artifact_candidates(candidate_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  dismissal_reason TEXT,
  dismissal_evidence_refs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN ('runbook', 'adr', 'incident_timeline')),
  CHECK (status IN ('pending', 'claimed', 'published', 'dismissed', 'superseded')),
  CHECK (json_valid(provenance_session_ids_json)),
  CHECK (json_array_length(provenance_session_ids_json) BETWEEN 1 AND 12),
  CHECK (json_valid(signal_evidence_refs_json)),
  CHECK (json_array_length(signal_evidence_refs_json) > 0),
  CHECK (dismissal_evidence_refs_json IS NULL OR json_valid(dismissal_evidence_refs_json)),
  CHECK (
    status <> 'dismissed' OR (
      LENGTH(TRIM(COALESCE(dismissal_reason, ''))) >= 12
      AND json_array_length(COALESCE(dismissal_evidence_refs_json, '[]')) > 0
    )
  )
);

CREATE UNIQUE INDEX idx_workbench_candidates_current_signature
  ON workbench_artifact_candidates(kind, signature_key)
  WHERE signature_key IS NOT NULL AND status IN ('pending', 'claimed', 'published');

CREATE UNIQUE INDEX idx_workbench_candidates_current_session
  ON workbench_artifact_candidates(kind, seed_session_id)
  WHERE signature_key IS NULL AND status IN ('pending', 'claimed', 'published');

CREATE INDEX idx_workbench_candidates_status_updated
  ON workbench_artifact_candidates(status, updated_at DESC, candidate_id);

CREATE INDEX idx_workbench_candidates_lineage
  ON workbench_artifact_candidates(supersedes_candidate_id);

CREATE TABLE workbench_artifact_candidate_signature_members (
  kind TEXT NOT NULL,
  signature_key TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  evidence_revision TEXT NOT NULL,
  signal_evidence_refs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, signature_key, session_id),
  CHECK (kind IN ('runbook', 'adr', 'incident_timeline')),
  CHECK (json_valid(signal_evidence_refs_json)),
  CHECK (json_array_length(signal_evidence_refs_json) > 0)
);

CREATE INDEX idx_workbench_signature_members_session
  ON workbench_artifact_candidate_signature_members(session_id, kind, signature_key);

CREATE TABLE workbench_artifact_candidate_source_revisions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL DEFAULT 0,
  CHECK (source_revision >= 0)
);

INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
SELECT session_id, 0 FROM sessions;

CREATE TABLE workbench_artifact_candidate_scans (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  evidence_revision TEXT NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (session_id, source_revision),
  CHECK (source_revision >= 0)
);

CREATE INDEX idx_workbench_candidate_scans_session_time
  ON workbench_artifact_candidate_scans(session_id, scanned_at DESC);

CREATE TRIGGER workbench_candidate_messages_insert_revision
AFTER INSERT ON messages
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_messages_update_revision
AFTER UPDATE ON messages
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_messages_delete_revision
AFTER DELETE ON messages
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_calls_insert_revision
AFTER INSERT ON tool_calls
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_calls_update_revision
AFTER UPDATE ON tool_calls
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_calls_delete_revision
AFTER DELETE ON tool_calls
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_results_insert_revision
AFTER INSERT ON tool_results
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_results_update_revision
AFTER UPDATE ON tool_results
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_tool_results_delete_revision
AFTER DELETE ON tool_results
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_checkpoints_insert_revision
AFTER INSERT ON checkpoints
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_checkpoints_update_revision
AFTER UPDATE ON checkpoints
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_checkpoints_delete_revision
AFTER DELETE ON checkpoints
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_runtime_signals_insert_revision
AFTER INSERT ON runtime_signals
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_runtime_signals_update_revision
AFTER UPDATE ON runtime_signals
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_runtime_signals_delete_revision
AFTER DELETE ON runtime_signals
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_file_effects_insert_revision
AFTER INSERT ON file_effects
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_file_effects_update_revision
AFTER UPDATE ON file_effects
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (OLD.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT NEW.session_id, 1 WHERE NEW.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;

CREATE TRIGGER workbench_candidate_file_effects_delete_revision
AFTER DELETE ON file_effects
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT OLD.session_id, 1 WHERE EXISTS (SELECT 1 FROM sessions WHERE session_id = OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;
