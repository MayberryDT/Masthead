# Task 9 Report: Provenance-Scoped Import Repair

## Status

Implemented repair preview/apply across the daemon domain module, HTTP API, typed app client, CLI, and read-only worktree bridge policy.

## RED

- `npx vitest --run src/daemon/import/__tests__/importRepair.test.ts`
  - Failed because `../importRepair.ts` did not exist.
- `npx vitest --run src/core/__tests__/worktreeConnector.test.ts`
  - New policy assertion failed because `POST /imports/repair/preview` was not allowed.
  - The same sandboxed run also reported the expected unrelated `listen EPERM` for loopback-binding integration coverage; the final focused suite was rerun with loopback binding enabled.

## GREEN

- `npm run typecheck`
  - Passed.
- `npx vitest --run src/daemon/import/__tests__/importRepair.test.ts src/cli/__tests__/mastheadctl.test.ts src/daemon/__tests__/server.test.ts src/core/__tests__/worktreeConnector.test.ts`
  - 4 files passed, 60 tests passed.

## Safety evidence

- Preview performs no writes and hashes the normalized complete plan with SHA-256.
- Apply recomputes the plan before and inside an immediate transaction; any mismatch fails with `repair plan changed`.
- A pseudo-session is deleted only when it was created by a selected job, has no non-selected job impact, has no source outside selected job sources, has no live-state evidence, and has no artifact provenance/direct artifact ownership.
- Published artifact provenance blocks the entire apply. Published and unpublished artifacts are never deleted.
- Updated/transcript sessions are retained for reparse. Only automatic `confirmed_noise` or `insufficient_evidence` suppressions reopen; manual exclusions remain unchanged.
- Out-of-range sessions from recent-scope manifests are deferred and preserved.
- Apply resets only selected jobs' work units and selected sources' cursors, commits, then the daemon queues reimport work through the current adapter path.
- The HTTP request cannot select a database path; the daemon always uses its active database.
- `mastheadctl import repair` defaults to preview. Apply requires the explicit `apply` verb and a lowercase 64-character SHA-256 plan hash.
- The read-only worktree bridge proxies preview and rejects apply.
- Tests create temporary databases only. Production application/database state was untouched.

## Self-review

The deletion set is intentionally conservative. Sessions with any artifact, live evidence, shared provenance, unrelated impacts, or unrelated source ownership are reparsed or preserved rather than deleted. No UI, docs, replay tooling, schema migration, or unrelated cleanup was added.

## Review fixes — 2026-07-15

### RED

- Domain review regressions initially failed 4 of 7 tests:
  - no hashed source viability/mapping,
  - unavailable-source sessions still reparsed,
  - affected manual decisions remained deletable,
  - deferred automatic suppressions still reopened.
- The first server-route run passed assertions but produced an unhandled `database is not open` coordinator completion after teardown; the test now waits for the scheduled temp-database job to settle.
- The source-linked-only regression failed because planning used only `import_session_impacts`.
- The atomic-staging regression failed because a throwing replacement-job staging callback was ignored and cleanup committed.

### GREEN

- `npm run typecheck`
  - Passed.
- `npx vitest --run src/daemon/import/__tests__/importRepair.test.ts src/cli/__tests__/mastheadctl.test.ts src/daemon/__tests__/server.test.ts src/core/__tests__/worktreeConnector.test.ts src/app/__tests__/daemonClient.test.ts`
  - 5 files passed, 104 tests passed.
- `git diff --check`
  - Passed.

### Added safety evidence

- Current read-only adapter discovery is mapped into `sourcePlans` and included in the immutable plan hash. Each selected source reports corrected source ID, adapter runtime, availability, selected job IDs, and an unavailable reason.
- Sessions touched by an unavailable corrected source are excluded from deletion/reparse and explicitly preserved. Other independently viable sources in the same request remain repairable.
- Planning unions selected-job `import_session_impacts` with `session_sources` for the selected jobs' sources. Source-linked-only sessions are inventory-visible but preserved with `source_linked_only`; an impact row is required for repair mutation.
- User decisions and `manual_exclusion` are always preserved and never reopened or deleted, including when they have an in-scope impact row.
- Automatic suppressions reopen only for the final `sessionsToReparse` set. Out-of-range and otherwise preserved sessions retain suppression state.
- Selected historical import jobs and work units remain immutable audit/provenance records. Repair no longer requeues old work units.
- Cleanup, cursor reset, and creation of new queued replacement jobs occur in one immediate transaction. Failure to create a durable replacement job rolls back cleanup. Adapter execution is resumed only after commit.
- The successful apply response reports the exact new durable `reimportJobIds`; unavailable sources schedule none.
- Server-route coverage now includes missing job IDs, malformed hashes, read-only preview, hash conflict, unavailable-source preservation, and successful replacement scheduling.
- Shared repair DTOs now define both daemon and typed-client response shapes.
