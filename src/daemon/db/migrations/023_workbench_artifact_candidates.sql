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

CREATE TABLE workbench_artifact_candidate_scans (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  evidence_revision TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (session_id, evidence_revision)
);

CREATE INDEX idx_workbench_candidate_scans_session_time
  ON workbench_artifact_candidate_scans(session_id, scanned_at DESC);
