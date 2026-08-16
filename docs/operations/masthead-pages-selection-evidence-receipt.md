# Masthead Pages selection integration evidence receipt

Complete this receipt from the exact integrated commit. Bracketed values are required placeholders, not results. Do not replace a placeholder until the named command or observation has actually run.

## Identity and approval

| Field | Recorded value |
| --- | --- |
| Commit SHA | `[UNVERIFIED_COMMIT_SHA]` |
| Branch | `[UNVERIFIED_BRANCH]` |
| Verification date/time | `[NOT_RUN]` |
| Operator | `[NOT_RECORDED]` |
| Database source | `[NOT_RECORDED: disposable fixture or approved offline copy]` |
| Database identity | `[NOT_OBSERVED]` |
| Tyler complete-corpus acceptance | `[NOT_RECORDED — materialized production cutover prohibited]` |
| Compatibility-window owner | `[NOT_RECORDED]` |
| Window start/end conditions and expiry | `[NOT_RECORDED]` |

## Exact verification commands

Run from the integrated Masthead checkout. Preserve the full command, exit code, and output artifact for each row.

### Focused migration, recovery, and fail-closed tests

```bash
npm test -- --run \
  src/daemon/db/__tests__/mastheadPagesEligibilityRecovery.test.ts \
  src/daemon/__tests__/mastheadPagesEligibilityBoundary.test.ts \
  src/daemon/db/__tests__/mastheadPagesSelectionParity.test.ts \
  src/electron/__tests__/mastheadPagesStagedOperations.test.ts \
  src/electron/__tests__/mastheadPagesRemoteClient.test.ts
```

- Exit code: `[NOT_RUN]`
- Passed/failed/skipped counts: `[NOT_OBSERVED]`
- Output artifact: `[NOT_CAPTURED]`

### Offline Masthead Pages smoke

```bash
npm run smoke:masthead-pages:offline
```

- Exit code: `[NOT_RUN]`
- Observable local route/MCP checks: `[NOT_OBSERVED]`
- Hosted-denial or network-isolation observation: `[NOT_OBSERVED]`
- Output artifact: `[NOT_CAPTURED]`

### Bounded selection parity probe

```bash
npm run build:daemon
node scripts/masthead-pages-selection-parity-probe.js
```

- Build exit code: `[NOT_RUN]`
- Probe exit code: `[NOT_RUN]`
- `receiptVersion`: `[NOT_OBSERVED]`
- `ok`: `[NOT_OBSERVED]`
- `snapshotCount`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.eligible`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.ineligible`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.malformed`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.superseded`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.multipleProvenance`: `[NOT_OBSERVED]`
- `corpusCategoryCounts.appliedOnly`: `[NOT_OBSERVED]`
- `scenarioCount`: `[NOT_OBSERVED]`
- `classificationCounts.equal`: `[NOT_OBSERVED]`
- `classificationCounts.legacy_candidate_window_exhausted`: `[NOT_OBSERVED]`
- `classificationCounts.materialization_incomplete`: `[NOT_OBSERVED]`
- `classificationCounts.unaccepted_mismatch`: `[NOT_OBSERVED]`
- `queryPlanEvidence.scenarioCount`: `[NOT_OBSERVED]`
- `queryPlanEvidence.planRowCount`: `[NOT_OBSERVED]`
- `queryPlanEvidence.allPlansNonempty`: `[NOT_OBSERVED]`
- `queryPlanEvidence.eligibilityIndexScenarioCount`: `[NOT_OBSERVED]`
- `queryPlanEvidence.allSearchPlansUseVirtualTable`: `[NOT_OBSERVED]`
- `queryPlanEvidence.searchVirtualTableScenarioCount`: `[NOT_OBSERVED]`
- `queryPlanEvidence.tempOrderScenarioCount`: `[NOT_OBSERVED]`
- Output artifact: `[NOT_CAPTURED]`

Acceptance criterion (not an observed result): the fixed 6-filter by 6-limit matrix reports
`scenarioCount: 36`, `classificationCounts.equal: 36`, and zero for every mismatch or incomplete
classification. The six query-plan scenarios report `queryPlanEvidence.scenarioCount: 6`, a
positive `planRowCount`, `allPlansNonempty: true`, `allSearchPlansUseVirtualTable: true`, and
`searchVirtualTableScenarioCount: 2`. The integrated schema is expected to report
`eligibilityIndexScenarioCount: 6`; the probe intentionally does not hard-fail a lower value, so
record and review any value below six as query-plan drift before cutover.
`tempOrderScenarioCount` is planner-dependent and informational in the inclusive range 0 through 6;
exact ordered resolver assertions prove the result-order contract separately.

### Full integrated gate

```bash
npm run verify
```

- Exit code: `[NOT_RUN]`
- Typecheck/test/build/smoke summary: `[NOT_OBSERVED]`
- Output artifact: `[NOT_CAPTURED]`

## Migration 041 evidence

Record values from the populated schema-40 fixture before and after migration.

```sql
SELECT version, name FROM schema_migrations WHERE version = 41;
SELECT name FROM sqlite_master
 WHERE type = 'table' AND name = 'masthead_pages_artifact_eligibility';
