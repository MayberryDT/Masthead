ALTER TABLE workbench_authoring_runs
  ADD COLUMN contract_version TEXT NOT NULL DEFAULT 'workbench-authoring-v1';

ALTER TABLE workbench_authoring_runs
  ADD COLUMN candidate_id TEXT;

CREATE INDEX idx_workbench_authoring_run_contract_candidate
  ON workbench_authoring_runs(contract_version, candidate_id, status, updated_at DESC);
