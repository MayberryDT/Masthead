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
- [x] Logbook lists published artifacts only; no session row appears as an entry. Evidence: artifact-first repository/API/UI tests and the authoring dogfoods load only receipt artifact ids.
- [x] Search covers complete first-class artifact bodies. Evidence: migration 021/repository regressions plus both authoring dogfoods find runbooks by body-only sentinel phrases.
- [x] Inspector renders every dossier, runbook, ADR, and incident-timeline first-class body field while retaining V1 body compatibility. Evidence: focused artifact body and `LogbookInspector` tests.
- [x] Logbook table does not own Workbench selection or bulk enrichment. Evidence: App no longer wires Logbook session selection, bulk enrich, or selected detail modal; focused UI tests passed on 2026-07-08.
- [x] Restart preserves one current artifact per lineage. Evidence: `dogfood-workbench-ops.js` observes two lineages and exactly one current published artifact in each before and after daemon restart.

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
- [x] Doctor verifies the authoring command and boundary. Evidence: `artifact-authoring` check requires health capability, exact operation definitions, executable absolute or PATH-resolved command, installed CLI/daemon database identity equality, while the MCP check rejects non-read-only tools.

## Workbench
- [x] Development and packaged `mastheadctl` launchers are installed beside the app and report the active daemon database identity. Evidence: launcher/daemon/packaged CLI tests, Doctor, and packaged Electron smoke.
- [x] Normal authoring CLI operations are thin daemon HTTP calls; no authoring command opens SQLite. Evidence: `authoringClient`/CLI tests and long-session dogfood with explicit `MASTHEAD_DAEMON_URL`.
- [x] Capabilities, open, status, complete evidence, submit, and finish have focused service/API/CLI tests. Open rejects a different database before claims or output writes.
- [x] Workbench app surface is a dense operations table plus Activity rail, not command-first. Evidence: Workbench UI/controller/handoff tests cover pipeline sessions, selected-session handoff, Activity, Not Added summary, loading/error/empty states, and absence of user-facing CLI command copy.
- [x] Workbench human ops toolbar covers check transcript, import, quality precheck/pass/fail, claim/release, publish, and agent handoff without command-first CLI recipes. Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` (Task 10 focused suites + dogfood path; panel/controller tests).
- [x] Activity rail is a high-contrast console with readable event rows (ok/bad tones, gutter, type, summary). Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` and style commit `02a3d49`; `WorkbenchPanel` Activity tests.
- [x] Workbench can list publish-path sessions through read-only daemon APIs. Evidence: `/workbench/sessions`, `/workbench/activity`, and Not Added read API daemon/client/bridge tests cover pipeline queue semantics.
- [x] User handoff stays disposable and plain-language while the CLI command comes from daemon capabilities. Evidence: handoff tests cover immediate selected-session identity, unattended completion, no shell recipe, and no privacy permission prompt.
- [x] All canonical redacted evidence is authorable. Evidence: evidence catalog tests cover both pagination orders and long text; dogfood reads 500/500 unique items and cites decisive evidence after item 480.
- [x] Submit stores findings and run state without output rows. Evidence: service/API tests and both dogfoods observe zero artifact/enrichment rows before finish.
- [x] Finish is atomic and idempotent. Evidence: rollback fault-injection tests plus dogfood immediate/restart retries return the same receipt without duplicates.
- [x] Every automatic kind is published, N/A, or contributed; applied is not resolved. Evidence: bundle validator/service tests and ops dogfood (`runbookStatus: applied`, `resolutionStatus: compile_ready`).
- [x] Every receipt artifact is published and reusable through Logbook and artifact-primary MCP. Evidence: long-session receipt publishes dossier+runbook, ADR/timeline N/A, body-only search true, MCP artifact read true.
- [x] Local artifacts are visible in session detail. Evidence: dossier UI and repository tests cover current `session_artifacts`.
- [x] Native remote enrichment is not required for launch. Evidence: Dossier no longer renders a native enrich button; Workbench hands the user’s existing agent to the daemon-owned local authoring module.
- [x] Logbook correction tools are future scope and MCP remains read-only. Evidence: no authoring/improve/rewrite/remove MCP tools; Doctor and MCP catalog tests enforce read-only permissions.

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
- [x] Daemon-owned authoring focused dogfoods pass. Evidence: on 2026-07-10 the 500-item CLI dogfood reported matched database identity, 500 unique evidence items, late evidence observed, zero pre-finish artifacts, two published artifacts, one resolved session, idempotent retry, body-only Logbook search, and MCP read; the operations dogfood preserved one receipt and one current artifact per lineage across restart.
- [x] Current authoring Doctor passes. Evidence: isolated schema-21 daemon on 2026-07-10 reported `artifact authoring: Installed authoring CLI is ready`, matching CLI/daemon database identity and all five operations; MCP reported 9 read-only tools.
- [x] Current contract gates pass. Evidence: `verify:no-citations`, `check:product-contract`, `check:surface-contract`, `check:endpoint-matrix`, and `typecheck` passed on 2026-07-10. Endpoint smoke probed schema 21 and exercised 36 allowed bridge reads, 3 allowed read-only posts, and 21 blocked mutations.
- [x] Current hermetic Vitest suite passes. Evidence: `env -u CODEX_HOME npm test -- --run` passed 261 files / 1707 tests on 2026-07-10.
- [x] Current production build passes. Evidence: `npm run build` completed Vite and daemon builds on 2026-07-10.
- [x] Current development and packaged Electron smokes pass. Evidence: `npm run smoke:electron` passed Electron 42.5.0; `npm run smoke:electron:packaged` built distributables and proved the bundled-Node installed CLI reached the packaged daemon on 2026-07-10.
- [ ] GitHub Actions run passes for the final commit.
