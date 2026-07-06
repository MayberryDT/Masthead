# Live Connectors

Live connectors feed Masthead's canonical local session database. The Now view, Logbook, search, dossiers, usage summaries, and read-only MCP access are downstream views over that collected data.

## Release Targets

The release target live connector set is:

- Claude Code
- Cursor
- Grok Build
- Hermes
- Pi
- Oh My Pi
- OpenCode

Each live event is normalized with a runtime-scoped session identity. Canonical session IDs include host, runtime, and source session ID, so `sessionId: abc` from Claude Code and `sessionId: abc` from Grok Build remain distinct sessions.

## Install And Test

The aggregate endpoint manages the full focused connector set:

```text
GET  /settings/hooks
POST /settings/hooks/:runtime/install
POST /settings/hooks/:runtime/test
POST /settings/hooks/:runtime/uninstall
```

Runtime-specific endpoints are also available:

```text
GET  /settings/hooks
GET  /settings/hooks/:runtime
POST /settings/hooks/:runtime/install
POST /settings/hooks/:runtime/test
POST /settings/hooks/:runtime/uninstall
```

Supported runtime path parameters are `claude_code`, `cursor`, `grok`, `opencode`, `omp`, `pi`, and `hermes`.

## Connector Forms

Claude Code and Grok Build use command hook JSON files. Masthead preserves unrelated hook groups, installs Masthead command hooks for required lifecycle/tool events, repairs stale Masthead commands, and removes only Masthead-managed commands during uninstall.

Cursor uses `~/.cursor/hooks.json` with `version: 1` and flat command entries per event. Masthead preserves unrelated Cursor commands and removes only commands containing the Masthead hook helper marker.

OpenCode uses a generated plugin file at `~/.config/opencode/plugins/masthead-live.js`. Masthead uninstalls only that generated plugin file after verifying its marker.

Oh My Pi, Pi, and Hermes use generated extension/plugin files. Each posts bounded lifecycle, input-summary, approval, tool, and stop metadata to Masthead. Masthead uninstalls only generated files after verifying their markers.

## Privacy

The live hook helper redacts known secret-like values before forwarding payloads. Full transcript import remains governed by Sources transcript approval. Live events may create canonical sessions and low-volume runtime signals before transcript import is approved.

## Verification

Useful checks:

```bash
npm run smoke:live
npm run doctor
npm run doctor:json
```

`smoke:live` posts synthetic events for all seven target runtimes and verifies distinct canonical sessions. Doctor reports the live connector status returned by `/settings/hooks`.
