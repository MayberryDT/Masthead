# Final integrated fixes report

Date: 2026-07-15

## Outcome

The interrupted final-review diff was preserved, audited, completed, and verified. The pass addresses all six requested requirements:

1. Hermes SQLite planning now creates one transcript unit per distinct source session. Parsing scopes rows, messages, tool calls, and tool results to that unit. A two-session SQLite fixture verifies two complete parsed units and two distinct canonical sessions after ingestion.
2. Hermes invalid JSON/JSONL, non-object rows, missing identity, unknown roles, and unknown row/tool shapes now produce adapter diagnostics. Parser completeness becomes `partial` or `unrecognized`, allowing import health to require repair instead of classifying the session as Not Added.
3. Import health remains written per work unit. Classification now checks all repair-required health rows for the current import job and canonical session. Partial-before-complete and complete-before-partial orderings are covered; provisional automatic state is held/reopened for review, while published/manual state remains sticky. A regression test also proves an older job's repair health cannot hold a clean current job.
4. Completion receipt counts now treat only `publish_path` as on the package path. Suppression counts include only automatic `confirmed_noise`, excluding manual and published state.
5. Exact duplicate detection now persists SHA-256 canonical transcript fingerprints behind an indexed lookup. Migration 028 registers the table/index and adds insert/update/delete invalidation triggers for all six canonical transcript evidence tables. The warmed lookup is bounded in a 60-session corpus (at most 20 prepared queries), and a mutation regression proves stale candidate fingerprints are invalidated without changing exact-match behavior.
6. Repair preview/apply reject `databasePath` and `db` request fields before source discovery, preview, repair, or reimport mutation. The focused daemon route test compares SQLite change counters around every rejection.

## Additional cumulative-impact corrections

- Removed completion settlement's use of latest unscoped session health; that could incorrectly carry repair state across import jobs.
- Added the fingerprint table to critical schema validation.
- Updated production-transition/schema compatibility tests for schema version 28 and made the production transition expectation follow `CURRENT_SCHEMA_VERSION`.
- Removed an obsolete Hermes single-session helper and tightened malformed assistant `tool_calls` shape detection.

## TDD evidence

Two remaining defects were reproduced before the fixes:

- `src/workbench/__tests__/qualityPrecheck.test.ts` failed because a cached fingerprint survived canonical message mutation and because the warmed medium-corpus path prepared 22 queries (target: at most 20). After trigger invalidation and lookup simplification, 15/15 pass.
- `src/daemon/import/__tests__/importCompletionReport.test.ts` failed because a newer repair row from a different import job held the clean current job. After current-job scoping, 7/7 pass.

The schema compatibility test initially exposed hardcoded pre-migration expectations (24/27). Those expectations were updated for migration 028 and rerun green.

## Fresh verification

- `npx vitest --run src/adapters/__tests__/hermesAdapter.test.ts` — 16/16 passed.
- `npx vitest --run src/daemon/import/__tests__/importWorkUnitRunner.test.ts` — 18/18 passed.
- `npx vitest --run src/daemon/import/__tests__/importCompletionReport.test.ts` — 7/7 passed.
- `npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts` — 15/15 passed.
- `npx vitest --run src/daemon/__tests__/server.test.ts -t "import repair routes validate input"` — 1/1 passed, 16 skipped. This required local-port permission; the first sandboxed attempt did not produce a test result.
- `npx vitest --run src/daemon/__tests__/productionTransitionMaintenance.test.ts` — 12/12 passed.
- `npx vitest --run src/daemon/db/__tests__/schema.test.ts` — 14/14 passed.
- `npm run typecheck` — passed.
- `npm run check:product-contract` — passed.
- `npm run check:surface-contract` — passed.
- `npm run verify:no-citations` — passed.
- `npm run build` — passed, including version sync, TypeScript, Vite renderer build, daemon build, and daemon asset copy.
- `git diff --check` — passed.

The known hanging/shared-port broad daemon/UI suite was not run, per instruction.

## Concerns

- The first duplicate check on a database upgraded to migration 028 lazily fingerprints older candidates once; subsequent checks use the persisted indexed lookup. This bounds repeated work without imposing a potentially long schema-migration backfill.
- Vite continues to emit its existing warning that the main minified chunk exceeds 500 kB. The build succeeds, and this pass does not change renderer code.
