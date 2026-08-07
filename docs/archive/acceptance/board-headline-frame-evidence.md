# Board Headline Frame Evidence

## Automated

- `npx vitest --run src/core/__tests__/boardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineInput.test.ts src/core/__tests__/boardHeadlineFacts.test.ts src/core/__tests__/openaiBoardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineEnricher.test.ts`: covers frame validation/rendering, evidence input, provider parsing, pending state, refresh behavior, and strict failure handling.
- `npx vitest --run src/core/__tests__/liveProjection.test.ts src/core/__tests__/projection.test.ts`: covers projection with headline views and pending/offline modes.
- `npx vitest --run src/ui/__tests__/observabilitySessionCard.test.tsx`: covers SessionCard rendering from `session.headline` with pending/offline labels and no visible AI failure badge.
- `npx vitest --run src/daemon/db/__tests__/boardHeadlineFrameRepository.test.ts src/core/__tests__/ingestServer.test.ts src/daemon/__tests__/config.test.ts`: covers persisted last-good frames, daemon integration, and configuration flags.

## Manual

| Case | Expected |
|---|---|
| Board refresh with configured OpenAI key | Card shows last successful LLM headline or pending state until a frame lands |
| Provider timeout | No local deterministic headline is presented as model output |
| Invalid model output | Refresh metadata/audit records failure, card stays pending or last-good |
| Missing key or disabled enrichment | Offline headline is explicitly marked `source: "offline"` |
| Hook-only session | Headline input carries sparse evidence and transcript coverage state |
| Dossier | Provider status and missing evidence remain visible through provenance |
