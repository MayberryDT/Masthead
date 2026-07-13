# Durable artifact production recovery and canary evidence

Status: **authorized; release candidate preparation in progress**

This is the signed evidence record for Task 14 of the durable artifact recovery
plan. It is deliberately incomplete until the production recovery is explicitly
authorized and run. Empty fields are stop signs, not permission to infer a pass.

Do not paste transcripts, credentials, environment values, or raw session
content into this file. Record database IDs, hashes, counts, artifact IDs,
session IDs, bounded claim excerpts, review scores, and receipt paths only.

## Authorization boundary

- Explicit production authorization received: [x]
- Authorizing message/task: `"i approve"` in the current Codex task, in direct
  response to the exact production recovery/canary scope
- Authorized operator: `Tyler`
- Authorized at: `2026-07-13T08:19:26-06:00`
- Production database path confirmed under authorization:
  `/home/tyler/.config/masthead-production/masthead.sqlite`
- V1 authoring stopped: [x] — the exact old production Electron and daemon
  processes were gracefully stopped with `SIGTERM` at
  `2026-07-13T08:54:43-06:00`
- Writable daemon stopped and lifecycle ownership verified: [x] — same time;
  the ownership probe reported `stoppedPids: []`

No command below may be run against production until the first checkbox is
signed. Temporary-copy rehearsal does not authorize production invalidation.
Passing the canary does not authorize bounded waves without a separate signed
canary decision.

## Release candidate and pre-production gates

| Item | Required evidence | Result |
|---|---|---|
| Release candidate | Branch `codex/durable-artifact-recovery`; Gate C closeout `d3c61e2c` or a descendant with identical recovery contracts | `d3c61e2c` |
| Gate A | Original canonical dossier contract, snapshot, renderer, and responsive inspection | PASS |
| Gate B | Real V2 runbook, ADR, and incident timeline validated, atomically published, and retrieved | PASS |
| Recovery fixture | Recovery, CLI, and ownership tests | PASS — 91/91 |
| Workbench fixture | Candidate UI/controller/client tests | PASS — 88/88 |
| Durable artifact machine gate | `machineGatePassed: true`; `productionAccessed: false` | PASS |
| Repository verification | Tests, build, schema-23 endpoint matrix, and smokes | PASS — 269 files / 1,898 tests |
| In-app Browser | Candidate and dossier controls at desktop, tablet, 480px, and narrow widths | PASS |

## Step 1 — Installed V2 identity and current counts

While the installed writable daemon is still running, capture the health,
four kind-filtered artifact-count, and capabilities receipts from that same
daemon. Use the installed command, not a worktree-only substitute:

```bash
curl --fail --silent --show-error "$MASTHEAD_BASE_URL/health"
curl --fail --silent --show-error \
  "$MASTHEAD_BASE_URL/logbook/artifacts?kind=session_dossier&limit=1"
curl --fail --silent --show-error \
  "$MASTHEAD_BASE_URL/logbook/artifacts?kind=runbook&limit=1"
curl --fail --silent --show-error \
  "$MASTHEAD_BASE_URL/logbook/artifacts?kind=adr&limit=1"
curl --fail --silent --show-error \
  "$MASTHEAD_BASE_URL/logbook/artifacts?kind=incident_timeline&limit=1"
MASTHEAD_DAEMON_URL="$MASTHEAD_BASE_URL" \
  <installed-mastheadctl> workbench capabilities --json
```

- [ ] Health reports the expected product, API/schema version, app/build
      version, build SHA, primary writable runtime, database path, and database
      ID.
- [ ] Capability is exactly `artifact_authoring`.
- [ ] Protocol is exactly `masthead.workbench.authoring/v1`.
- [ ] Bundle version is exactly `workbench-authoring-v2`.
- [ ] Evidence policy is exactly `candidate_scoped_canonical_evidence`.
- [ ] Installed authoring command is absolute.
- [ ] Capability database ID exactly equals `health.data.databaseId`.
- [ ] Each kind-filtered response supplies its explicit `total`; zero is
      recorded as zero and never inferred from a sparse summary.
