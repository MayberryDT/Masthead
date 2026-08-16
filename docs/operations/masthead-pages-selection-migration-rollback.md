# Masthead Pages selection migration and rollback

## Safety position

The canonical route stays `POST /masthead-pages/selection/resolve` in both modes. The only switch is:

```text
MASTHEAD_PAGES_SELECTION_RESOLVER=legacy|materialized
```

`legacy` is the production/default mode. An unset, empty, misspelled, mixed-case, or otherwise invalid value resolves to `legacy`. The `materialized` value is an explicit opt-in.

Tyler has not accepted complete-corpus selection semantics. Do not enable `materialized` by default or in production until that acceptance is recorded with the parity and rollback evidence described below.

Migration 041 is additive. It creates `masthead_pages_artifact_eligibility`; it does not rewrite canonical dossier bodies, remove `session_artifacts`, remove release mappings, or backfill inside the migration transaction. Rollback does not drop this table. Current-policy rows may be rebuilt; old-policy rows remain retained and ignored.

The materialized row optimizes matching only; it never authorizes publication. Review preparation and
finalization must hydrate the selected detail and repeat the complete fail-closed eligibility check.
Missing inputs, stale enrichment, evaluator/body errors, superseded state, or unpublished state must
produce no pending outbound operation. Electron must reject staged schema, kind, idempotency, or
canonical-digest failures before credential access or Hosted network access.

## Before migration

1. Stop the daemon through the normal instance launcher. Do not copy a live SQLite file by hand.
2. Confirm the instance database path and that no other daemon or maintenance process owns it.
3. Keep selection on the legacy resolver:

   ```bash
   export MASTHEAD_PAGES_SELECTION_RESOLVER=legacy
   ```

4. Start Masthead through its normal launcher. Daemon startup creates and verifies the single migration backup before applying pending migrations transactionally.
5. Record the migration ledger evidence and the verified backup evidence exposed by the approved
   launcher or verification harness. The migration-backup helper receipt fields are exactly
   `backupPath`, `integrityResult: "ok"`, `pagesCopied`, and `sizeBytes`; it does not report a
   database identity. Keep no more than the one backup allowed by the database hygiene policy.

A migration failure must leave version 041 unapplied and the pre-migration database active. Do not mark a hand-copied database as a verified backup.

## Verify the additive migration

With the daemon stopped, inspect the database using the approved SQLite inspection tool for the environment. Record these observable results, not screenshots alone:

