# Task 10 Report — Honest Import Health UI

## Outcome

- Sources receipts now show recognized/rejected records, canonical/package/repair/noise counts, safety-cap deferrals, timestamp basis, anomalies, and a truthful `Needs import repair` state.
- Sidebar import health keeps compact per-runtime issue receipts visible after terminal imports.
- Workbench gets a separate `Import repair` aggregate and read-only receipt links. Repair units never enter the selectable package table and never inflate `Not Added`.
- Workbench reads a dedicated read-only daemon aggregate over current `repair_required` work units. Identity-less parser failures are included.

## TDD Evidence

### RED

- `SourcesImportModal.test.tsx`: failed because the receipt omitted `500 recent units imported`, capped deferrals, repair count, timestamp basis, and parser rejection language.
- `WorkbenchPanel.test.tsx`: failed because `Import repair 12` was absent while Package path and Not Added rendered.
- `SidebarImportActivity.test.tsx`: failed because terminal issue receipts returned no sidebar output.

### GREEN

- `npx vitest --run src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx src/ui/__tests__/SidebarImportActivity.test.tsx src/daemon/db/__tests__/sessionImportHealthRepository.test.ts src/app/workbench/__tests__/useWorkbenchController.test.tsx src/app/__tests__/daemonClient.test.ts`
  - 7 files passed, 103 tests passed.
- Focused daemon API regression (run with localhost bind permission): 1 passed, including a repair unit with no session identity.
- `npm run check:surface-contract`: passed.
- `npm run typecheck`: passed.
- `npm run verify:no-citations`: passed.
- `git diff --check`: passed.

## Viewport Evidence

Blocked. The required in-app Browser runtime reported no available browser instances. No standalone browser, Playwright server, production connector, database, or port 5173 fallback was used.

## Notes

- Repair mutation remains daemon/CLI-controlled. UI repair affordances are preview/read-only only.
- Sources receipt history uses the latest completion receipt per runtime; Workbench does not derive its current repair total from historical receipts.

## Review Follow-up — Receipt Navigation and Truthful State

- Workbench receipt buttons now carry the exact `importJobId` through a one-shot App intent. Sources resolves only a matching terminal job, opens the receipt modal with that report alone, then consumes the intent so normal Sources navigation is unchanged.
- The receipt exposes `Preview import repair` through the Sources controller. It calls preview only; no apply action was added.
- Safety-cap copy now uses `cappedUnits` exclusively. Any additional `sourceUnitsDeferred` count is shown separately as other scope deferrals.
- Receipt badge semantics now agree with status: failed/error, succeeded-with-issues/warning, clean succeeded/ready. A failed run remains error even when it also needs repair.

### Follow-up RED/GREEN

- RED: Workbench navigation reached Sources but did not open the requested receipt.
- RED: 420 mixed deferred units were incorrectly described as safety-capped instead of 300 capped + 120 other-scope.
- RED: failed and succeeded-with-issues reports used the ready badge class.
- GREEN: 6 focused files passed, 59 tests passed.
- GREEN: surface contract, typecheck, citation guard, and diff check passed.
- Browser evidence remains unavailable because the in-app Browser runtime has no browser instance; no fallback was used.

## Final Follow-up — Exact Receipt Fetch

- Receipt navigation now fetches `GET /imports/:id/report` by the requested job ID instead of searching the currently filtered/paginated import rows.
- The receipt modal preserves a loading state and shows explicit not-found or request-error text before consuming the one-shot navigation intent.
- The read-only worktree bridge permits only `GET /imports/:id/report`; the corresponding POST remains blocked.

### Final RED/GREEN

- RED: a requested Cursor receipt outside the visible OpenCode-filtered page did not open.
- RED: an exact receipt request failure had no visible error.
- RED: App omitted the exact-report loader and the bridge rejected the report read endpoint.
- GREEN: Sources/App/client focused set passed: 5 files, 80 tests.
- GREEN: bridge route-policy set passed: 29 tests (12 socket/integration cases skipped by the focus filter).
- GREEN: surface contract, typecheck, citation guard, and diff check passed.
- The full bridge suite's socket proxy case could not bind `127.0.0.1` in the sandbox (`EPERM`); its route-policy regression passed. Browser evidence remains unavailable as noted above.
