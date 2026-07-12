# Runaway import repair implementation plan

> Execute test-first and keep production Masthead stopped until the fixed package and compact database are verified.

**Goal:** Stop database amplification and quadratic import work, make progress/restart state durable within large transcript files, preserve honest UI counts, recover the production database, and relaunch one healthy production build.

**Architecture:** Make source setup reads side-effect free and keep one saved setup snapshot. Keep adapter record ingestion free of transcript-wide policy work; reconcile once per hydrated session. Add a batched checkpoint callback from the import runner to the server so the ledger, public job, and ingest cursor advance together. Preserve last successful UI totals during refresh. Recover production with a verified compact copy before replacing the active database.

---

## Task 1: Bound source setup persistence and narrow active-import polling

**Files:**
- Modify: `src/daemon/db/sourceSetupRepository.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/sources/useSourcesController.ts`
- Test: `src/daemon/db/__tests__/sourceSetupRepository.test.ts`
- Test: relevant source setup API test under `src/daemon/__tests__/`
- Test: source controller hook test under `src/app/sources/__tests__/`

1. Add failing tests proving repeated setup saves leave one row, GET setup routes do not add rows, and active polling calls import endpoints without refreshing setup/source inventory.
2. Run only those tests and confirm the expected failures.
3. Change repository persistence to replace the current setup snapshot transactionally.
4. Split server setup building from explicit persistence and use the pure builder in GET routes.
5. Change active polling to call `loadImportsForRuntime`; refresh inventory once after a tracked job becomes terminal.
6. Re-run focused tests.

## Task 2: Remove per-record candidate gate work

**Files:**
- Modify: `src/daemon/db/sessionRepository.ts`
- Modify: `src/daemon/import/importWorkUnitRunner.ts` only if boundary behavior needs adjustment
- Test: `src/daemon/db/__tests__/sessionRepository.test.ts`
- Test: `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`

1. Add a failing repository test showing transcript adapter records do not enroll a session during record materialization.
2. Add an import-runner test showing `onSessionHydrated` runs once for each distinct session after all records are materialized.
3. Remove `afterSessionMaterialized` from adapter record ingestion while preserving it for live events.
4. Confirm import completion reconciliation still admits candidate sessions and finalizes noise.
5. Run the focused repository, runner, quality-precheck, and reconciler tests.

## Task 3: Add batched durable intra-file checkpoints

**Files:**
- Modify: `src/daemon/import/importWorkUnitRunner.ts`
- Modify: `src/daemon/server.ts`
- Modify: cursor/import ledger repositories only if their current API cannot express monotonic partial state
- Modify: `src/shared/sourceImport.ts` and `src/app/daemonClient.ts` only for new progress fields that are actually required
- Test: `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`
- Test: relevant import API/server tests

1. Add failing runner tests for: no per-record ledger update, checkpoint at the batch boundary, final checkpoint below the boundary, latest record cursor included, and checkpoint flush on failure.
2. Introduce a small `onCheckpoint` contract carrying monotonic counts plus the latest record/cursor context.
3. Batch work-unit writes and yielding; keep final status writes synchronous.
4. In the server callback, update public job counts relative to completed-unit totals and upsert the active source cursor.
5. Add a restart test that starts from the saved intra-file cursor and does not replay preceding records.
6. Run focused runner, ledger, cursor, import API, and smoke-import tests.

## Task 4: Preserve useful UI counts during refresh

**Files:**
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/app/sidebar/useKnowledgeFlowSummary.ts`
- Test: Workbench panel tests
- Test: `src/app/sidebar/__tests__/useKnowledgeFlowSummary.test.tsx`

1. Add failing tests proving a known Workbench total remains visible while loading and the last successful knowledge-flow summary survives a background refresh/error.
2. Make the Workbench label depend on whether a total has ever been supplied, not the loading flag alone.
3. Stop clearing a successful summary for background loads and transient failures.
4. Run focused UI tests and surface contract checks.

## Task 5: Full verification and package

1. Run all focused suites from Tasks 1-4.
2. Run `npm run verify` and resolve only failures caused by this repair or the current branch changes.
3. Run Electron tests/security checks and packaged smoke.
4. Build a versioned production package and verify its health in an isolated temporary profile/database.

## Task 6: Compact, verify, install, and relaunch production

1. Confirm no production Masthead process is running and record old database size, integrity result, table counts, latest setup state, Workbench totals, Not Added totals, and import ledger state.
2. Create a compact SQLite copy that preserves all data except obsolete setup snapshots; do not launch Masthead against either database during this operation.
3. Run `PRAGMA quick_check` on the compact copy and compare all recorded counts/aggregates. Confirm `source_setup_state` has at most one row.
4. Atomically replace the active database with the compact copy.
5. Install the new bundle, repoint `current`, and remove every other production install artifact.
6. Relaunch Masthead and verify health, renderer access, correct Workbench/Not Added totals, source setup row stability across repeated GETs, record-level import movement, stable database size/write rate, and intra-file cursor advancement.
7. Restart once and verify the active file resumes beyond the saved cursor.
8. After all production checks pass, delete the bloated original database so only the compact active database remains.
