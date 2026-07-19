CREATE TABLE session_search_rowids (
  search_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE
);

DELETE FROM session_search
WHERE rowid NOT IN (
  SELECT MAX(session_search.rowid)
  FROM session_search
  JOIN sessions ON sessions.session_id = session_search.session_id
  GROUP BY session_search.session_id
);

INSERT INTO session_search_rowids(search_rowid, session_id)
SELECT rowid, session_id
FROM session_search
WHERE session_id IS NOT NULL;

CREATE INDEX idx_workbench_activity_time
ON workbench_activity(event_at DESC, activity_id DESC);
