# Workbench Ops Complete — Acceptance Evidence

Evidence that the Workbench human ops publish path is complete end-to-end on the
automated path: check transcript → quality → enrichment/dossier gates → publish
to Logbook, with Activity events and UI ops coverage via unit tests.

Temp-DB only for dogfood. **Did not seed or mutate Tyler's real dev database.**

## Commits (ops-complete work)

Recent Workbench ops-complete commits on this branch:

| SHA | Summary |
|---|---|
| `015375f` | docs(design): define Workbench ops surface archetype |
| `02a3d49` | style(workbench): restyle Activity rail as high-contrast console |
| `c286685` | feat(workbench): complete human ops toolbar on the Workbench surface |
| `73dc3bf` | fix(app): include JSON error codes in daemon client failures |
| `2ce9914` | feat(workbench): drive pipeline ops from the Workbench controller |
| `6089e6a` | feat(workbench): add daemon client write helpers for ops actions |
| `52aea6c` | feat(workbench): expose claim, release, and quality HTTP ops |
| `27b9ac6` | fix(workbench): guard quality pass/fail publication transitions |
| `ee312bd` | feat(workbench): add quality pass/fail pipeline transitions |
| `6fb5a26` | fix(workbench): restore active claim reads with future-safe tests |

Dogfood + this evidence commit: see git log after `test(workbench): dogfood complete ops loop and record evidence`.

## Automated dogfood (temp SQLite)

Command:

```bash
node scripts/dogfood-workbench-ops.js
```

Requirements: `npm run build:daemon` so `dist/daemon/...` modules exist.

Expected receipt shape:

```json
{
  "ok": true,
  "sessionId": "session:ops-dogfood",
  "steps": [
    { "name": "check_transcript", "ok": true },
    { "name": "quality_precheck", "ok": true },
    { "name": "quality_pass", "ok": true },
    { "name": "session_enrichment_satisfied", "ok": true },
    { "name": "session_dossier_satisfied", "ok": true },
    { "name": "bug_fix_not_applicable", "ok": true },
    { "name": "publish", "ok": true, "publicationStatus": "published" },
    { "name": "logbook_visible", "ok": true }
  ]
}
```

### Run result (this closeout)

- Date: 2026-07-08
- Command: `node scripts/dogfood-workbench-ops.js`
- Result: **`ok: true`** (exit 0)
- Session: `session:ops-dogfood`
- Asserted: `publication_status === "published"` and `workbenchSessionIsPublished(db, sessionId) === true`
- Database: temporary directory under `$TMPDIR/masthead-workbench-ops-*` (deleted after run unless `MASTHEAD_KEEP_DOGFOOD_DB=1`)

## Manual UI checklist (plan Task 9 Step 3)

Against Electron Dev + primary daemon. Prefer real live capture; **do not seed Tyler's
real dev DB without explicit approval.**

| # | Checklist item | Status |
|---|---|---|
| 1 | Ensure at least one publish-path session (live capture after Sources ready) | **Deferred** — live Electron UI dogfood not run in this closeout; no approval to seed real dev DB |
| 2 | Workbench: select session → Check Transcript → Activity row + status token update | **Automated-path proven** via dogfood `check_transcript` + unit tests for Activity/ops UI |
| 3 | Import when needed; if permission blocked, plain error (no crash) | **Unit-test proven** (`workbenchApi` transcript permission/source-scoped import); live UI deferred |
| 4 | Accept Quality or Precheck | **Automated-path proven** via dogfood `quality_precheck` + `quality_pass` |
| 5 | When next is enrich/create_dossier: Copy Agent Prompt / agent apply | **Partial** — gate satisfaction via repository marks in dogfood; full agent-apply CLI path covered by `dogfood-workbench-v1.js` and apply tests; live UI copy handoff covered by panel/controller tests |
| 6 | Publish → leaves publish-path table and appears in Logbook search | **Automated-path proven** via dogfood `publish` + `logbook_visible` (`workbenchSessionIsPublished`); live UI deferred |
| 7 | Activity rail contrast readable throughout | **Unit-test / style proven** — Activity high-contrast restyle commit `02a3d49` + Workbench panel Activity tests; live Electron visual pass deferred |
| 8 | Open Not Added review; confirm reason rows render | **Unit-test proven** (Not Added summary/API + panel tests); live UI deferred |

**Honesty note:** Complete ops pipeline correctness is proven on a temporary database and
by focused unit/API tests. Live Electron Dev walkthrough of the full human toolbar loop
was **not** executed in this Task 9 closeout (deferred / partial). Re-run the manual
checklist against Electron Dev when a real publish-path session is available without
mutating the primary store from a secondary worktree write path.

## Activity contrast and ops UI (unit tests)

Verified via existing focused suites (not re-asserted in the dogfood script):

- `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx` — dense ops table, Activity rail, Not Added, selection/handoff, no old queue framing
- `src/app/workbench/__tests__/useWorkbenchController.test.tsx` — pipeline loading, selection, Activity, ops actions wiring
- `src/daemon/__tests__/workbenchApi.test.ts` — claim/release/quality/publish/transcript gates and Activity events
- `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts` (when present) — quality pass/fail, publication gates
- Activity high-contrast console styling: commit `02a3d49`

Suggested focused re-run:

```bash
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/app/__tests__/daemonClient.test.ts \
  src/app/workbench \
  src/ui/workbench \
  src/cli/__tests__/mastheadctl.test.ts \
  src/workbench
```

## Task 10 final verification gate (2026-07-08)

| Check | Result |
|---|---|
| Focused Workbench suites (18 files / 133 tests) | **PASS** |
| `npm run typecheck` | **FAIL** (pre-existing unrelated Sources only after Workbench panel test types fixed): `src/app/sources/__tests__/setupPlanRunner.test.ts` still uses removed `importTranscripts` on `SourcesSetupPlan` |
| `npm run check:product-contract` | **PASS** |
| `npm run check:surface-contract` | **PASS** |
| `npm run verify:no-citations` | **PASS** |
| `npm run check:endpoint-matrix` | **PASS** |
| CLI tokens in `WorkbenchPanel.tsx` / `SessionDossier.tsx` (`mastheadctl`, `npm run`, `output.json`, `schema.json`, `apply.sh`) | **none** (handoff builder may still use agent-facing tokens; not in panel/dossier UI sources) |

Product release gate bullets for human ops toolbar + Activity contrast link here:
`docs/acceptance/product-release-gate.md` → Workbench section.

### Known non-blockers for this gate

- Live Electron Dev full human toolbar walkthrough remains deferred (see Manual UI checklist).
- Repo-wide `typecheck` still fails on Sources setup-plan test fixtures (`importTranscripts`); out of Workbench ops scope.
- Full `npm run verify` / GitHub Actions not re-run as part of Task 10.

## Scope boundaries

- Dogfood uses **temp SQLite only** (`mkdtemp`); never opens `~/.local/share/masthead-dev/`.
- Script imports compiled daemon modules under `dist/daemon/` (same pattern as `scripts/dogfood-workbench-v1.js`).
- Enrichment/dossier satisfaction uses repository gate marks (`markWorkbenchSessionEnrichmentSatisfied`, `markWorkbenchArtifactSatisfied`) rather than full CLI apply fixtures; full apply remains covered by V1 dogfood.
- Live UI Electron dogfood remains optional follow-up; automated path is the release-gate proof for pipeline completeness.
