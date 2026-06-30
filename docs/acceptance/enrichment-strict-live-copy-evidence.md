# Enrichment Strict Live Copy Evidence

## Automated

- `npm test -- --run src/enrichment/__tests__/enrichmentAudit.test.ts src/enrichment/__tests__/openAIProvider.test.ts src/enrichment/__tests__/enrichmentCoordinator.test.ts src/core/__tests__/openaiSessionCopy.test.ts src/ui/__tests__/observabilitySessionCard.test.tsx`: 5 files, 47 tests passed on 2026-06-29.
- `npm test -- --run src/enrichment/__tests__/sessionNarrativeFacts.test.ts src/enrichment/__tests__/workSubject.test.ts src/enrichment/__tests__/sessionCompiler.test.ts src/enrichment/__tests__/openAIProvider.test.ts src/enrichment/__tests__/sessionNarrativeDraft.test.ts`: 5 files, 13 tests passed on 2026-06-29.
- `npm test -- --run src/core/__tests__/boardLiveCopyFacts.test.ts src/core/__tests__/openaiSessionCopy.test.ts src/core/__tests__/sessionCopy.test.ts src/core/__tests__/projection.test.ts src/core/__tests__/liveProjection.test.ts`: 5 files, 60 tests passed on 2026-06-29.
- `npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx src/daemon/__tests__/server.test.ts`: 3 files, 19 tests passed on 2026-06-29.
- `node scripts/masthead-export-enrichment-audit.js --help`: passed on 2026-06-29.
- `node scripts/masthead-reenrich.js --help`: passed on 2026-06-29.

## Manual

| Case | Expected | Result |
|---|---|---|
| Board refresh every 10s | New live copy attempt logged each refresh | Pending final live preview |
| Provider timeout | No silent fallback; failure visible | Covered by tests; pending manual bad-key preview |
| Invalid model output | Failed enrichment row/diagnostic | Covered by mocked provider tests |
| Good transcript | Specific title/live summary | Covered by mocked provider and narrative facts tests |
| Hook-only session | Low confidence/missing transcript | Covered by coverage facts and dossier coverage tests |
| Dossier | Shows provider status/confidence/missing evidence | Covered by repository/UI tests |
| Audit export | Contains input/output/failure trace | Covered by audit logger/export help tests |
