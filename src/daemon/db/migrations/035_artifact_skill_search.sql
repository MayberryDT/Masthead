DROP TABLE session_artifact_search;

CREATE VIRTUAL TABLE session_artifact_search USING fts5(
  artifact_id UNINDEXED,
  title,
  summary,
  keywords,
  highlight,
  project,
  body
);

INSERT INTO session_artifact_search (
  artifact_id,
  title,
  summary,
  keywords,
  highlight,
  project,
  body
)
SELECT
  artifact_id,
  COALESCE(title, ''),
  COALESCE(summary, ''),
  COALESCE((
    SELECT group_concat(keyword.value, ' ')
    FROM json_each(session_artifacts.content_json, '$.durableEnrichment.keywords') AS keyword
    WHERE keyword.type = 'text'
  ), ''),
  COALESCE(highlight, ''),
  COALESCE(project_label, ''),
  content_json
FROM session_artifacts
WHERE status = 'current' AND publication_status = 'published';