- [ ] All six receipts use the same daemon URL and are captured together.

| Field | Recorded value |
|---|---|
| Daemon URL | `pending` |
| App/build version and build SHA | `pending` |
| API and schema version | `pending` |
| Database ID | `pending` |
| Database path | `pending` |
| Installed authoring command | `pending` |
| Health receipt path / captured at | `pending` |
| Four kind-filtered artifact receipts / captured at | `pending` |
| Capability receipt path / captured at | `pending` |
| Dossiers before recovery | `pending` |
| Runbooks before recovery | `pending` |
| ADRs before recovery | `pending` |
| Incident timelines before recovery | `pending` |

Abort if any identity, V2 capability field, or count is missing or unexpected,
or if the health and capabilities database IDs differ. After these receipts and
the frozen sample below are complete, stop the writable daemon before any
offline maintenance.

## Step 1A — Freeze the sample and independent labels

Before candidate discovery, rehearsal, or invalidation, choose exactly five
sessions from each evidence band and freeze the same 25 IDs for both rehearsal
and production. Selection may use read-only canonical session/evidence APIs only.
It must not use generated V1 dossier prose or candidate discovery output.

| Key | Evidence band | Slot | Frozen session ID | Selection reason |
|---|---|---:|---|---|
| S1 | Sparse | 1 | `pending` | `pending` |
| S2 | Sparse | 2 | `pending` | `pending` |
| S3 | Sparse | 3 | `pending` | `pending` |
| S4 | Sparse | 4 | `pending` | `pending` |
| S5 | Sparse | 5 | `pending` | `pending` |
| O1 | Ordinary conversation | 1 | `pending` | `pending` |
| O2 | Ordinary conversation | 2 | `pending` | `pending` |
| O3 | Ordinary conversation | 3 | `pending` | `pending` |
| O4 | Ordinary conversation | 4 | `pending` | `pending` |
| O5 | Ordinary conversation | 5 | `pending` | `pending` |
| T1 | Tool-heavy | 1 | `pending` | `pending` |
| T2 | Tool-heavy | 2 | `pending` | `pending` |
| T3 | Tool-heavy | 3 | `pending` | `pending` |
| T4 | Tool-heavy | 4 | `pending` | `pending` |
| T5 | Tool-heavy | 5 | `pending` | `pending` |
| F1 | Failure/fix | 1 | `pending` | `pending` |
| F2 | Failure/fix | 2 | `pending` | `pending` |
| F3 | Failure/fix | 3 | `pending` | `pending` |
| F4 | Failure/fix | 4 | `pending` | `pending` |
| F5 | Failure/fix | 5 | `pending` | `pending` |
| D1 | Decision-heavy | 1 | `pending` | `pending` |
| D2 | Decision-heavy | 2 | `pending` | `pending` |
| D3 | Decision-heavy | 3 | `pending` | `pending` |
| D4 | Decision-heavy | 4 | `pending` | `pending` |
| D5 | Decision-heavy | 5 | `pending` | `pending` |

An independent reviewer must label all 75 `(session ID, optional artifact kind)`
units before discovery. The immutable label receipt contains exactly these
fields per row: `sessionId`, `kind`, `expectedCandidate`,
`expectedSignatureKey`, `evidenceRefs`, `rationale`, and `reviewer`. A positive
label requires exact canonical evidence refs; a negative label requires a short
reason. Freeze and hash the receipt before discovery.

Freeze the 25-key table in a separate immutable sample receipt before adding any
later publication results to this worksheet.

