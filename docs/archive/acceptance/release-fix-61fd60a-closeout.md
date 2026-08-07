# Release fix batch closeout — `61fd60a`

**Branch:** `feat/live-multi-harness-connectors`  
**Commit:** `61fd60a` — `fix(release): settings save, card cue, import progress, logbook bulk enrich, session notifications`

## Shipped

- Settings: partial LLM provider save for remote enrichment toggle; provider block on explicit save.
- Now: headline source cue on session cards.
- Sources: import progress bar + stale visibility; adapter detail/live-capture polish.
- Logbook: multi-select + bulk enrich via `rebuildEnrichments` `sessionIds`.
- Desktop: session-ended notifications (IPC + projection transition + preference).

## Automated verification

- `npm run verify` — pass on 2026-07-06; 220 test files / 1195 tests, build, endpoint matrix, and live/compatibility/import/MCP smokes.
- `npm run smoke:electron` — pass on 2026-07-06; Electron 42.5.0, preload bridge, typed notification bridge, custom chrome, renderer privilege checks, and hover latency.
- Earlier `npm run build`, focused vitest, `npm run check:surface-contract`, and `openwiki --update` passed in commit `61fd60a`.

## Partial in-app Browser

Launcher: `MASTHEAD_UI_PORT=5180 npm run dev` (primary `17373`). Early passes failed when launcher died; stable detached run used for final checks.

- Board (Now): 1440 / 768 / 390 — no `No live connection` / `No live Codex sessions yet` after load wait
- Desktop spot: Logbook row checkboxes; Sources import activity copy; Settings session-ended notifications copy; Board `.headline-source` present

Not manually observed: native OS notification delivery on a real session transition. Automated coverage now verifies first-projection baselining, running→idle notifications, Electron notification construction, IPC/preload channels, and `smoke:electron`.

## Release gate checklist

Updated `docs/acceptance/product-release-gate.md` on 2026-07-06: read-only bridge mode and `npm run verify` now cite current passing evidence.