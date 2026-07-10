-- Normalize optional-kind states written by legacy V1 code after migration 019 ran.
-- Applied is never resolved; only a current published same-kind artifact earns published.

UPDATE workbench_session_state
SET runbook_status = CASE
      WHEN runbook_status = 'satisfied' THEN CASE
        WHEN EXISTS (
          SELECT 1
          FROM session_artifacts AS artifacts
          JOIN session_artifact_provenance AS provenance
            ON provenance.artifact_id = artifacts.artifact_id
          WHERE artifacts.artifact_kind = 'runbook'
            AND artifacts.status = 'current'
            AND artifacts.publication_status = 'published'
            AND provenance.session_id = workbench_session_state.session_id
        ) THEN 'published'
        ELSE 'applied'
      END
      ELSE runbook_status
    END,
    adr_status = CASE
      WHEN adr_status = 'satisfied' THEN CASE
        WHEN EXISTS (
          SELECT 1
          FROM session_artifacts AS artifacts
          JOIN session_artifact_provenance AS provenance
            ON provenance.artifact_id = artifacts.artifact_id
          WHERE artifacts.artifact_kind = 'adr'
            AND artifacts.status = 'current'
            AND artifacts.publication_status = 'published'
            AND provenance.session_id = workbench_session_state.session_id
        ) THEN 'published'
        ELSE 'applied'
      END
      ELSE adr_status
    END,
    incident_timeline_status = CASE
      WHEN incident_timeline_status = 'satisfied' THEN CASE
        WHEN EXISTS (
          SELECT 1
          FROM session_artifacts AS artifacts
          JOIN session_artifact_provenance AS provenance
            ON provenance.artifact_id = artifacts.artifact_id
          WHERE artifacts.artifact_kind = 'incident_timeline'
            AND artifacts.status = 'current'
            AND artifacts.publication_status = 'published'
            AND provenance.session_id = workbench_session_state.session_id
        ) THEN 'published'
        ELSE 'applied'
      END
      ELSE incident_timeline_status
    END;

UPDATE workbench_session_state
SET bug_fix_trace_status = CASE runbook_status
      WHEN 'unknown' THEN 'unknown'
      WHEN 'required' THEN 'required'
      WHEN 'applied' THEN 'required'
      WHEN 'published' THEN 'satisfied'
      WHEN 'contributed' THEN 'satisfied'
      WHEN 'not_applicable' THEN 'not_applicable'
      ELSE bug_fix_trace_status
    END;

-- Recompute the cached state-machine projection after optional statuses change.
UPDATE workbench_session_state
SET resolution_status = CASE
      WHEN publication_status = 'not_added_to_logbook' THEN 'in_progress'
      WHEN transcript_status NOT IN ('available', 'imported')
        OR quality_status <> 'passed'
        OR session_enrichment_status <> 'satisfied'
        OR session_dossier_status <> 'satisfied'
        THEN 'in_progress'
      WHEN session_package_status = 'published'
        AND runbook_status IN ('published', 'not_applicable', 'contributed')
        AND adr_status IN ('published', 'not_applicable', 'contributed')
        AND incident_timeline_status IN ('published', 'not_applicable', 'contributed')
        THEN 'automatic_resolved'
      ELSE 'compile_ready'
    END,
    next_action = CASE
      WHEN publication_status = 'not_added_to_logbook' THEN 'none'
      WHEN publication_status = 'published' OR session_package_status = 'published' THEN CASE
        WHEN runbook_status IN ('published', 'not_applicable', 'contributed')
          AND adr_status IN ('published', 'not_applicable', 'contributed')
          AND incident_timeline_status IN ('published', 'not_applicable', 'contributed')
          THEN 'none'
        ELSE 'enrich'
      END
      WHEN transcript_status = 'unchecked' THEN 'check_transcript'
      WHEN transcript_status IN ('missing', 'permission_needed') THEN 'import_transcript'
      WHEN quality_status = 'unchecked' THEN 'review_quality'
      WHEN quality_status = 'failed' THEN 'none'
      WHEN session_enrichment_status = 'missing' THEN 'enrich'
      WHEN session_dossier_status = 'missing' THEN 'create_dossier'
      ELSE 'publish'
    END;
