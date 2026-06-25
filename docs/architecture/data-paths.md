# Masthead Data Paths

Masthead uses one runtime data directory per writable daemon. All local runtime files derive from `MASTHEAD_DATA_DIR`:

```text
<data-dir>/masthead.sqlite
<data-dir>/legacy/events.ndjson
<data-dir>/runtime/
<data-dir>/exports/
<data-dir>/logs/
```

Development defaults:

```text
Linux:   ~/.local/share/masthead-dev
macOS:   ~/Library/Application Support/Masthead Dev
Windows: %LOCALAPPDATA%/Masthead Dev
```

The packaged Tauri app uses its app-data directory as `MASTHEAD_DATA_DIR`.

Tests may still set `MASTHEAD_DB_PATH` and `MASTHEAD_STORE_PATH` directly. Runtime code should prefer `MASTHEAD_DATA_DIR` so the daemon, UI launch flow, and MCP launch config refer to the same database identity.

Only one writable daemon may own a data directory. The owner writes `<data-dir>/runtime/database.lock`; a second writable daemon fails with a database ownership diagnostic. Read-only bridges do not open SQLite for writing and do not take the writer lock.