```sql
SELECT version, name
FROM schema_migrations
WHERE version = 41;

SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name = 'masthead_pages_artifact_eligibility';

PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

Expected schema identity:

```text
41 | 041_masthead_pages_artifact_eligibility
```

Also compare pre-migration and post-migration counts for the canonical tables relevant to the instance, including `sessions`, `session_artifacts`, `session_artifact_provenance`, and `masthead_pages_release_mappings`. Migration 041 must not reduce or rewrite those rows. An empty eligibility table immediately after migration is valid; bounded backfill runs separately.

## Backfill and completeness diagnostics

The backfill is bounded, ordered by `artifact_id`, restartable, and idempotent for the current policy. An interruption after a committed batch resumes from the returned cursor. Restarting without a saved cursor is also safe because already-materialized current-policy rows are skipped and the primary key prevents duplicate `(artifact_id, policy_version)` rows.

Record the eligibility diagnostic object with:

- `policyVersion`;
- counts and bounded samples for `missing`, `duplicate`, `impossible`, `stale_policy`, `orphaned`, and `error`;
- the last backfill result fields `scanned`, `materialized`, `errors`, `nextCursor`, and `complete`.

Do not cut over while any current-scope `missing`, `duplicate`, `impossible`, `orphaned`, or `error` count is non-zero. A `stale_policy` row is retained history, not current authority, but the current-policy row must exist before cutover.

For an incomplete canonical response, capture all fields. A bounded backfill miss is:

```json
{
  "ok": true,
  "status": "incomplete",
  "artifactIds": [],
  "reason": "eligibility_backfill_incomplete",
  "retryable": true
}
```

An evaluation failure is:

```json
{
  "ok": true,
  "status": "incomplete",
  "artifactIds": [],
  "reason": "eligibility_evaluation_failed",
  "retryable": false
}
```

`artifactIds` must be empty on every incomplete result. Record the observed `reason` and `retryable` value.

After building the daemon, run the bounded parity corpus:

```bash
npm run build:daemon
node scripts/masthead-pages-selection-parity-probe.js
```

Capture its single JSON receipt: `receiptVersion`, `ok`, `snapshotCount`, all
`corpusCategoryCounts`, `scenarioCount`, all `classificationCounts`, and every
`queryPlanEvidence` count/boolean. A non-zero `materialization_incomplete` or
`unaccepted_mismatch` count blocks cutover. The fixed query-plan gate requires six scenarios, a
positive plan-row count, every plan nonempty, and both search scenarios using the search virtual
table. The integrated schema is expected to report `eligibilityIndexScenarioCount: 6`; the probe
does not hard-fail a lower count, so record and review any value below six as query-plan drift before
cutover. `tempOrderScenarioCount` is planner-dependent and informational in the inclusive range
0 through 6; exact ordered resolver assertions prove the order contract separately. No detailed
plan text, SQL, or filter value appears in the bounded receipt.

## Cutover gate

Do not set `materialized` until all of the following are recorded:

1. Tyler explicitly accepts complete-corpus semantics.
2. Current-policy backfill is complete and structural diagnostics are clean.
3. Query-plan and corpus gates pass.
4. Shadow comparison uses one SQLite read snapshot and shows exact ordered parity, except for rigorously proven `legacy_candidate_window_exhausted` cases.
5. Every permitted mismatch includes evidence that the legacy candidate limit was reached, the requested eligible count was not filled, each new-only artifact is currently eligible, and each appears after the same legacy window in deterministic order.
6. Every mounted caller accepts both the legacy `{ ok, artifactIds }` response and the discriminated complete/incomplete response. An incomplete response opens no review.
7. The rollback proof below passes without restoring a database or deleting the eligibility table.
8. The compatibility-window owner, start condition, end condition, and expiry are recorded. A blank or unapproved window has not started and cannot expire.

After approval, opt in by changing only the launch environment value and restarting the daemon normally:

```bash
export MASTHEAD_PAGES_SELECTION_RESOLVER=materialized
```

Exercise the unchanged canonical route:

```bash
export MASTHEAD_DAEMON_URL="${MASTHEAD_DAEMON_URL:-http://127.0.0.1:17373}"
curl --fail-with-body --silent --show-error \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  --data '{"limit":1}' \
  "$MASTHEAD_DAEMON_URL/masthead-pages/selection/resolve"
```

Record `ok`, `status`, ordered `artifactIds`, and, when incomplete, `reason` and `retryable`. Do not send credentials and do not call Hosted Masthead Pages for this check.

## One-change rollback

Application rollback is exactly one configuration change:

```bash
export MASTHEAD_PAGES_SELECTION_RESOLVER=legacy
```

Restart the daemon through the same launcher, then call the same canonical route. Confirm the response has the legacy-compatible `ok` and ordered `artifactIds` fields and that mounted callers can select and open review.

Do not restore a database, delete or truncate `masthead_pages_artifact_eligibility`, remove old policy rows, rewrite dossier bodies, or alter release mappings for resolver rollback. The additive table remains inert while legacy reads are authoritative.

If the value is accidentally invalid, parsing fails safe to `legacy`; still correct the configuration so operator intent is explicit.

## Backup and emergency restore

Resolver rollback is preferred over database restore. Restore only for a separately diagnosed database failure and only under exclusive database maintenance ownership.

The startup migration-backup receipt contains `backupPath`, `integrityResult: "ok"`, `pagesCopied`,
and `sizeBytes`. A consistent maintenance-backup receipt additionally contains `databaseId`. The
production-transition prepare and restore receipts instead identify the database with `databaseId`,
record `sourceSchemaVersion` and `targetSchemaVersion`, and describe the frozen snapshot with
`snapshot.path`, `snapshot.sha256`, and `snapshot.sizeBytes`. Verification must include
`PRAGMA integrity_check`, `PRAGMA foreign_key_check`, migration 041 identity, eligibility state,
and an offline call to the resolver. A failed staged-restore integrity or identity check must leave
the active database unchanged.

Never invent a backup path, copy a live WAL database manually, accumulate snapshots, or restore solely to change resolver mode.

## Compatibility window and deletion ban

Keep the legacy resolver callable for the whole recorded compatibility window. The window begins only after an approved materialized cutover and ends only when its recorded exit conditions are met.

Do not delete the old resolver before all of these are true:

- Tyler's complete-corpus acceptance is recorded;
- caller compatibility is proven for legacy and discriminated responses;
- materialized completeness and parity evidence is accepted;
- the one-change rollback has been exercised from the integrated commit;
- the recorded compatibility window has ended;
- recovery and mounted/offline paths no longer depend on the old resolver;
- a separate cleanup change is approved.

Until then, old-resolver deletion is a release blocker, not cleanup.