SELECT COUNT(*) FROM sessions;
SELECT COUNT(*) FROM session_artifacts;
SELECT COUNT(*) FROM session_artifact_provenance;
SELECT COUNT(*) FROM masthead_pages_release_mappings;
SELECT COUNT(*) FROM masthead_pages_artifact_eligibility;
PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

| Observable | Before | After |
| --- | --- | --- |
| Migration version/name | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Sessions | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Artifacts | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Provenance rows | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Release mappings | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Eligibility rows | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Foreign-key check | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Integrity check | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Canonical artifact body/fingerprint retained | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |

Migration transaction/startup-backup receipt:

- `backupPath`: `[NOT_OBSERVED]`
- `integrityResult`: `[NOT_OBSERVED]`
- `pagesCopied`: `[NOT_OBSERVED]`
- `sizeBytes`: `[NOT_OBSERVED]`

The startup migration-backup receipt does not include `databaseId`; record database identity from
the production-transition or consistent maintenance-backup receipt in the sections where it exists.

## Interrupted backfill evidence

Record each committed batch in order.

| Batch | Input `afterArtifactId` | `scanned` | `materialized` | `errors` | `nextCursor` | `complete` | Total current-policy rows | Duplicate groups |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before interruption | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| First resumed batch | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Completion batch | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Idempotent rerun | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |

Eligibility diagnostic object:

