# Live Connectors

Live connectors feed Masthead's canonical local session database. The Now view, Logbook, search, dossiers, usage summaries, and read-only MCP access are downstream views over that collected data.

## Release Targets

The release target live connector set is:

- Codex
- Claude Code
- Cursor
- Grok Build
- Oh My Pi
- OpenCode

Each live event is normalized with a runtime-scoped session identity. Canonical session IDs include host, runtime, and source session ID, so `sessionId: abc` from Claude Code and `sessionId: abc` from Grok Build remain distinct sessions.

## Install And Test

The compatibility endpoint still manages the whole release connector set:

```text
POST /settings/hooks/codex/install
POST /settings/hooks/codex/test
POST /settings/hooks/codex/uninstall
```

Runtime-specific endpoints are also available:

```text
GET  /settings/hooks
GET  /settings/hooks/:runtime
POST /settings/hooks/:runtime/install
POST /settings/hooks/:runtime/test
POST /settings/hooks/:runtime/uninstall
```

Supported runtime path parameters are `codex`, `claude_code`, `cursor`, `grok`, `omp`, and `opencode`.

## Connector Forms

Codex, Claude Code, and Grok Build use command hook JSON files. Masthead preserves unrelated hook groups, installs Masthead command hooks for required lifecycle/tool events, repairs stale Masthead commands, and removes only Masthead-managed commands during uninstall.

Cursor uses `~/.cursor/hooks.json` with `version: 1` and flat command entries per event. Masthead preserves unrelated Cursor commands and removes only commands containing the Masthead hook helper marker.

OpenCode uses a generated plugin file at `~/.config/opencode/plugins/masthead-live.js`. Masthead uninstalls only that generated plugin file after verifying its marker.

Oh My Pi uses a generated extension file at `~/.omp/agent/extensions/masthead-live.js`. The extension posts bounded lifecycle, input-summary, approval, tool, and stop metadata to Masthead. Masthead uninstalls only that generated extension file after verifying its marker.

## Privacy

The live hook helper redacts known secret-like values before forwarding payloads. Full transcript import remains governed by Sources transcript approval. Live events may create canonical sessions and low-volume runtime signals before transcript import is approved.

## Verification

Useful checks:

```bash
npm run smoke:live
npm run doctor
npm run doctor:json
```

`smoke:live` posts synthetic events for all six target runtimes and verifies distinct canonical sessions. Doctor reports the live connector status returned by `/settings/hooks` and keeps the older strict Codex hook-file check for local hook ownership problems.
