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

The packaged Electron app uses its app-specific user-data directory as `MASTHEAD_DATA_DIR`.

Tests may still set `MASTHEAD_DB_PATH` and `MASTHEAD_STORE_PATH` directly. Runtime code should prefer `MASTHEAD_DATA_DIR` so the daemon, UI launch flow, and MCP launch config refer to the same database identity.

Only one writable daemon may own a canonical SQLite database path. The owner writes `<database-path>.lock`; a second writable daemon targeting the same database fails with a database ownership diagnostic even when it uses another data directory or a normalized path alias. Different databases may be served from the same data directory. Read-only bridges do not open SQLite for writing and do not take the writer lock.

## Ownership

`masthead.sqlite` is the canonical Masthead store. It owns imported session records, aliases, source status, import jobs, search indexes, enrichments, settings, data-lifecycle summaries, and MCP audit rows.

Source harness files remain owned by their source harnesses. Focused source histories are inputs to discovery and import, not Masthead-owned runtime state. Legacy NDJSON journals are compatibility and migration inputs only.

## Runtime Flow

```text
Supported source files/hooks
  -> source discovery and import
  -> canonical SQLite session graph
  -> Logbook/search, Now projection, Sources, Settings
  -> read-only MCP retrieval and audit rows
```

Write-capable daemon endpoints such as `/ingest`, `/imports`, `/data/delete`, `/data/retention/default`, and source policy updates are local daemon operations. MCP remains read-only and reads from the active database path supplied by `MASTHEAD_DB_PATH`.

## Bridges

`npm run dev` chooses a safe mode:

- Primary mode starts a writable daemon and UI.
- Bridge mode starts a read-only worktree bridge to an already healthy primary daemon.

The bridge should forward canonical read APIs and reject writes. It is for testing secondary UI worktrees without mutating the primary connector store.
