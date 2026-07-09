# Workbench Enroll Missing + Toolbar Density — Acceptance Evidence

Evidence that sessions without Workbench pipeline state can be enrolled onto
`publish_path` / `check_transcript` (live auto-enroll, CLI, HTTP, UI control),
that bulk enroll is idempotent, and that Workbench/Sources toolbars match Now
density (56px bar / 40px controls).

## Commits (enroll + toolbar density)

Range: `cdcba7f^..HEAD` (enroll helper through Sources density).

| SHA | Summary |
|---|---|
| `cdcba7f` | feat(workbench): add enroll helper for missing pipeline sessions |
| `9fd1942` | feat(workbench): auto-enroll sessions on live and adapter materialize |
| `64880be` | feat(workbench): add CLI enroll --missing for pipeline catch-up |
| `369ee28` | feat(workbench): expose enroll-missing HTTP op for Workbench UI |
| `f8dc9ba` | feat(workbench): wire enroll-missing through client and controller |
| `542c994` | feat(workbench): add Enroll missing toolbar control |
| `ad7a720` | style(workbench): match Now toolbar density for ops bar |
| `767560a` | style(sources): match Now toolbar density |

Evidence + dogfood closeout commit: see git log after
`test(workbench): record enroll-missing and toolbar density evidence`.

## Focused automated commands

```bash
npm test -- --run \
  src/daemon/db/__tests__/workbenchPipelineRepository.test.ts \
  src/daemon/db/__tests__/sessionRepository.test.ts \
  src/daemon/__tests__/workbenchApi.test.ts \
  src/cli/__tests__/mastheadctl.test.ts \
  src/app/__tests__/daemonClient.test.ts \
  src/app/workbench \
  src/ui/workbench

npm run check:product-contract
npm run check:surface-contract
npm run verify:no-citations
npm run check:endpoint-matrix
```

CLI token guard (Workbench panel must not surface agent recipes):

```bash
rg -n 'mastheadctl|npm run|output\.json|schema\.json|apply\.sh' src/ui/workbench/WorkbenchPanel.tsx
# expected: no matches
```

## Automated dogfood (temp SQLite)

Command:

```bash
npm run build:daemon
node scripts/dogfood-workbench-ops.js
```

Extended pipeline now includes enroll catch-up before the human ops loop:

1. Seed two sessions with no `workbench_session_state`
2. `enrollMissingWorkbenchSessions` → enrolled=2, both on `publish_path`
3. Second enroll → enrolled=0 (idempotent)
4. check transcript → quality → enrichment/dossier → publish → Logbook-visible

### Run result (this closeout)

- Date: 2026-07-09 (UTC)
- Command: `node scripts/dogfood-workbench-ops.js`
- Result: **`ok: true`** (exit 0)
- Asserted: enroll 2 → enroll 0; `publication_status === "published"`; `workbenchSessionIsPublished === true`
- Database: temporary directory under `$TMPDIR/masthead-workbench-ops-*` (deleted after run unless `MASTHEAD_KEEP_DOGFOOD_DB=1`)

## Live dev DB enroll (CLI, primary store)

Idempotent enroll against Tyler's real dev DB is intentional for catch-up.

```bash
npm run build:daemon
node dist/daemon/src/cli/mastheadctl.js workbench enroll --missing --json
```

### Run result (this closeout)

- Date: 2026-07-09 (UTC)
- Database: `/home/tyler/.local/share/masthead-dev/masthead.sqlite`
- Status **before**: `publishPath: 0`, `notAdded: 357`, `published: 182`
- Enroll **first**: `enrolled: 78`, `skippedExisting: 539`, `limit: 500`
- Enroll **second**: `enrolled: 0`, `skippedExisting: 617` (idempotent)
- Status **after**: `publishPath: 78`, `notAdded: 357`, `published: 182`

Published and not-added rows were not demoted. Publish path rose by the missing count.

## Manual UI checklist (Electron primary)

