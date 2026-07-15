ALTER TABLE workbench_session_state ADD COLUMN suppression_category TEXT
  CHECK (suppression_category IN ('confirmed_noise', 'insufficient_evidence', 'manual_exclusion'));

ALTER TABLE workbench_session_state ADD COLUMN quality_decision_source TEXT NOT NULL DEFAULT 'automatic'
  CHECK (quality_decision_source IN ('automatic', 'user'));

ALTER TABLE workbench_session_state ADD COLUMN quality_evidence_revision TEXT;

UPDATE workbench_session_state
SET suppression_category = 'confirmed_noise',
    quality_decision_source = 'automatic'
WHERE publication_status = 'not_added_to_logbook'
  AND non_publication_reason IN (
    'hook_only',
    'empty',
    'diagnostic_only',
    'exact_duplicate'
  );

UPDATE workbench_session_state
SET suppression_category = 'manual_exclusion', quality_decision_source = 'user'
WHERE publication_status = 'not_added_to_logbook'
  AND COALESCE(non_publication_reason, '') NOT IN (
    'no_messages',
    'hook_only',
    'metadata_only',
    'duplicate_noise',
    'low_evidence',
    'missing_identity',
    'empty',
    'diagnostic_only',
    'exact_duplicate'
  )
  AND (
    non_publication_reason = 'user_suppressed'
    OR EXISTS (
      SELECT 1
      FROM workbench_activity
      WHERE workbench_activity.session_id = workbench_session_state.session_id
        AND workbench_activity.actor_kind = 'user'
        AND workbench_activity.event_type IN ('quality_failed', 'not_added_to_logbook')
    )
  );

UPDATE workbench_session_state
SET publication_status = 'publish_path',
    next_action = 'review_quality',
    quality_status = 'unchecked',
    suppression_category = 'insufficient_evidence',
    quality_decision_source = 'automatic'
WHERE publication_status = 'not_added_to_logbook'
  AND quality_decision_source = 'automatic'
  AND COALESCE(non_publication_reason, '') NOT IN (
    'hook_only',
    'empty',
    'diagnostic_only',
    'exact_duplicate'
  );
