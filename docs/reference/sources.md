# Sources

Sources is Masthead's local connector surface. It discovers local agent-history stores, connects selected sources, queues imports, and feeds the canonical SQLite session graph used by Board, Logbook, and MCP.

## Scan This Computer

`Scan this computer` checks known local history locations for Codex, Cursor, Claude Code, Antigravity, OpenCode, Aider, OpenClaw, Hermes, and Pi.

The scan is read-only. It checks known app data directories, known CLI home directories, supported environment overrides, and future user-added custom locations. It does not perform an unbounded recursive home-directory crawl.

## Connect Selected

`Connect selected` persists selected source inventory and queues metadata import jobs for recognized local sources. Import jobs are isolated per source so one missing, locked, unreadable, or unrecognized source does not block the rest.

Detected but unrecognized schemas produce diagnostics such as:

```text
Detected, import blocked: schema not recognized.
```

They must not create fake successful transcript sessions.

## Import Transcripts

Transcript import is opt-in. Users must explicitly enable transcript import before Masthead queues transcript import jobs.

This approval boundary exists because transcripts may contain sensitive prompts, private code, secrets, customer data, or proprietary operational detail.

## Sync Connected

`Sync connected` queues import work for selected connected adapters using the same per-source import isolation as connect/import actions.