| Frozen evidence | Recorded value |
|---|---|
| Sample receipt path | `pending` |
| Sample row count (must be 25) | `pending` |
| Sample SHA-256 | `pending` |
| Label receipt path | `pending` |
| Label row count (must be 75) | `pending` |
| Positive labels by kind | `pending` |
| Negative labels by kind | `pending` |
| Label SHA-256 | `pending` |
| Independent reviewer / signed at | `pending` |

The evaluation unit for recall and precision is `(session ID, kind)`. A unit is
discovered positive when at least one discovered candidate of that kind includes
that frozen session in provenance. This fixed 75-unit confusion matrix prevents
discovered positives from defining their own ground truth. The production run
must reuse the exact sample and label receipt hashes used in rehearsal.

## Step 2 — Single verified backup

Record and run the deployment-specific daemon stop command. Verify the Step 1
health URL is unavailable, then run the offline maintenance command:

```bash
<installed-mastheadctl> workbench prepare-v1-recovery \
  --db "$PRODUCTION_DB_PATH" \
  --json
```

- [ ] Full daemon-equivalent writer ownership was acquired.
- [ ] Health URL was unavailable before ownership was acquired.
- [ ] Exactly one `masthead.sqlite.backup-*` snapshot remains.
- [ ] Backup path ends in `masthead.sqlite.backup-current`.
- [ ] Backup database ID equals the Step 1 database ID.
- [ ] `integrityResult` is exactly `ok`.
- [ ] Backup size and pages copied are positive.
- [ ] The backup re-audit hash equals the source audit hash.

| Field | Recorded value |
|---|---|
| Backup path | `pending` |
| Backup database ID | `pending` |
| Integrity result | `pending` |
| Size in bytes | `pending` |
| Pages copied | `pending` |
| Backup created at | `pending` |
| Daemon stop command / receipt | `pending` |

Abort on ownership refusal, identity mismatch, audit drift, failed integrity, or
more than one retained backup.

## Step 3 — Exact failed V1 audit

Run the read-only audit against the explicit production path:

```bash
<installed-mastheadctl> workbench audit-v1-generation \
  --db "$PRODUCTION_DB_PATH" \
  --json
```

| Invariant | Expected | Observed |
|---|---:|---:|
| Contract version | `workbench-authoring-v1` | `pending` |
| Dossiers | 1,283 | `pending` |
| Runbooks | 0 | `pending` |
| ADRs | 0 | `pending` |
| Incident timelines | 0 | `pending` |
| Total artifacts | 1,283 | `pending` |
| Completed V1 runs | 66 | `pending` |
| Sessions | 1,283 | `pending` |
| Actors | exactly one | `pending` |
| Creators | exactly one matching the actor | `pending` |

| Receipt field | Recorded value |
|---|---|
| Audit hash (SHA-256) | `pending` |
| Template fingerprint | `pending` |
| Generation fingerprint | `pending` |
| Generation window | `pending` |
| Publication window | `pending` |
| Schema versions | `pending` |

Abort on any count, membership, actor, creator, schema, template, window, or
hash ambiguity. Do not broaden the selector to make production match.

## Step 4 — Temporary-copy rehearsal

Copy only the verified, self-contained backup into a new temporary directory.
Never copy the live database or its WAL/SHM files. Keep the isolated daemon
stopped while auditing and invalidating the copy. Start it only after
invalidation, with its database path, data directory, port, and daemon URL all
explicitly pointed at the temporary directory. Stop it again before cleanup.

Before rehearsal begins, record exact deployment-specific commands for stopping
and starting the installed production daemon and for restoring a database while
holding daemon-equivalent exclusive ownership. Exercise those same restore
steps against the temporary copy, including sidecar removal and post-restore
identity/integrity checks. Empty or unproved commands prohibit production
invalidation.

- [ ] Temporary copy database ID equals the production/backup database ID.
- [ ] Rehearsal audit hash equals the Step 3 audit hash.
- [ ] Isolated daemon was stopped during copy audit and invalidation.
- [ ] Invalidation on the copy reports exactly 1,283 artifacts and sessions.
- [ ] All 66 V1 runs and receipts remain queryable on the copy.
- [ ] Isolated daemon started only after invalidation and reported the expected
      build and database identity.
