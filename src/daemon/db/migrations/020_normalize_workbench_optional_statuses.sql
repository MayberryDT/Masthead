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
