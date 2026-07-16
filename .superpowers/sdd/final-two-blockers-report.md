# Final two merge blockers report

Date: 2026-07-15
Base: `72c077bf9499dd910d519cac54ac933cc040aec2`

## Outcome

Both blockers are fixed without production access or shared-port test runs.

### Sessionless repair visibility

- `buildImportCompletionReport` now emits `repair_import` when persisted import health contains any repair-required work unit, independently of error anomalies and independently of canonical session identity.
- `sessionsRepairRequired` remains the truthful distinct canonical-session count.
- The Sources completion receipt derives repair state from both repair work units and affected sessions. It labels the aggregate as repair units, preserves the session count separately when present, and exposes `Preview import repair` for a sessionless repair unit.
- Regression coverage proves a missing-identity work unit yields `succeeded_with_issues`, one repair unit, zero repair sessions, the repair action, and never `Not Added` language.

### Cold duplicate path

- Added deterministic, idempotent initialization of missing session transcript fingerprints in batches of 100 by default.
- Daemon startup runs the backfill after migration 028 and before legacy quality work or server exposure. Initialization verifies that no active session remains unindexed and throws on incomplete readiness, so startup fails closed.
- Runtime quality precheck now fingerprints only the current session, performs the existing indexed exact lookup, and verifies the matched candidate against current canonical evidence. It no longer enumerates or hashes every older missing session.
- Existing six-table migration-028 invalidation triggers remain unchanged. Quality evaluation synchronously refreshes the current session after invalidation.

## TDD evidence

Red failures were observed first for:

- absent `repair_import` on a sessionless repair-health row;
- absent repair styling/action/count in the rendered receipt;
- missing initialization module;
- lifecycle-dependent duplicate tests after removal of request-time legacy prewarming.

Final focused run:

```text
9 test files passed
102 tests passed
```

Covered completion reports, import repair, import trust acceptance, rendered Sources receipts, quality precheck, cold database initialization, daemon initialization, schema migration compatibility, and session import-health persistence.

Additional gates:

```text
npm run typecheck                 passed
npm run check:product-contract    passed
npm run check:surface-contract    passed
npm run verify:no-citations       passed
npm run build                     passed
```

The cold-upgrade test migrates a migration-27 database containing 45 unindexed sessions, observes three batches at batch size 16, verifies all fingerprints exist, verifies a second run does no work, and begins the bounded quality measurement only after initialization. The first precheck prepares at most 20 statements. A daemon lifecycle test separately verifies 12 legacy fingerprints exist immediately when daemon construction returns.

## Concerns

- The production build retains the repository's existing Vite warning that the main JavaScript chunk exceeds 500 kB; this change does not materially affect that bundle.
- Backfill cost is intentionally paid synchronously at daemon startup for upgraded databases. This is the correctness tradeoff required to keep request-time duplicate checks bounded and fail closed.
- No broad shared-port suite, live daemon, or production data was used.
