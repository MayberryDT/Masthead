CREATE TABLE masthead_data_revisions (
  scope TEXT PRIMARY KEY CHECK (scope IN ('logbook','workbench')),
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO masthead_data_revisions(scope, revision, updated_at) VALUES
  ('logbook', 0, CURRENT_TIMESTAMP),
  ('workbench', 0, CURRENT_TIMESTAMP);
