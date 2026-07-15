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
- Final time-boxed gate after canonical scope serialization:
  - `npm run typecheck` passed.
  - Repair/server suites passed: 2 files, 34 tests.

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

## Final findings — corrected source identity and selected-only plans

### RED

- Domain suite failed 3 of 12 tests:
  - viable cleanup succeeded without any staging callback,
  - distinct moved-source repair reset only the corrected cursor and left the original cursor,
  - `preservedSessions` included unrelated canonical sessions, so unrelated arrival changed the plan.
- Server suite failed 2 of 16 tests:
  - one unique compatible moved source was reported as `source_not_discovered`,
  - multiple compatible candidates were also reported as `source_not_discovered` instead of ambiguous.
- A final domain regression showed fabricated replacement IDs were accepted as though they were durable jobs.

### GREEN

- `npm run typecheck`
  - Passed.
- `npx vitest --run src/daemon/import/__tests__/importRepair.test.ts src/daemon/__tests__/server.test.ts src/cli/__tests__/mastheadctl.test.ts src/app/__tests__/daemonClient.test.ts src/core/__tests__/worktreeConnector.test.ts`
  - 5 files passed, 110 tests passed.
- `git diff --check`
  - Passed.

### Final safety evidence

- Discovery prefers an exact source ID. Without one, it accepts exactly one compatible candidate matching runtime and source kind, plus schema/runtime version whenever both sides provide them.
- Zero compatible candidates produce `source_not_discovered`; multiple compatible candidates produce `ambiguous_candidates`. Both states are explicit in the hashed source plan and preserve affected sessions.
- A unique moved source records the explicit original-to-corrected mapping in the hash, persists the corrected source only during transactional apply, and creates the replacement job against the corrected ID.
- Cursor reset scope is hashed and contains both original selected source IDs and corrected source IDs when they differ.
- Destructive apply refuses any viable plan without `stageReimports` before opening the transaction.
- Returned staging IDs must identify real queued import jobs and collectively cover every viable corrected source. Missing, duplicate, fabricated, non-queued, or incomplete staging rolls the transaction back.
- `preservedSessions` contains only affected-union sessions. Unrelated canonical/live session arrival after preview does not change the plan hash and remains untouched by apply.

## Final integrity findings — execution specs and mixed published plans

### RED

- Global discovery mapped two historical source IDs to the same current candidate; both were incorrectly treated as available.
- A selected job's persisted scope could drift after preview without changing the plan hash.
- Replacement validation accepted incomplete or semantically wrong staging (one job covering multiple selected jobs, wrong kind/scope, or extra jobs).
- A mixed plan containing one published session and one independent eligible repair was blocked in full.

### GREEN

- `npm run typecheck`
  - Passed.
- `npx vitest --run src/daemon/import/__tests__/importRepair.test.ts src/daemon/__tests__/server.test.ts src/cli/__tests__/mastheadctl.test.ts src/app/__tests__/daemonClient.test.ts src/core/__tests__/worktreeConnector.test.ts`
  - 5 files passed, 114 tests passed.
- `git diff --check`
  - Passed.

### Final integrity evidence

- Compatible candidates are reserved across the complete selected plan. Any many-to-one collision marks every conflicting historical source `ambiguous_many_to_one`; affected sessions are preserved and no replacement is scheduled.
- The hashed execution spec now includes each selected job ID, original and corrected source IDs, import kind, canonical parsed scope/options, availability, and repair eligibility.
- Plan hashing and replacement-scope comparison use stable object-key ordering, so semantically identical persisted scopes cannot cause a false conflict.
- Apply recomputes that complete spec under the immediate transaction and stages exclusively from the locked hashed job plans. It does not reread mutable old-job kind or scope to construct replacements.
- Each eligible selected job requires exactly one distinct queued replacement job, in deterministic plan order, with the exact corrected source, import kind, and canonical scope. Missing, duplicate, extra, fabricated, wrong-kind, wrong-source, or wrong-scope staging rolls back cleanup.
- Published affected sessions remain explicitly preserved with `published_artifact`. An all-published plan remains blocked, while a mixed plan continues independent eligible cleanup and schedules replacements only for eligible selected jobs.
