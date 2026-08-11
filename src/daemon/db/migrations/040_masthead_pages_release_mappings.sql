CREATE TABLE masthead_pages_release_mappings (
  lineage_id TEXT PRIMARY KEY NOT NULL,
  source_artifact_id TEXT NOT NULL,
  local_content_fingerprint TEXT NOT NULL,
  pages_account_id TEXT NOT NULL,
  public_logbook_id TEXT NOT NULL,
  page_id TEXT,
  object_id TEXT,
  parent_object_id TEXT,
  friendly_url TEXT,
  exact_url TEXT,
  egress_fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('none', 'live', 'failed', 'removed')),
  last_error_class TEXT,
  last_error_message TEXT,
  pending_operation_kind TEXT CHECK (
    pending_operation_kind IS NULL OR pending_operation_kind IN ('publish', 'remove')
  ),
  pending_request_json TEXT,
  pending_request_digest TEXT,
  pending_idempotency_key TEXT,
  pending_staged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  removed_at TEXT,
  CHECK (
    (
      pending_operation_kind IS NULL
      AND pending_request_json IS NULL
      AND pending_request_digest IS NULL
      AND pending_idempotency_key IS NULL
      AND pending_staged_at IS NULL
    )
    OR (
      pending_operation_kind IS NOT NULL
      AND pending_request_json IS NOT NULL
      AND pending_request_digest IS NOT NULL
      AND pending_idempotency_key IS NOT NULL
      AND pending_staged_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_masthead_pages_release_mappings_source_artifact
  ON masthead_pages_release_mappings(source_artifact_id);

CREATE INDEX idx_masthead_pages_release_mappings_page_id
  ON masthead_pages_release_mappings(page_id)
  WHERE page_id IS NOT NULL;
