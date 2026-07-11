# Live Connectors

Live connectors feed Masthead's canonical local session database. Now shows shallow live state;
Workbench deepens selected sessions; Logbook and artifact-primary MCP expose only knowledge that
Workbench has compiled and published. Session search, evidence detail, and usage summaries remain
downstream evidence views over collected data.

## Release Targets

The release target live connector set is:

- Codex
- Claude Code
- Cursor
- Grok Build
- Hermes
- Pi
- Oh My Pi
- OpenCode

Each live event is normalized with a runtime-scoped session identity. Canonical session IDs include host, runtime, and source session ID, so `sessionId: abc` from Claude Code and `sessionId: abc` from Grok Build remain distinct sessions.

Connectors post two local signals when available:

- `/ingest` records what happened as canonical event evidence.
- `/live/state` records the current runtime state as `working`, `blocked`, `idle`, or `unknown`.

Now prefers fresh explicit live-state reports over inferred historical events. Completed turn/stop
signals become runtime idle state; they do not mean Masthead owns or closes a terminal session.

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

Supported runtime path parameters are `codex`, `claude_code`, `cursor`, `grok`, `opencode`, `omp`, `pi`, and `hermes`.

## Connector Forms

Codex, Claude Code, and Grok Build use command hook JSON files. Masthead preserves unrelated hook groups, installs Masthead command hooks for required lifecycle/tool events, repairs stale Masthead commands, and removes only Masthead-managed commands during uninstall. The shared hook command sets both `MASTHEAD_INGEST_URL` and `MASTHEAD_STATE_URL`.

Cursor uses `~/.cursor/hooks.json` with `version: 1` and flat command entries per event. Masthead preserves unrelated Cursor commands and removes only commands containing the Masthead hook helper marker.

OpenCode uses a generated plugin file at `~/.config/opencode/plugins/masthead-live.js`. Masthead uninstalls only that generated plugin file after verifying its marker.

Oh My Pi and Pi use generated extension/plugin files. Each posts bounded lifecycle, input-summary, approval, tool, and stop metadata to Masthead, plus explicit state reports derived from a small local state machine. Masthead uninstalls only generated files after verifying their markers.

Hermes uses a generated Python plugin at `~/.hermes/plugins/masthead-live/` (`plugin.yaml` + `__init__.py`) and enables it in `~/.hermes/config.yaml` under `plugins.enabled`. Hermes does not load bare JavaScript plugin files; the Python plugin registers CLI/gateway lifecycle hooks and posts the same fail-open ingest + live-state signals.

Codex non-managed command hooks must be reviewed and trusted in Codex (`/hooks`) after install or repair. Untrusted hooks are skipped, including for `codex exec`.

## Privacy

The live hook helper redacts known secret-like values before forwarding payloads. Full transcript import remains governed by exact source-scoped permission and Workbench transcript actions. Live events may create canonical sessions and low-volume runtime signals before transcript import is approved.

## Verification

Useful checks:

```bash
npm run smoke:live
npm run doctor
npm run doctor:json
```

`smoke:live` posts synthetic events and live-state reports for all eight target runtimes, verifies
working/blocked/idle Now overlays, and verifies runtime-scoped canonical sessions. Doctor reports
connector install status, live-state endpoint health, latest state-report metadata, and live-capture
kill switches.
