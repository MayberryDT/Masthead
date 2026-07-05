# Masthead Product Release Gate

## Fresh launch
- [ ] No daemon running: Masthead starts compatible daemon.
- [ ] Legacy daemon running: Masthead isolates it and starts current daemon.
- [ ] Compatible wrong-data daemon running: Masthead rejects it.
- [ ] Read-only bridge mode is visibly read-only.

## Sources
- [x] Codex supported adapter visible. Evidence: `npm run verify` import smoke and `npm run doctor:json` on 2026-06-26.
- [ ] Missing Codex root explained.
- [x] Detected Codex root shows source locations. Evidence: `npm run doctor:json` reported Codex source connected on 2026-06-26.
- [x] Metadata import populates sessions. Evidence: `npm run verify` import smoke passed on 2026-06-26.
- [x] Transcript import populates messages/tools. Evidence: `npm run verify` import and MCP smokes passed on 2026-06-26.

## Multi-adapter Sources
- [x] Sources shows Codex, Cursor, Claude Code, OpenCode, Aider, OpenClaw, Hermes, Pi, and OMP. Evidence: `supportedAdapters`, registry, scan-service, and Sources UI tests added on 2026-06-27, with OMP promoted and Antigravity pruned on 2026-07-02.
- [x] Scan this computer checks known local locations only. Evidence: `sourceScanService.test.ts` verifies arbitrary home files are ignored on 2026-06-27.
- [x] Connect selected queues metadata import jobs. Evidence: `sourceConnectService.test.ts` verifies per-source metadata jobs on 2026-06-27.
- [x] Transcript import requires explicit approval. Evidence: `/sources/connect` rejects transcript import without approval and adapter transcript routes use existing policy checks.
- [x] Imported sessions appear in Logbook search. Evidence: `multiAdapterImport.test.ts` imports all active adapters and indexes canonical search on 2026-06-27.
- [x] Unrecognized schemas produce diagnostics and do not create fake transcripts. Evidence: `multiAdapterImport.test.ts` covers unrecognized Cursor SQLite diagnostics with zero sessions on 2026-06-27.
- [x] Harness catalog separates active import, detector-only, cloud-reference, and legacy entries. Evidence: `harnessCatalog.test.ts` covers onboarding harnesses, OMP detector-only status, Devin/Jules cloud references, and hidden Gemini CLI.
- [ ] Advanced diagnostics reviewed in rendered Sources UI.
- [ ] `sources-pipeline` doctor check reviewed against current local data.
- [ ] No whole-home scan guarantee reviewed in docs and UI copy.

## Logbook
- [ ] Empty state explains source/import next step.
- [ ] Search returns imported sessions.
- [ ] Row inspector shows provenance.
- [ ] Restart does not duplicate sessions.

## Session dossier
- [x] Board detail loads canonical dossier when available. Evidence: Board cards carry canonical IDs and `npm run doctor:json` loaded a real canonical dossier on 2026-06-26.
- [x] Logbook detail uses the same dossier component. Evidence: `SessionLibraryDetail` and `SessionDetailModal` both render `SessionDossier`; focused UI tests passed on 2026-06-26.
- [x] Dossier shows files, tools, verification, excerpts, timeline, provenance, token usage, and MCP reuse status. Evidence: `SessionDossier.test.tsx` and `sessionDossierRepository.test.ts` passed on 2026-06-26.
- [x] Dossier has live-only fallback. Evidence: `SessionDossier.test.tsx` covers live-only fallback on 2026-06-26.
- [x] Unsupported source-opening actions are hidden. Evidence: `SessionDossier.test.tsx` verifies source-opening actions are omitted on 2026-06-26.

## Enrichment and Board headlines
- [x] Board headline frames refresh through the remote provider when enabled/configured. Evidence: `boardHeadlineEnricher.test.ts` and `openaiBoardHeadlineFrame.test.ts` verify pending, success, invalid-output, and refresh behavior.
- [x] Remote enrichment failures do not silently fall back to deterministic success. Evidence: `openAIProvider.test.ts` and `enrichmentCoordinator.test.ts` verify structured failure results and failed rows on 2026-06-29.
- [x] Failed enrichment is visible in diagnostics and dossier provenance. Evidence: daemon queue records `enrichment_failed`; `sessionDossierRepository.test.ts` verifies latest failed attempt fields on 2026-06-29.
- [x] Audit export is available for shareable traces. Evidence: `enrichmentAudit.test.ts` and `node scripts/masthead-export-enrichment-audit.js --help` passed on 2026-06-29.

## Session transcript detail
- [x] Board detail shows a transcript section. Evidence: `SessionDetailModal` passes transcript props into shared `SessionDossier`; focused UI/type checks passed on 2026-06-27.
- [x] Logbook detail shows the same transcript section. Evidence: `SessionLibraryDetail` passes transcript props into shared `SessionDossier`; focused UI/type checks passed on 2026-06-27.
- [x] Hook-only sessions show a coverage warning. Evidence: `SessionDossier.test.tsx` covers hook-only coverage warning and sparse transcript copy on 2026-06-27.
- [x] Repeated low-value hook events are collapsed. Evidence: `SessionDossier.test.tsx` covers grouped low-value transcript rows on 2026-06-27.
- [x] Detail view does not show raw JSON in primary content. Evidence: transcript DTO exposes text, labels, status, and source refs separately; UI renders text rows, not raw JSON.
- [x] Sparse sessions route user to Sources for transcript import. Evidence: `DossierCoverageBanner` renders the transcript import CTA when coverage includes `transcript_missing`.

## Agent Access
- [x] MCP config uses active database. Evidence: `npm run verify` MCP smoke passed on 2026-06-26.
- [x] Invalid config cannot be copied. Evidence: `npm run verify` MCP tests passed on 2026-06-26.
- [x] Test connection passes. Evidence: focused MCP launch tests and `npm run verify` passed on 2026-06-26.
- [x] Query appears in audit. Evidence: `npm run verify` MCP smoke passed on 2026-06-26.

## Settings
- [x] Settings loads real state. Evidence: `npm run doctor:json` settings contract passed on 2026-06-26.
- [x] Hook test round-trips. Evidence: settings API tests passed through `npm run verify` on 2026-06-26.
- [x] Live connector settings cover Codex, Claude Code, Cursor, Grok Build, OMP, and OpenCode. Evidence: focused settings API tests and `npm run smoke:live` passed on 2026-07-05.
- [x] Live connector install preserves unrelated user hooks and repairs stale Masthead hook commands. Evidence: `settingsApi.test.ts` and `hookAdmin.test.ts` passed on 2026-07-05.
- [x] Multi-runtime live smoke creates separate canonical sessions for all six release targets. Evidence: `npm run smoke:live` passed on 2026-07-05.
- [ ] Open folder works in Electron.
- [x] Delete preview includes database ID. Evidence: Settings UI renders target database and stale-ID preview guard passed on 2026-06-26.

## Data ownership
- [x] SQLite is the canonical product store. Evidence: `npm run verify` and SQLite maintenance tests passed on 2026-06-26.
- [x] Legacy NDJSON is migration/compatibility only and receives no new product writes. Evidence: canonical ownership tests passed through `npm run verify` on 2026-06-26.

## Verification
- [x] npm run verify passes. Evidence: 129 test files / 519 tests plus build, endpoint matrix, and smoke passed on 2026-06-26.
- [x] cargo tests pass. Evidence: 23 Rust tests passed on 2026-06-26.
- [x] npm run doctor passes. Evidence: isolated current-branch daemon doctor passed on 2026-06-26.
- [ ] GitHub Actions run passes for the final commit.
