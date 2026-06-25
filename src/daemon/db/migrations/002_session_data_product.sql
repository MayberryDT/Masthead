CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  setting_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_policies (
  source_policy_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  policy_kind TEXT NOT NULL CHECK (
    policy_kind IN ('metadata_import', 'transcript_import', 'mcp_access', 'enrichment')
  ),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  decided_at TEXT NOT NULL,
  reason TEXT,
  UNIQUE (source_id, policy_kind)
);

CREATE TABLE IF NOT EXISTS legacy_migrations (
  migration_key TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);
