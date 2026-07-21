# Guided authoring production canary

This record originally governed the failed V3 template recovery rehearsal and the first reviewed V4
production canary. Tyler explicitly superseded the recovery path on 2026-07-20 by authorizing a full,
unrecoverable production reset. The failed corpus, active database, and rollback snapshot were deleted;
the fresh V4 database requires a new canary record and has no V3 restore eligibility.

## Before invalidation

- Under root authorization, use SQLite backup to copy the production database read-only into a unique `/tmp` rehearsal directory. Derive the proposed incident contract from the complete copied population, then review its exact counts, actor/time/schema boundaries, sorted population hashes, bundle and receipt hashes, and enrichment fingerprints before committing it.
- Do not infer, copy from historical prose, or enter guessed counts. `docs/acceptance/guided-authoring-v3-incident-contract.json` remains absent until that audit is complete.
- Run prepare once. Preserve its receipt and verify it names the sibling `masthead.sqlite.backup-current`, reports `PRAGMA integrity_check = ok`, and locks the backup SHA-256, byte size, database ID, and incident audit hash.
- Do not start the normal migrating daemon during audit, prepare, invalidation, or restore. Invalidation must begin within 30 minutes of prepare and only while the active database bytes still match the receipt.

## Invalidation acceptance

- Run invalidation with `--confirm` against the isolated rehearsal copy and retain the immutable receipt. Its invalidated dossiers, preserved completed V3 runs, Workbench resets, enrichment removal/restoration counts, Logbook and Workbench revision outcomes, and unchanged backup evidence must match the reviewed incident contract exactly.
- Re-run the command once to prove idempotence. It must return the stored receipt byte-for-byte after verifying database identity, audit hash, exact artifact IDs, revision outcome, and backup evidence.
- Confirm the exact incident artifacts are absent from Logbook search while their bodies, provenance, V3 bundles, and V3 receipts remain available for audit. No unrelated artifact, run, session, enrichment, claim, or Workbench row may change.

## V4 canary acceptance

Record the request ID, assignment ID, operator, build SHA, database ID, pre/post data revisions, and V4 receipt hash here before approval. The canary is accepted only after the operator verifies complete evidence inspection, useful per-session enrichment, honest verification states, evidence-backed opportunity dispositions, canonical dossier rendering, Logbook visibility, and MCP retrieval.

| Field | Recorded value |
| --- | --- |
| Incident contract hash | Pending Task 14 rehearsal |
| Recovery audit hash | Pending Task 14 rehearsal |
| Prepare receipt hash | Pending execution |
| Invalidation receipt hash | Pending execution |
| V4 request / assignment | Pending canary |
| Operator and accepted-at | Pending canary |
| V4 receipt hash | Pending canary |
| Restore eligibility | CLOSED — superseded by explicit full production reset; no backup remains |
| Restore closure operator / accepted-at | Tyler / 2026-07-20 |

The rehearsal record stores hashes and aggregate boundaries only. It must not contain raw session or artifact IDs, transcript text, artifact bodies, credentials, production paths, or copied database bytes. Flush the acceptance record before cleanup, then remove the rehearsal database, backup, SQLite sidecars, prepared receipt, temporary manifest, and unique rehearsal directory in `finally`, including when any check fails.

## Restore eligibility

For the superseded V3 incident, restore is no longer possible or authorized because the explicit full
reset deleted the active corpus and sibling backup. The rules below describe the historical recovery
contract and must not be applied to the fresh V4 database.

If the canary is rejected or recovery verification fails, restore the verified sibling snapshot under exclusive maintenance and retain that sibling backup. Canary rejection, new drafts, publication attempts, and Logbook or Workbench revision changes do not close restore eligibility. Close it only by changing the explicit `Restore eligibility` row to `CLOSED` and recording the accepting operator and timestamp after the production canary is accepted; deleting or replacing the backup before that point is forbidden.
