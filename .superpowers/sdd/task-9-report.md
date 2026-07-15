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
