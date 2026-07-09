-- Artifact-first Logbook: multi-session knowledge artifacts, per-artifact publish, pipeline resolution.

-- Capsule / publication / lineage fields on session_artifacts
ALTER TABLE session_artifacts ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'applied';
ALTER TABLE session_artifacts ADD COLUMN signature_key TEXT;
ALTER TABLE session_artifacts ADD COLUMN lineage_id TEXT;
ALTER TABLE session_artifacts ADD COLUMN summary TEXT;
ALTER TABLE session_artifacts ADD COLUMN highlight TEXT;
ALTER TABLE session_artifacts ADD COLUMN confidence TEXT;
ALTER TABLE session_artifacts ADD COLUMN project_label TEXT;
ALTER TABLE session_artifacts ADD COLUMN join_rationale TEXT;
ALTER TABLE session_artifacts ADD COLUMN published_at TEXT;

-- Lineage defaults to self for existing rows
UPDATE session_artifacts SET lineage_id = artifact_id WHERE lineage_id IS NULL;

-- Evolve bug_fix_trace → runbook (no parallel dual vocabulary)
UPDATE session_artifacts SET artifact_kind = 'runbook' WHERE artifact_kind = 'bug_fix_trace';
UPDATE session_artifacts SET schema_version = 'runbook-v1' WHERE schema_version = 'bug_fix_trace-v1';

CREATE TABLE IF NOT EXISTS session_artifact_provenance (
  artifact_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (artifact_id, session_id),
  FOREIGN KEY (artifact_id) REFERENCES session_artifacts(artifact_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Backfill single-session provenance from existing artifacts
INSERT OR IGNORE INTO session_artifact_provenance (artifact_id, session_id)
SELECT artifact_id, session_id FROM session_artifacts;

CREATE INDEX IF NOT EXISTS idx_session_artifacts_published
  ON session_artifacts(publication_status, artifact_kind, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_artifacts_signature
  ON session_artifacts(artifact_kind, signature_key, status)
  WHERE signature_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_artifact_provenance_session
  ON session_artifact_provenance(session_id, artifact_id);

-- Pipeline: automatic kind set + resolution (compile-ready / automatic work resolved)
ALTER TABLE workbench_session_state ADD COLUMN runbook_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE workbench_session_state ADD COLUMN adr_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE workbench_session_state ADD COLUMN incident_timeline_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE workbench_session_state ADD COLUMN session_package_status TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE workbench_session_state ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'in_progress';

-- Map legacy bug-fix trace status into runbook_status
UPDATE workbench_session_state SET runbook_status = bug_fix_trace_status;

-- Session package satisfied when enrichment + dossier already satisfied
UPDATE workbench_session_state
SET session_package_status = 'applied'
WHERE session_enrichment_status = 'satisfied'
  AND session_dossier_status = 'satisfied';

UPDATE workbench_session_state
SET session_package_status = 'published'
WHERE publication_status = 'published'
  AND session_enrichment_status = 'satisfied'
  AND session_dossier_status = 'satisfied';

-- Legacy published sessions are not auto-marked automatic_resolved for new kinds (adr/timeline remain unknown until re-compile or cutover wipe).
