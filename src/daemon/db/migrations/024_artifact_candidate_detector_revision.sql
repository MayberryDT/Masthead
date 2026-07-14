ALTER TABLE workbench_artifact_candidate_scans
ADD COLUMN detector_revision INTEGER NOT NULL DEFAULT 1
CHECK (detector_revision >= 1);
