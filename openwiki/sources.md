# Sources V2 (live connect)

Sources is the harness connection control plane for **live capture only**. It is not the session import/publish pipeline (Workbench) and not the published archive (Logbook).

**Contract (source of truth):** [docs/reference/sources-v2.md](../docs/reference/sources-v2.md)  
**Decision:** [ADR 0010](../docs/adr/0010-sources-v2-live-connect-only.md)

## Product hierarchy (Sources slice)

```text
Sources wires harnesses
  → live events → canonical DB + Now
    → Workbench deepens sessions and publishes artifacts
      → Logbook shows published artifacts (not session rows)
```

## Job

Sources answers only:

1. Which supported harnesses are present?
2. Is Masthead’s live connector installed?
3. What host activation remains (trust, enable, login, repair)?
4. Did Test (or a real event) prove the wire?

Primary loop:

```text
Discover → Select → Enable → Activate → Test → Ready
```

## Non-goals

Do not rebuild Sources as:

- import job dashboard,
- bulk metadata/transcript import UI,
- session table or Logbook browser,
- Workbench activity surface.

History adapters and import APIs may still exist in the daemon for Workbench. They are not Sources V2 UX.
Workbench publishes **artifacts** into Logbook (ADR 0011); Sources never owns Logbook visibility.

## UI shape

- Full catalog of live targets as connector rows (Codex, Claude Code, Cursor, Grok, Hermes, Pi, OMP, OpenCode).
- Top **Discover** rescan (presence + live status); never silent install.
- Row CTAs: Enable / Repair / Test / Uninstall as appropriate.
- Detail: config path, endpoints, activation checklist, advanced checked paths.
- First-run uses the same loop, not “connect history and queue imports.”

Status model:

- Presence: `not_found` | `found`
- Live: `not_installed` | `needs_action` | `ready` | `error`
- Installed ≠ ready when host action remains (especially Codex `/hooks` trust; Hermes plugin enablement).

## Implementation map

| Concern | Where |
|---|---|
| Presence scan / preflight | `src/daemon/sources/` (`sourceScanService`, `sourcePreflight*`) |
| Harness connector service | `src/daemon/sources/harnessConnectorService.ts`, `src/shared/harnessConnectors.ts` |
| Live install/test/uninstall | `src/daemon/liveConnectorSettings.ts`, `/settings/hooks/*` (underlying) |
| Sources V2 HTTP API | `GET/POST /sources/connectors*` (see below) |
| Renderer client | `src/app/daemonClient.ts` (`getHarnessConnectors`, connector actions) |
| UI | `src/ui/sources/` |
| Workbench session pipeline | `src/workbench/`, `src/ui/workbench/` |

Reuse live-connector install/test paths behind the Sources V2 connector API. Do not invent a second install stack.

## Daemon API (Sources V2)

Product contract remains [sources-v2.md](../docs/reference/sources-v2.md). Route reference: [daemon-api.md](../docs/reference/daemon-api.md).

| Method | Path | Role |
|---|---|---|
| `GET` | `/sources/connectors` | Connector snapshot + summary (bridge-safe read) |
| `POST` | `/sources/connectors/discover` | Recompute snapshot (primary-only) |
| `POST` | `/sources/connectors/:runtime/enable` | Install/repair live connector |
| `POST` | `/sources/connectors/:runtime/test` | Prove ingest + live-state |
| `POST` | `/sources/connectors/:runtime/uninstall` | Remove Masthead-managed connector |
| `POST` | `/sources/connectors/:runtime/confirm-activation` | Clear host-activation after user action |

Doctor check id: `harness-connectors` (`npm run doctor`). Endpoint matrix lists the same paths under read-only GET and blocked mutations.

## Runtime notes (capture fidelity)

- **Codex:** hooks in `~/.codex/hooks.json`; user must re-trust via `/hooks` after install/repair. Untrusted hooks are skipped.
- **Hermes:** Python plugin `~/.hermes/plugins/masthead-live/` + `plugins.enabled`; not a bare JS plugin file.
- All connectors: fail-open, preserve foreign hooks, Masthead-managed uninstall only.

## What to watch out for

- Do not mark Ready when `needs_action` remains.
- Do not put import jobs or transcript bulk CTAs back on Sources.
- Keep Discover non-mutating; Enable is explicit.
- Bounded local scan only (no whole-home crawl).
- When adding a runtime, update catalog, live connector install, presence preflight, and Sources row together.
