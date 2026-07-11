# UI / Harness Neutrality Touchups — Acceptance Evidence

Date: 2026-07-08  
Worktree: `/home/tyler/.codex/worktrees/f503/Masthead`  
Implementation plan is preserved in Git history; this file is the retained acceptance receipt.

## Commits (plan range)

| SHA | Summary |
|---|---|
| `101544b` | fix: stop Grok live sessions being attributed as Claude Code |
| `431c255` | fix: let Grok host detection override Claude MASTHEAD_RUNTIME pin |
| `52889e7` | fix: align harness catalog with live connector runtimes |
| `1f7a757` | fix: harden Codex catalog paths and share live ingest runtimes |
| `ef7d91e` | fix(ui): give Workbench a distinct wrench icon |
| `a932705` | fix(ui): align Workbench chrome with Logbook/Sources ops surfaces |
| `7f04e90` | test: repair fixture replay active-count expectations after live-state semantics |
| `6fc37ec` | docs: point OpenWiki/AGENTS at Workbench-stage product hierarchy |

## Commands

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run check:product-contract` | Pass |
| `npm run check:surface-contract` | Pass |
| `npm run verify:no-citations` | Pass |
| Focused Vitest (resolveHookRuntime, liveIdentity, fixtureReplay, projection, adapters, liveConnectorSettings, liveStateApi, workbench UI, sidebar, liveBoard, navigation) | **20 files / 128 tests passed** |
| Full `npm test -- --run` | **236 files / 1398 tests passed**; **2 files / 2 tests failed** (below) |

## Remaining failures (full suite)

Outside this plan’s touch targets; Workbench pipeline claim surface:

1. `src/daemon/__tests__/workbenchApi.test.ts` — `activeClaim` missing on publish-path sessions after claim (claim activity present, claim object not).
2. `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts` — `after.activeClaim?.claimedBy` undefined after claim.

Not introduced by runtime-attribution, catalog, Workbench chrome, or projection-test commits in this plan range. Left for a follow-up Workbench claim-read fix.

## Runtime / UI smoke

- `masthead-dev-electron.service`: active  
- Daemon `127.0.0.1:17373` healthy, schema 17  
- UI `127.0.0.1:5173` listening  
- Projection sample after plan work: multi-runtime cards present  
- **Forward Grok attribution:** new Grok Build sessions appear as `runtime: grok` / harness **Grok Build** (16 grok cards observed during implementation session)  
- **Historical ghost:** pre-fix dual-attributed session `019f42f6-…` can still show as Claude Code (stop-new-posts only; no historical merge)  
- Workbench icon registry: `workbench: Wrench`, `logbook: BookOpenText`  
- Workbench empty ops state implemented (no publish-path sessions + Not Added summary)

## Browser / visual

Automated surface contract + panel tests cover chrome. Collaborative visual micro-tweaks with Tyler are next (explicit handback).

## Not done (by design)

- Workbench pipeline dogfood  
- Full docs rewrite  
- Historical dual-session cleanup  
- Live connector reinstall for `MASTHEAD_RUNTIME` pins on disk (host detection still protects dual-fire without reinstall)
