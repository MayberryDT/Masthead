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
