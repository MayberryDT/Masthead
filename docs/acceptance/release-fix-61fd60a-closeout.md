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

- `npm run build` — pass
- Focused vitest — 75 tests / 15 files (settings API, notifications, ipc security, logbook, settings UI, sources import progress)
- `npm run check:surface-contract` — pass
- `openwiki --update` — included in commit

## Partial in-app Browser

Launcher: `MASTHEAD_UI_PORT=5180 npm run dev` (primary `17373`). Early passes failed when launcher died; stable detached run used for final checks.

- Board (Now): 1440 / 768 / 390 — no `No live connection` / `No live Codex sessions yet` after load wait
- Desktop spot: Logbook row checkboxes; Sources import activity copy; Settings session-ended notifications copy; Board `.headline-source` present

**Not exercised:** full AGENTS viewport matrix for Logbook/Sources/Settings; bulk enrich toolbar after selection; import progress bar during active job; Electron notification on real ended transition; full `npm run verify`.

## Open for release gate checklist

Unchanged rows in `docs/acceptance/product-release-gate.md` — no new checkboxes added for this batch.