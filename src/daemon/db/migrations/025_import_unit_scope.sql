ALTER TABLE import_manifests ADD COLUMN capped_units INTEGER NOT NULL DEFAULT 0;

ALTER TABLE import_work_units ADD COLUMN semantic_activity_at TEXT;
ALTER TABLE import_work_units ADD COLUMN timestamp_basis TEXT NOT NULL DEFAULT 'unknown'
  CHECK (timestamp_basis IN ('semantic', 'source_path', 'file_modified', 'unknown'));
ALTER TABLE import_work_units ADD COLUMN scope_reason TEXT;
