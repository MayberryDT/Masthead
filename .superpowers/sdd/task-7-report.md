# Task 7 report: conservative, reversible Workbench quality

## Status

Implemented the `keep` / `review` / `suppress` capture-quality disposition, migration 027 suppression provenance, automatic evidence-revision reopening, and sticky manual exclusions.

Ambiguous evidence remains on `publish_path` with `quality_status = 'unchecked'` and `next_action = 'review_quality'`. Only confirmed empty, hook-only, diagnostic-only, and exact-duplicate evidence is automatically suppressed.

## RED

Command:

```text
npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts
```

Result: 3 failed, 8 passed. The new one-request/many-tools, ambiguous-short, and hook-only cases failed because the previous result exposed only boolean pass/fail and broad count-based reasons.

Command:

```text
npx vitest --run src/workbench/__tests__/transcriptQualityReconciler.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

Result: 4 failed, 27 passed. Review-path persistence, changed-evidence reopening, manual stickiness, and suppression provenance were absent.

## GREEN

Command:

```text
npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts src/workbench/__tests__/transcriptQualityReconciler.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/daemon/db/__tests__/schema.test.ts src/workbench/__tests__/legacyPublicationBackfill.test.ts
```

Result: 5 files passed, 58 tests passed.

An additional focused quality run after adding diagnostic-only and exact-duplicate coverage passed 13/13 tests.

Command:

```text
npm run typecheck
```

Result: passed (`tsc --noEmit`).

## Implementation notes

- `CaptureQualityDisposition` is shared and used through the quality, daemon API, ingestion admission, legacy backfill, and authoring-warning seams.
- Migration 027 persists `suppression_category`, `quality_decision_source`, and `quality_evidence_revision`. Historical user decisions are recovered from user-authored Workbench activity (with the known `user_suppressed` reason retained as a fallback).
- Automatic Not Added state reopens only when its evidence revision changes. A user decision never auto-reopens.
- Review is not suppression: it remains on the package path for explicit quality review.
- Existing canonical dossier generation and agent-led artifact publication were not changed.

## Self-review

The standards review found one historical manual-exclusion backfill gap; migration 027 was corrected to derive user provenance from Workbench activity. The spec review then found review-path gaps in live admission and legacy backfill, an overly broad diagnostic-only rule, a manual precheck escape hatch, and an authoring-warning change. All five were corrected before commit. Two non-blocking style judgment calls remain: provenance fields could later become a discriminated value object, and the two review-path transitions contain some deliberate duplication. Keeping those local avoids a broader repository refactor in this surgical task.

## Concerns

Exact-duplicate detection intentionally uses a strict canonical evidence fingerprint and scans only earlier non-deleted sessions. This is conservative and deterministic, but a future performance pass may want a persisted fingerprint if production volume makes repeated comparison material.

## Follow-up review fixes

Commit follow-up requested after review of the initial Task 7 implementation.

### RED

Command:

```text
npx vitest --run src/daemon/db/__tests__/sessionRepository.test.ts src/daemon/db/__tests__/schema.test.ts src/workbench/authoring/__tests__/authoringService.test.ts
```

Result: 5 failed, 55 passed. The failures demonstrated that live evidence did not reopen automatic suppression, ambiguous live evidence reopened a manual exclusion, migration 027 treated a user-triggered automatic `low_evidence` precheck as manual, the authoring warning for review dispositions was absent, and an old shallow-live assertion still expected no Workbench state.

### GREEN

Command:

```text
npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts src/workbench/__tests__/transcriptQualityReconciler.test.ts src/daemon/db/__tests__/sessionRepository.test.ts src/daemon/db/__tests__/schema.test.ts src/workbench/authoring/__tests__/authoringService.test.ts
```

Result: 5 files passed, 80 tests passed.

Command:

```text
npm run typecheck
```

Result: passed (`tsc --noEmit`).

### Resolution

- Live session materialization now delegates to `reconcileImportedTranscript` with `finalizeNoise: false` and a `live_ingest` actor, sharing the evidence-revision and manual-stickiness semantics used by transcript reconciliation.
- Migration 027 classifies the former automatic precheck reason union as automatic even when the historical activity actor was the user-facing Workbench API. `low_evidence` is retained as insufficient evidence; confirmed legacy noise codes use confirmed noise. Other user-authored exclusions remain manual.
- Review dispositions again emit the pre-existing capture-quality warning in authoring evidence; no authoring output behavior was changed by Task 7.

## Historical suppression migration follow-up

Migration 027 was tightened after a final review finding: historical broad automatic decisions must be reopened immediately, rather than waiting for a later evidence-revision comparison.

### RED

Command:

```text
npx vitest --run src/daemon/db/__tests__/schema.test.ts
```

Result: 1 failed, 13 passed. Historical `duplicate_noise`, `low_evidence`, `metadata_only`, `missing_identity`, and `no_messages` rows all remained `not_added_to_logbook / failed / none` instead of reopening for review.

### GREEN

Command:

```text
npx vitest --run src/daemon/db/__tests__/schema.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts src/workbench/__tests__/transcriptQualityReconciler.test.ts
```

Result: 3 files passed, 45 tests passed.

Command:

```text
npm run typecheck
```

Result: passed (`tsc --noEmit`).

### Resolution

- Migration 027 keeps only stored `hook_only`, `empty`, `diagnostic_only`, and `exact_duplicate` automatic reasons suppressed as confirmed noise.
- Every other historical automatic Not Added row reopens to `publish_path`, `review_quality`, and `quality_status = 'unchecked'` with `insufficient_evidence` provenance.
- The original non-publication reason and activity audit are preserved.
- Explicit or activity-proven manual exclusions remain `not_added_to_logbook` with sticky user/manual provenance.
