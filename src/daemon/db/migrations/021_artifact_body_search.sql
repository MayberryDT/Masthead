CREATE VIRTUAL TABLE session_artifact_search USING fts5(
  artifact_id UNINDEXED,
  title,
  summary,
  highlight,
  project,
  body
);

INSERT INTO session_artifact_search (
  artifact_id,
  title,
  summary,
  highlight,
  project,
  body
)
SELECT
  artifact_id,
  COALESCE(title, ''),
  COALESCE(summary, ''),
  COALESCE(highlight, ''),
  COALESCE(project_label, ''),
  content_json
FROM session_artifacts
WHERE status = 'current' AND publication_status = 'published';