- [ ] The stratified 25-session dossier canary passes on the copy.
- [ ] Every positive candidate is authored one candidate per V2 run.
- [ ] Claim-support, retrieval, duplicate, provenance, and protocol checks pass.
- [ ] Human review is complete and passes every threshold.
- [ ] No stop condition fired.
- [ ] Rollback sequence was rehearsed against the temporary copy and restored
      the original artifact counts and audit hash.
- [ ] Temporary daemon stopped and temporary directory deleted after evidence capture.

| Field | Recorded value |
|---|---|
| Temporary directory | `pending` |
| Rehearsal started at | `pending` |
| Rehearsal completed at | `pending` |
| Rehearsal decision | `pending` |
| Rehearsal reviewer | `pending` |
| Production daemon stop command | `pending` |
| Production daemon start command | `pending` |
| Exclusive-ownership restore command | `<installed-mastheadctl> workbench restore-v1-recovery --db <active> --backup <sibling masthead.sqlite.backup-current> --audit-hash <sha256> --confirm --json` |
| Restore rehearsal receipt | `pending` |
| Frozen sample hash / label hash | `pending` |

Production invalidation is forbidden unless this section is completely signed.

## Step 5 — Production invalidation receipt

Confirm the production writable daemon is still stopped. Copy the audit hash
from Step 3 exactly; do not retype or transform it:

```bash
<installed-mastheadctl> workbench invalidate-v1-generation \
  --db "$PRODUCTION_DB_PATH" \
  --audit-hash "$AUDIT_HASH" \
  --confirm \
  --json
```

| Receipt field | Expected | Observed |
|---|---:|---:|
| Audit hash | exact Step 3 hash | `pending` |
| Artifacts invalidated | 1,283 | `pending` |
| Search rows deleted | 1,283 | `pending` |
| Provenance rows deleted | 1,283 | `pending` |
| Sessions reset | 1,283 | `pending` |
| Claims released | exact non-negative receipt value | `pending` |
| Activity ID | one durable recovery event | `pending` |

These are the only `FailedGenerationReceipt` fields. `claimsReleased` counts
still-live matched claims actually changed; it may be zero and must never be
substituted with the artifact or session population.

Verify these postconditions separately after a successful receipt:

- [ ] All 66 completed V1 runs and receipts remain queryable.
- [ ] No matched live claim remains.
- [ ] Current published V1 dossiers, provenance rows, and search rows are absent.
- [ ] All 1,283 affected sessions are reset for V2 publication.
- [ ] Installed daemon is started only after offline verification and its health
      and capabilities receipts match the Step 1 build and database identities.

If the command refuses, stop and capture the pre/post audit hashes and counts.
The refusal is fail-closed and pre-mutation; require unchanged state and do not
blindly restore an unchanged database. Do not retry with a different selector or
hash. If the command succeeds but its receipt or postconditions differ, execute
the rollback procedure below.

## Step 6 — Frozen 25-session dossier canary

Reuse the 25 Step 1A IDs unchanged. Publish and score every dossier.

| Key | Canonical dossier artifact ID | Original renderer equivalent | Findability | Grounding | Reusability | Specificity | Readability | Overall | Reviewer | Pass |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| S1 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| S2 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| S3 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| S4 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| S5 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| O1 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| O2 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| O3 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| O4 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| O5 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| T1 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| T2 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| T3 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| T4 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| T5 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| F1 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| F2 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| F3 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| F4 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| F5 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| D1 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| D2 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| D3 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| D4 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |
| D5 | `pending` | [ ] | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |

Dossier comparison is all-or-nothing: every original section, field, warning,
evidence reference, and presentation behavior must remain materially equivalent.

## Step 7 — Positive candidates and human review

