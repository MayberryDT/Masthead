# Masthead Product Release Gate

## Fresh launch
- [ ] No daemon running: Masthead starts compatible daemon.
- [ ] Legacy daemon running: Masthead isolates it and starts current daemon.
- [ ] Compatible wrong-data daemon running: Masthead rejects it.
- [x] Read-only bridge mode is visibly read-only. Evidence: `npm run verify` includes `smoke:compatibility`, which forwarded read-only GET/POST endpoints and blocked mutation endpoints without reaching upstream on 2026-07-06.

## Sources
- [ ] Focused supported adapters visible: Cursor, Claude Code, OpenCode, Grok, Hermes, Pi, and OMP.
- [ ] Missing focused source roots explained.
- [ ] Detected focused source roots show source locations.
- [x] Metadata import populates sessions. Evidence: `npm run verify` import smoke passed on 2026-06-26.
- [x] Transcript import populates messages/tools. Evidence: `npm run verify` import and MCP smokes passed on 2026-06-26.

## Multi-adapter Sources
- [x] Sources shows the focused support set: Cursor, Claude Code, OpenCode, Grok, Hermes, Pi, and OMP. Evidence: support set narrowed in runtime catalog, registry, source-status filtering, and live connector settings on 2026-07-06.
- [x] Scan this computer checks known local locations only. Evidence: `sourceScanService.test.ts` verifies arbitrary home files are ignored on 2026-06-27.
- [x] Connect selected queues metadata import jobs. Evidence: `sourceConnectService.test.ts` verifies per-source metadata jobs on 2026-06-27.
- [x] Transcript import requires exact source-scoped approval and Workbench intent. Evidence: Workbench API/CLI tests cover unrelated approved source rejection; import worker tests cover exact-source policy enforcement.
- [x] Imported sessions appear in Logbook search. Evidence: focused import tests cover supported adapters.
- [x] Unrecognized schemas produce diagnostics and do not create fake transcripts. Evidence: focused import tests cover unrecognized source diagnostics with zero sessions.
- [x] Harness catalog exposes only active focused harnesses. Evidence: `RUNTIME_KINDS` and `HARNESS_CATALOG` are the seven-runtime support contract.
- [ ] Advanced diagnostics reviewed in rendered Sources UI.
- [ ] `sources-pipeline` doctor check reviewed against current local data.
- [ ] No whole-home scan guarantee reviewed in docs and UI copy.

## Logbook
- [ ] Empty state explains published-session search state.
- [ ] Search returns imported sessions.
- [x] Logbook table does not own Workbench selection or bulk enrichment. Evidence: App no longer wires Logbook session selection, bulk enrich, or selected detail modal; focused UI tests passed on 2026-07-08.
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
- [x] Sparse sessions route user to Workbench for transcript work. Evidence: Dossier coverage warnings use the Workbench target; focused Dossier tests passed on 2026-07-08.

## Agent Access
- [x] MCP config uses active database. Evidence: `npm run verify` MCP smoke passed on 2026-06-26.
- [x] Invalid config cannot be copied. Evidence: `npm run verify` MCP tests passed on 2026-06-26.
- [x] Test connection passes. Evidence: focused MCP launch tests and `npm run verify` passed on 2026-06-26.
- [x] Query appears in audit. Evidence: `npm run verify` MCP smoke passed on 2026-06-26.
- [x] MCP stays read-only. Evidence: `src/mcp/__tests__/tools.test.ts` asserts no registered tool name exposes apply, write, import, delete, settings, provider, enrich, or mutation operations.

## Workbench
- [x] `mastheadctl` is emitted by the daemon build. Evidence: CLI tests and `npm run build:daemon` cover the package-bin path.
- [x] Workbench status, queue, next, claim, release, activity, not-added, transcript check/preview/import, schema, evidence, validate, apply, artifacts, publish, and batch commands have focused tests.
- [x] Workbench app surface is a dense operations table plus Activity rail, not command-first. Evidence: Workbench UI/controller/handoff tests cover pipeline sessions, selected-session handoff, Activity, Not Added summary, loading/error/empty states, and absence of user-facing CLI command copy.
- [x] Workbench human ops toolbar covers check transcript, import, quality precheck/pass/fail, claim/release, publish, and agent handoff without command-first CLI recipes. Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` (Task 10 focused suites + dogfood path; panel/controller tests).
- [x] Activity rail is a high-contrast console with readable event rows (ok/bad tones, gutter, type, summary). Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` and style commit `02a3d49`; `WorkbenchPanel` Activity tests.
- [x] Workbench can list publish-path sessions through read-only daemon APIs. Evidence: `/workbench/sessions`, `/workbench/activity`, and Not Added read API daemon/client/bridge tests cover pipeline queue semantics.
- [x] User handoff stays disposable while the CLI remains agent-facing. Evidence: handoff builder tests cover selected sessions and redaction of command/file tokens from UI-rendered text.
- [x] Workbench-applied enrichment is visible through current readers. Evidence: apply tests write current `session_capsule`, `live_summary`, and `search_projection` rows using the current prompt version and verify search exposure.
- [x] Local artifacts are visible in session detail. Evidence: dossier UI and repository tests cover current `session_artifacts`.
- [x] Native remote enrichment is not required for launch. Evidence: Dossier no longer renders a native enrich button; Workbench docs and UI make the V1 launch path a user handoff to an agent-facing CLI loop.

## Settings
- [x] Settings loads real state. Evidence: `npm run doctor:json` settings contract passed on 2026-06-26.
- [x] Hook test round-trips. Evidence: settings API tests passed through `npm run verify` on 2026-06-26.
- [x] Live connector settings cover Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP. Evidence: focused settings API tests and `npm run smoke:live` expected after the focused-support cut.
- [x] Live connector install preserves unrelated user hooks and repairs stale Masthead hook commands. Evidence: focused settings API tests cover managed marker repair.
- [ ] Multi-runtime live smoke creates separate canonical sessions for all seven focused runtimes.
- [ ] Open folder works in Electron.
- [x] Delete preview includes database ID. Evidence: Settings UI renders target database and stale-ID preview guard passed on 2026-06-26.

## Data ownership
- [x] SQLite is the canonical product store. Evidence: `npm run verify` and SQLite maintenance tests passed on 2026-06-26.
- [x] Legacy NDJSON is migration/compatibility only and receives no new product writes. Evidence: canonical ownership tests passed through `npm run verify` on 2026-06-26.

## Verification
- [x] npm run verify passes. Evidence: 220 test files / 1195 tests plus build, endpoint matrix, and live/compatibility/import/MCP smokes passed on 2026-07-06.
- [x] cargo tests pass. Evidence: 23 Rust tests passed on 2026-06-26.
- [x] npm run doctor passes. Evidence: isolated current-branch daemon doctor passed on 2026-06-26.
- [ ] GitHub Actions run passes for the final commit.
