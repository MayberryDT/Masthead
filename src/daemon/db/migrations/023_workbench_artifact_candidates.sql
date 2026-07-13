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
  origin TEXT NOT NULL DEFAULT 'automatic',
  status TEXT NOT NULL DEFAULT 'pending',
  dismissal_reason TEXT,
  dismissal_evidence_refs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN ('runbook', 'adr', 'incident_timeline')),
  CHECK (origin IN ('automatic', 'proposal')),
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

CREATE TABLE workbench_artifact_candidate_provenance (
  candidate_id TEXT NOT NULL REFERENCES workbench_artifact_candidates(candidate_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (candidate_id, session_id),
  UNIQUE (candidate_id, position),
  CHECK (position >= 0)
);

CREATE INDEX idx_workbench_candidate_provenance_session
  ON workbench_artifact_candidate_provenance(session_id, candidate_id);

CREATE TRIGGER workbench_candidate_provenance_insert
AFTER INSERT ON workbench_artifact_candidates
BEGIN
  INSERT INTO workbench_artifact_candidate_provenance (candidate_id, session_id, position)
  SELECT NEW.candidate_id, value, CAST(key AS INTEGER)
  FROM json_each(NEW.provenance_session_ids_json);
END;

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

CREATE TRIGGER workbench_candidate_session_hard_delete
BEFORE DELETE ON sessions
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT DISTINCT remaining.session_id, 1
  FROM workbench_artifact_candidate_provenance deleted
  JOIN workbench_artifact_candidate_provenance remaining
    ON remaining.candidate_id = deleted.candidate_id
  WHERE deleted.session_id = OLD.session_id
    AND remaining.session_id <> OLD.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;

  UPDATE workbench_artifact_candidates
  SET provenance_session_ids_json = (
    SELECT json_group_array(session_id)
    FROM (
      SELECT session_id
      FROM workbench_artifact_candidate_provenance
      WHERE candidate_id = workbench_artifact_candidates.candidate_id
        AND session_id <> OLD.session_id
      ORDER BY position
    )
  )
  WHERE seed_session_id <> OLD.session_id
    AND candidate_id IN (
      SELECT candidate_id
      FROM workbench_artifact_candidate_provenance
      WHERE session_id = OLD.session_id
    );

  UPDATE workbench_artifact_candidates
  SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
  WHERE status IN ('pending', 'claimed', 'published')
    AND candidate_id IN (
      SELECT candidate_id
      FROM workbench_artifact_candidate_provenance
      WHERE session_id = OLD.session_id
    );
END;

CREATE TRIGGER workbench_candidate_session_soft_delete
AFTER UPDATE OF deleted_at ON sessions
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  SELECT DISTINCT remaining.session_id, 1
  FROM workbench_artifact_candidate_provenance deleted
  JOIN workbench_artifact_candidate_provenance remaining
    ON remaining.candidate_id = deleted.candidate_id
  WHERE deleted.session_id = NEW.session_id
    AND remaining.session_id <> NEW.session_id
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;

  UPDATE workbench_artifact_candidates
  SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
  WHERE status IN ('pending', 'claimed', 'published')
    AND candidate_id IN (
      SELECT candidate_id
      FROM workbench_artifact_candidate_provenance
      WHERE session_id = NEW.session_id
    );

  DELETE FROM workbench_artifact_candidate_signature_members
  WHERE session_id = NEW.session_id;
END;

CREATE TRIGGER workbench_candidate_session_undelete
AFTER UPDATE OF deleted_at ON sessions
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO workbench_artifact_candidate_source_revisions (session_id, source_revision)
  VALUES (NEW.session_id, 1)
  ON CONFLICT(session_id) DO UPDATE SET source_revision = source_revision + 1;
END;