Candidate discovery must run only after the Step 1A label receipt is signed and
hashed. The canary candidate set is every discovered candidate whose provenance
intersects at least one frozen session, including all extra provenance brought
in by a strong join. Do not cherry-pick candidates after seeing their output.
Create one row per canary candidate. One candidate must map to one V2 run and no
more than 12 provenance sessions.

| Candidate ID | Kind | Provenance count | V2 run ID | Published artifact ID | Findability | Grounding | Reusability | Specificity | Readability | Overall | Reviewer | Pass |
|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` | [ ] |

For both dossier and optional-artifact tables, each axis is an integer from 1 to
5. `Overall` is the arithmetic mean of the five axes, rounded to two decimal
places. Record a bounded note for every axis below 4. The canary median is the
ordinary median of every reviewed artifact's unrounded five-axis mean, reported
to two decimals. Review 100% of the 25 dossiers and 100% of optional canary
artifacts; do not sample this phase.

Map discovery back to the frozen 75-unit label receipt and record the confusion
matrix. Recall is `TP / (TP + FN)` and precision is `TP / (TP + FP)`. An
unmatched discovered unit is a false positive; an expected positive with no
matching candidate is a false negative. Do not omit true negatives or change a
label after discovery.

## Step 8 — Machine metrics and stop conditions

| Metric | Required | Observed | Pass |
|---|---:|---:|---|
| Dossiers reviewed | 25/25 | `pending` | [ ] |
| Optional canary artifacts reviewed | 100% | `pending` | [ ] |
| Frozen label units (TP / FP / FN / TN) | all 75 accounted for | `pending` | [ ] |
| Claim-support exact-match coverage | 100% | `pending` | [ ] |
| Candidate recall against reviewer labels | at least 90% | `pending` | [ ] |
| Candidate precision against reviewer labels | at least 80% | `pending` | [ ] |
| Duplicate substantive fingerprints across unrelated provenance | 0 | `pending` | [ ] |
| Unsupported authoring-protocol leaks | 0 | `pending` | [ ] |
| V2 runs above 12 provenance sessions | 0 | `pending` | [ ] |
| Artifacts scoring below 3/5 overall | 0 | `pending` | [ ] |
| Median overall usefulness | at least 4.0/5 | `pending` | [ ] |
| Reviewer-labeled expected canary kinds with zero yield | 0 | `pending` | [ ] |

Immediate rollback conditions:

- [ ] No dossier section is missing or materially different from the original.
- [ ] No unsupported authoring-protocol language appears.
- [ ] Every claim excerpt matches canonical evidence exactly.
- [ ] No substantive fingerprint is duplicated across unrelated provenance.
- [ ] Every reviewer-labeled expected canary kind yields at least one artifact.
- [ ] No canary artifact scores below 3/5.
- [ ] Median canary usefulness is at least 4/5.
- [ ] No V2 run exceeds 12 provenance sessions.
- [ ] Candidate recall is at least 90%.
- [ ] Candidate precision is at least 80%.

Any unchecked item means the canary has not passed.

## Rollback receipt

Rollback restores the single verified backup and stops publication. Do not
partially repair the invalidated database in place. There is no permission to
improvise a restore command during an incident: the exact stop, start, and
exclusive-ownership restore commands must already be recorded and proven in
Step 4.

Run rollback in this order:

1. Stop all authoring, stop the production writable daemon with the recorded
   command, and verify its health URL is unavailable.
2. Run the executable restore command below. It must refuse if daemon-equivalent
   writer ownership cannot be acquired and must hold that ownership through
   replacement and verification.

   ```bash
   <installed-mastheadctl> workbench restore-v1-recovery \
     --db "$PRODUCTION_DB_PATH" \
     --backup "$PRODUCTION_DB_PATH.backup-current" \
     --audit-hash "$AUDIT_HASH" \
     --confirm \
     --json
   ```
3. While ownership is held, verify the backup is the Step 2 self-contained
   `masthead.sqlite.backup-current`, its database ID matches Step 1, and its
   `PRAGMA integrity_check` result is exactly `ok`.
4. Remove the invalidated database's `-wal`, `-shm`, and `-journal` sidecars;
   stage the verified backup as a sibling of the active database; atomically
   rename the stage over the active database; and verify no stale active
   sidecars remain. Never copy the backup into a live database file.
5. Open the restored active database read-only while ownership is still held;
   require the Step 1 database ID, `PRAGMA integrity_check = ok`, the Step 3
   audit hash, and the Step 1 artifact counts. Release ownership only after all
   checks pass.
6. Restart the installed daemon with the recorded command. Re-run the Step 1
   health, capabilities, and four kind-filtered artifact receipts and require
   the same build and database identities plus restored counts. Keep authoring
   stopped until a reviewer signs the rollback receipt.

The successful command object has exactly `databasePath`, `ok`, and `receipt`.
The restore `receipt` must match this exact field set and expected values:

| Receipt field | Expected |
|---|---|
| `artifactsRestored` | `1283` |
| `auditHash` | exact Step 3 SHA-256 |
| `backupPath` | exact sibling `masthead.sqlite.backup-current` |
| `backupPreserved` | `true` |
| `databaseId` | exact Step 1 database ID |
| `integrityResult` | `ok` |
| `runsRestored` | `66` |
| `sessionsRestored` | `1283` |

Any missing command, ownership refusal, backup mismatch, sidecar ambiguity,
failed atomic replacement, identity mismatch, integrity failure, or count drift
is an immediate operator stop and escalation; do not start the daemon.

- Rollback required: `pending`
- Stop condition: `pending`
- Backup restored from: `pending`
- Stop / exclusive-ownership restore / start command receipts: `pending`
- Restored database ID: `pending`
- Integrity check after restore: `pending`
- Restored audit hash: `pending`
- WAL/SHM/journal absence verified: `pending`
- Daemon restart health: `pending`
- Artifact counts after restore: `pending`
- Rollback operator and timestamp: `pending`

## Signed canary decision

- Temporary-copy rehearsal: `pending`
- Production invalidation: `pending`
- 25-session dossier review: `pending`
- Positive-candidate review: `pending`
- Machine stop conditions: `pending`
- Human usefulness threshold: `pending`
- Decision: `NOT AUTHORIZED`
- Reviewer: `pending`
- Signed at: `pending`

Only a signed `PASS — authorize bounded waves` decision permits Step 9.

## Step 9 — Bounded waves

Process 25 candidates per wave, never 25 arbitrary sessions. After every wave,
run the machine report and review a stratified 20% sample.

| Wave | Candidate count | Artifact counts by kind | Machine report | Human sample | Stop condition | Decision |
|---:|---:|---|---|---|---|---|
| 1 | `pending` | `pending` | `pending` | `pending` | `pending` | `pending` |

Never continue automatically after a failed or incomplete wave.

## Step 10 — Final closeout and 30-day review

| Final metric | Recorded value |
|---|---|
| Canonical dossier count | `pending` |
| Runbook count | `pending` |
| ADR count | `pending` |
| Incident timeline count | `pending` |
| Candidate precision | `pending` |
| Candidate recall | `pending` |
| Claim-support coverage | `pending` |
| Duplicate rate | `pending` |
| Median usefulness score | `pending` |
| Minimum usefulness score | `pending` |
| Remaining pending candidates | `pending` |

- GBrain closeout slug: `pending`
- 30-day review due: `pending`
- 30-day review scheduled only after rollout closeout: [ ]
- Search-to-open rate: `pending`
- `search_artifacts` → `get_artifact` follow-through: `pending`
- Repeated retrieval count: `pending`
- Zero-result query rate: `pending`
- Supersede/correction events: `pending`