- `policyVersion`: `[NOT_OBSERVED]`
- `counts.missing`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`
- `counts.duplicate`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`
- `counts.impossible`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`
- `counts.stale_policy`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`
- `counts.orphaned`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`
- `counts.error`: `[NOT_OBSERVED]`; samples: `[NOT_OBSERVED]`

## Backup, restore, and offline-use evidence

- Prepare receipt `databaseId`: `[NOT_OBSERVED]`
- Prepare receipt `state`: `[NOT_OBSERVED]`
- Prepare receipt `sourceSchemaVersion` / `targetSchemaVersion`: `[NOT_OBSERVED]`
- Snapshot `path`: `[NOT_OBSERVED]`
- Snapshot `sha256`: `[NOT_OBSERVED]`
- Snapshot `sizeBytes`: `[NOT_OBSERVED]`
- Mutation used to distinguish active state from snapshot: `[NOT_RECORDED]`
- Restore boundaries observed: `[NOT_OBSERVED]`
- Restore receipt `databaseId`: `[NOT_OBSERVED]`
- Restore receipt `state`: `[NOT_OBSERVED]`
- Restore snapshot path/identity retained: `[NOT_OBSERVED]`
- Restored `PRAGMA integrity_check` / `PRAGMA foreign_key_check`: `[NOT_OBSERVED]`
- Restored migration 041 identity: `[NOT_OBSERVED]`
- Restored eligibility status/policy: `[NOT_OBSERVED]`
- Offline resolver `status`: `[NOT_OBSERVED]`
- Offline ordered `artifactIds`: `[NOT_OBSERVED]`
- Credential reads: `[NOT_OBSERVED]`
- Hosted/network calls: `[NOT_OBSERVED]`

## Resolver-mode and parity evidence

Record the canonical `POST /masthead-pages/selection/resolve` response for the same query and SQLite read snapshot.

| Mode input | Parsed mode | `ok` | `status` | Ordered `artifactIds` | `reason` | `retryable` |
| --- | --- | --- | --- | --- | --- | --- |
| Variable unset | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` |
| `legacy` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` |
| Invalid value: `[VALUE_NOT_RECORDED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` |
| `materialized` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` | `[NOT_APPLICABLE_OR_NOT_OBSERVED]` |

Parity proof:

- Probe `receiptVersion`, `ok`, `snapshotCount`, `corpusCategoryCounts`, `scenarioCount`,
  `classificationCounts`, and every `queryPlanEvidence` aggregate: `[NOT_OBSERVED]`
- Query/filter/limit corpus: `[NOT_RECORDED]`
- Snapshot identity/read boundary: `[NOT_OBSERVED]`
- Exact ordered matches: `[NOT_OBSERVED]`
- Unclassified mismatches: `[NOT_OBSERVED]`
- `legacy_candidate_window_exhausted` count: `[NOT_OBSERVED]`
- For each classified mismatch: legacy computed window, requested count, legacy returned count, new-only artifact ID/current eligibility, and deterministic position: `[NOT_RECORDED]`
- Query-plan aggregate receipt (counts and booleans only; no SQL, filter values, or plan detail):
  `[NOT_OBSERVED]`

## Preparation, finalization, and outbound integrity evidence

For missing durable enrichment, stale enrichment, evaluator error/malformed body, superseded artifact, and unpublished artifact, record:

| Case | Prepare status/error or ineligibility | Finalize status/error | Pending operation before/after | Network calls |
| --- | --- | --- | --- | --- |
| Missing eligibility input | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Stale enrichment | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Evaluator/body error | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Superseded | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |
| Unpublished | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` | `[NOT_OBSERVED]` |

For staged-reference missing/stale, wrong operation kind, schema failure, idempotency mismatch, daemon-stored digest mismatch, and renderer-provided digest mismatch, record:

- Error code: `[NOT_OBSERVED]`
- Pending staged bytes unchanged: `[NOT_OBSERVED]`
- Credential-store `loadRefreshToken` calls: `[NOT_OBSERVED]`
- Hosted fetch calls: `[NOT_OBSERVED]`

Required fail-before-network error fields are observed values such as `staged_missing`, `staged_wrong_operation_kind`, `staged_invalid_publish_request`, `staged_invalid_remove_request`, `staged_idempotency_mismatch`, and `staged_digest_mismatch`; do not mark them present unless the focused command emitted the corresponding proof.

## Caller and rollback proof

1. Caller handling of legacy `{ ok, artifactIds }`: `[NOT_OBSERVED]`
2. Caller handling of materialized `{ ok, status: "complete", artifactIds }`: `[NOT_OBSERVED]`
3. Caller handling of `{ ok, status: "incomplete", artifactIds: [], reason, retryable }` without opening review: `[NOT_OBSERVED]`
4. Materialized mode enabled from this commit: `[NOT_PERMITTED_WITHOUT_TYLER_ACCEPTANCE]`
5. Single configuration change back to `MASTHEAD_PAGES_SELECTION_RESOLVER=legacy`: `[NOT_EXERCISED]`
6. Canonical route after restart uses legacy-compatible response: `[NOT_OBSERVED]`
7. Eligibility table and rows retained through rollback: `[NOT_OBSERVED]`
8. No database restore performed for resolver rollback: `[NOT_OBSERVED]`
9. Mounted caller/recovery path dependency on old resolver: `[NOT_AUDITED]`
10. Legacy resolver deletion status: `[RETAINED_PENDING_ACCEPTANCE_CALLER_ROLLBACK_AND_WINDOW_PROOF]`

## Disposition

- Cutover approved: `[NO — NOT EVALUATED]`
- Rollback required: `[NOT_EVALUATED]`
- Blocking diagnostics or mismatches: `[NOT_RECORDED]`
- Evidence reviewer: `[NOT_RECORDED]`
- Evidence artifact locations: `[NOT_RECORDED]`
