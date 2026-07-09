# Workbench V1 Acceptance Evidence

Workbench V1 now has a split product surface:

- UI: show publish-path pipeline sessions in a dense table, visualize Workbench
  Activity, summarize Not Added to Logbook, and create disposable,
  plain-language agent handoffs.
- CLI: remain agent-facing and concrete enough for coding agents to validate and
  apply `session_enrichment`, `session_dossier`, and `bug_fix_trace` outputs,
  check/request transcript work, claim sessions, and explicitly publish.

## 2026-07-08 Pipeline Update

- Pipeline-state APIs now use `/workbench/sessions`, `/workbench/activity`,
  `/workbench/not-added-summary`, and explicit Workbench transcript/publish
  actions. `/workbench/missing-sessions` remains a compatibility read route.
- Transcript import is Workbench-owned and exact-source scoped. Sources no
  longer exposes runtime-wide transcript approval/import actions.
- Focused verification for the pipeline update:
  - `npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/cli/__tests__/mastheadctl.test.ts src/ui/sources/__tests__/AdapterRow.test.tsx src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/sources/__tests__/SourcesPanelImports.test.tsx src/daemon/sources/__tests__/sourceConnectService.test.ts src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/daemon/import/__tests__/progressiveImport.test.ts`
  - `npm test -- --run src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/workbench/__tests__/workbenchHandoff.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx`

## Automated

- 2026-07-08 focused implementation suite:
  - Command: `npm test -- --run src/daemon/__tests__/workbenchApi.test.ts src/app/__tests__/daemonClient.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx src/ui/workbench src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/workbench src/cli`
  - Result: 15 files / 107 tests passed.
- 2026-07-08 Dossier sanitizer regression:
  - Command: `npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
  - Result: 1 file / 32 tests passed.
- 2026-07-08 typecheck: `npm run typecheck` passed.
- 2026-07-08 product contract: `npm run check:product-contract` passed.
- 2026-07-08 surface contract: `npm run check:surface-contract` passed.
- 2026-07-08 dev-citation guard: `npm run verify:no-citations` passed.
- 2026-07-08 endpoint matrix: `npm run check:endpoint-matrix` passed and reported `GET /workbench/missing-sessions?limit=10` as `200`/JSON/present.
- 2026-07-08 production build: `npm run build` passed.
- 2026-07-08 full Vitest run:
  - Command: `npm test -- --run`
  - Result: 231 files / 1336 tests passed; 3 files / 6 tests failed in existing live projection expectations (`fixtureReplay.test.ts`, `liveRuntimeStates.test.ts`, `reviewDispositions.test.ts`).
  - Investigation: subagent trace found the remaining failures are outside the Workbench implementation path and relate to current live-state/blocked-state projection behavior versus older test expectations.
- 2026-07-08 visible-token source guard:
  - Command: `rg -n "mastheadctl|npm run|output\\.json|schema\\.json|apply\\.sh" src/ui/workbench src/ui/session-dossier/SessionDossier.tsx`
  - Result: no matches.
- 2026-07-08 local dev run:
  - Command: `npm run dev`
  - Result: app served at `http://127.0.0.1:5173` with primary connector at `http://127.0.0.1:17373`.
  - Browser verification: Workbench loaded 50 visible missing sessions, generated a selected-session handoff, had no `No live connection` / `No live Codex sessions yet` warning, and had no visible forbidden command/file tokens at desktop, tablet, or narrow mobile widths.
  - API verification: `GET /workbench/missing-sessions?limit=3` returned three missing-session records from the dev database.
- Earlier focused Workbench/MCP/UI suite recorded on this branch:
  - Command: `npm test -- --run src/cli/__tests__/mastheadctl.test.ts src/workbench/__tests__/schemas.test.ts src/workbench/__tests__/validation.test.ts src/workbench/__tests__/evidencePacket.test.ts src/workbench/__tests__/queueRepository.test.ts src/workbench/__tests__/instructions.test.ts src/workbench/__tests__/applySessionEnrichment.test.ts src/workbench/__tests__/applyArtifact.test.ts src/workbench/__tests__/batch.test.ts src/daemon/db/__tests__/schema.test.ts src/daemon/db/__tests__/sessionArtifactRepository.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts src/mcp/__tests__/tools.test.ts src/mcp/__tests__/protocol.test.ts src/mcp/__tests__/retrieval.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/__tests__/navigation.test.tsx`
  - Result: 19 files / 104 tests passed.
