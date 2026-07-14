ALTER TABLE workbench_artifact_candidate_scans
ADD COLUMN detector_revision INTEGER NOT NULL DEFAULT 1
CHECK (detector_revision >= 1);

-- Optional artifacts are candidate-driven. A published canonical dossier is a
-- complete session package even when no optional candidate exists.
UPDATE workbench_session_state
SET next_action = 'none',
    resolution_status = 'automatic_resolved'
WHERE publication_status = 'published'
  AND session_package_status = 'published';