Against Electron Dev + primary daemon. Automated / CLI paths proven below;
live Electron visual pass deferred when not runnable in this closeout.

| # | Checklist item | Status |
|---|---|---|
| 1 | Note Now card count and Workbench publish path (was 0 before enroll) | **CLI proven** — pre-enroll status `publishPath: 0`; live Electron visual deferred |
| 2 | Click **Enroll missing** → publish path rises; table fills | **Automated + CLI proven** — controller/panel unit tests for button + summary; live CLI enrolled 78 → `publishPath: 78`. Live Electron button click deferred |
| 3 | New live event auto-appears on Workbench without button | **Unit-test proven** (`sessionRepository` auto-enroll on live/materialize); live Electron deferred |
| 4 | Second **Enroll missing** → “No missing sessions” / enrolled 0 | **Automated + CLI proven** — dogfood idempotent step; controller test summary string; CLI second enroll `enrolled: 0` |
| 5 | Compare Now / Workbench / Sources toolbar heights | **Style proven** — CSS commits `ad7a720` / `767560a` (56px bar, 40px controls/facts, single-row). Live Electron visual height compare deferred |
| 6 | Bridge cannot POST enroll-missing | **Design/docs proven** — route is primary-only write; bridge rejects writes by matcher. Live bridge negative test deferred |

**Honesty note:** Enroll correctness is proven via repository/API/CLI/unit tests, temp-DB dogfood, and a real primary-store CLI catch-up (78 sessions). Live Electron Dev click-through and visual toolbar measurement were **not** executed in this closeout (deferred).

## Toolbar density (style contract)

Shared target: Now’s `.observability-toolbar` density.

| Surface | Target | Evidence |
|---|---|---|
| Workbench | 56px bar, 40px buttons/facts, nowrap + horizontal scroll | `ad7a720`, `.workbench-toolbar.observability-toolbar` in `src/styles/masthead.css` |
| Sources | same 56px / 40px density | `767560a`, `.sources-action-bar.sources-toolbar` in `src/styles/sources.css` |
| UI control | **Enroll missing** without CLI recipes | `WorkbenchPanel.test.tsx` + `rg` token guard (no matches) |

## Task 10 final verification gate (2026-07-09)

| Check | Result |
|---|---|
| Focused Workbench suites (9 files / 117 tests) | **PASS** |
| Temp-DB dogfood `scripts/dogfood-workbench-ops.js` | **PASS** (`ok: true`, enroll steps included) |
| Live CLI enroll `--missing` on dev DB | **PASS** (78 then 0; publishPath 0→78) |
| `npm run typecheck` | **FAIL** (unrelated Sources only): `src/app/sources/__tests__/setupPlanRunner.test.ts` still uses removed `importTranscripts` on `SourcesSetupPlan`. Workbench controller enroll mock typing fixed in this closeout. |
| `npm run check:product-contract` | **PASS** |
| `npm run check:surface-contract` | **PASS** |
| `npm run verify:no-citations` | **PASS** |
| `npm run check:endpoint-matrix` | **PASS** |
| CLI tokens in `WorkbenchPanel.tsx` (`mastheadctl`, `npm run`, `output.json`, `schema.json`, `apply.sh`) | **none** |

### Known non-blockers for this gate

- Live Electron Dev Enroll missing click + visual toolbar height compare remain deferred.
- Repo-wide `typecheck` still fails only on Sources setup-plan test fixtures (`importTranscripts`); out of Workbench enroll scope.
- Full `npm run verify` / GitHub Actions not re-run as part of Task 10.

## Scope boundaries

- Temp dogfood uses **temp SQLite only** (`mkdtemp`); never opens the real path for the scripted loop.
- Live CLI enroll against `~/.local/share/masthead-dev/masthead.sqlite` is **safe/idempotent** (creates pipeline rows only when missing; does not demote published/not_added).
- Bridge write rejection for enroll-missing is by design (primary-only); see `docs/reference/daemon-api.md`.
- Product release gate should link here for enroll-missing + toolbar density closeout.
