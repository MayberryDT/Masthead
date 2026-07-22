ALTER TABLE guided_authoring_requests
  ADD COLUMN contract_version TEXT NOT NULL DEFAULT 'workbench-authoring-v4'
  CHECK (contract_version IN ('workbench-authoring-v4', 'workbench-authoring-v5'));
