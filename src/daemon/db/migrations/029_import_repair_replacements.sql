CREATE TABLE import_repair_replacements (
  original_import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  replacement_import_job_id TEXT PRIMARY KEY NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_import_repair_replacements_original
  ON import_repair_replacements(original_import_job_id);