- Earlier typecheck: `npm run typecheck` passed.
- Earlier daemon build: `npm run build:daemon` passed.
- Earlier dogfood: `node scripts/dogfood-workbench-v1.js` passed against a temporary SQLite database.

This Task 8 docs pass did not rerun the older broad suite above.

## UI Pivot Coverage

| Area | Evidence |
|---|---|
| Workbench pipeline daemon APIs | `src/daemon/__tests__/workbenchApi.test.ts` covers pipeline queue/activity/Not Added reads, transcript check/preview/import boundary, and explicit publish. |
| App client | `src/app/__tests__/daemonClient.test.ts` covers Workbench pipeline client methods. |
| Workbench controller | `src/app/workbench/__tests__/useWorkbenchController.test.tsx` covers active/live loading, inactive/offline suppression, retry, selection pruning, select-all, clear selection, Activity, Not Added summary, and sanitized handoff text. |
| Workbench panel | `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` covers a dense publish-path table, Activity rail, Not Added summary, selection handoff, top copy action, and no old queue/category framing such as bug-fix candidates or missing dossiers. |
| Handoff builder | `src/ui/workbench/__tests__/workbenchHandoff.test.ts` covers plain-language handoff generation and metadata sanitization. |
| Session Dossier UI | `src/ui/session-dossier/__tests__/SessionDossier.test.tsx` covers plain-language Workbench guidance and current Workbench artifacts without user-visible CLI instructions. |
| No visible CLI token guard | Workbench and Session Dossier UI tests assert rendered output does not expose visible tokens such as the CLI binary name, package-script phrase, generated output file names, schema filename, or apply script filename. |
| Agent-facing CLI guidance | `src/cli/__tests__/mastheadctl.test.ts` and `src/workbench/__tests__/instructions.test.ts` cover help/instructions for all V1 output kinds and validation discipline. |

## CLI

The CLI remains agent-facing. These commands are intentionally documented for
coding agents, not as user instructions inside the Workbench app surface.

| Command | Result |
|---|---|
| `mastheadctl workbench status --json` | Covered by CLI tests and dogfood. |
| `mastheadctl workbench queue --kind session_enrichment --scope missing --json` | Covered by queue tests, CLI tests, and dogfood. |
| `mastheadctl workbench next --kind session_enrichment --scope missing --json` | Covered by CLI tests and dogfood. |
| `mastheadctl workbench schema session_enrichment --json` | Covered by schema tests, CLI tests, and dogfood. |
| `mastheadctl workbench evidence --session ... --kind session_enrichment --json` | Covered by evidence packet tests, CLI tests, and dogfood. |
| `mastheadctl workbench validate ...` | Covered by validation tests, CLI tests, and dogfood. |
| `mastheadctl workbench apply ...` | Covered by enrichment/artifact apply tests, CLI tests, and dogfood. |
| `mastheadctl workbench batch prepare ...` | Covered by batch tests, CLI tests, and dogfood. |
| `mastheadctl workbench batch apply ...` | Covered by batch tests, CLI tests, and dogfood. |

## Behavior Evidence

| Scenario | Result |
|---|---|
| User opens Workbench | Covered by Workbench controller/panel tests for missing-session loading and session-first rendering. |
| User selects sessions needing enrichment | Covered by controller tests for toggle/select-all/clear and panel tests for selected handoff rendering. |
| Workbench creates a disposable handoff | Covered by `workbenchHandoff` tests and Workbench panel tests. |
| Workbench does not instruct users to run CLI commands | Covered by visible-token guards in Workbench and Session Dossier UI tests. |
| Agent enriches one session | Passed via `scripts/dogfood-workbench-v1.js`. |
| Logbook/search can see new enrichment | Covered by `applySessionEnrichment` search assertion. |
| Now can display enrichment if available | Workbench writes current `live_summary` and current prompt-version capsule rows used by live readers. |
| Agent creates session dossier artifact | Passed via dogfood and artifact apply tests. |
| Agent creates bug-fix trace artifact | Covered by `applyArtifact` test. |
| Session detail shows artifacts | Covered by session dossier repository and UI tests. |
| MCP remains read-only | Covered by MCP tool-name policy test. |

## Dogfood Output

```json
{
  "ok": true,
  "currentWorkbenchEnrichments": 3,
  "currentArtifacts": 1
}
```
