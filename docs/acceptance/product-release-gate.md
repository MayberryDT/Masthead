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
- [x] Imported sessions enter canonical storage and Workbench; only their published artifacts appear in Logbook search. Evidence: focused import tests plus artifact-only Logbook contract tests.
- [x] Unrecognized schemas produce diagnostics and do not create fake transcripts. Evidence: focused import tests cover unrecognized source diagnostics with zero sessions.
- [x] Harness catalog exposes only active focused harnesses. Evidence: `RUNTIME_KINDS` and `HARNESS_CATALOG` are the seven-runtime support contract.
- [ ] Advanced diagnostics reviewed in rendered Sources UI.
- [ ] `sources-pipeline` doctor check reviewed against current local data.
- [ ] No whole-home scan guarantee reviewed in docs and UI copy.

## Logbook
- [x] Logbook lists published artifacts only; no session row appears as an entry. Evidence: artifact-first repository/API/UI tests and the authoring dogfoods load only receipt artifact ids.
- [x] Search covers complete first-class artifact bodies. Evidence: migration 021/repository regressions plus both authoring dogfoods find runbooks by body-only sentinel phrases.
- [x] Inspector renders the exact `canonical-session-dossier-v1` body through the original dossier presentation and renders every optional-artifact first-class body field, including typed V2 `claimSupport` paths, support kinds, verbatim excerpts, and evidence refs. Malformed canonical and unknown future schemas are explicit. Evidence: focused artifact body and `LogbookInspector` tests plus responsive read-only fixture inspection.
- [x] Logbook table does not own Workbench selection or bulk enrichment. Evidence: App no longer wires Logbook session selection, bulk enrich, or selected detail modal; focused UI tests passed on 2026-07-08.
- [x] Restart preserves one current artifact per lineage. Evidence: `dogfood-workbench-ops.js` observes two lineages and exactly one current published artifact in each before and after daemon restart.

## Session dossier
- [x] Board detail loads canonical dossier when available. Evidence: Board cards carry canonical IDs and `npm run doctor:json` loaded a real canonical dossier on 2026-06-26.
- [x] Logbook canonical dossier artifacts use the original dossier body component. Evidence: `LogbookInspector` routes the exact canonical schema through `SessionDossierContent`; focused UI tests cover all original sections.
- [x] Dossier publication is daemon-owned and immutable. V3 finish applies current durable enrichment before the daemon rebuilds the canonical `SessionDossierDto` snapshot; no standalone dossier publication route accepts raw sessions or authored dossier bodies.
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
- [x] A published dossier is self-contained and does not fetch a live transcript to reconstruct its body. Evidence: Logbook reads the persisted canonical artifact body; raw transcript tools remain separate evidence APIs.
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
- [ ] A raw or merely deterministic session cannot create a Logbook dossier.
- [ ] Agent enrichment is applied before the canonical dossier snapshot is rendered.
- [ ] Copy Agent Prompt is the only primary authoring control in Workbench.
- [ ] Optional artifact kinds are agent-selected; detector suggestions are nonbinding.
- [x] Development and packaged `mastheadctl` launchers are installed beside the app and report the active daemon database identity. Evidence: launcher/daemon/packaged CLI tests, Doctor, and packaged Electron smoke.
- [x] Normal authoring CLI operations are thin daemon HTTP calls; no authoring command opens SQLite. Evidence: `authoringClient`/CLI tests and long-session dogfood with explicit `MASTHEAD_DAEMON_URL`.
- [x] V3 capabilities, selection-scoped open, status, evidence, context, submit, and finish have focused service/API/CLI tests. Open rejects a different database, ineligible or oversized selections, missing canonical evidence, and claim conflicts before output writes.
- [x] Workbench app surface is a dense operations table plus Activity rail, not command-first. Evidence: Workbench UI/controller/handoff tests cover pipeline sessions, selected-session handoff, Activity, Not Added summary, loading/error/empty states, and absence of user-facing CLI command copy.
- [x] Workbench human ops toolbar covers check transcript, import, quality precheck/pass/fail, claim/release, publish, and agent handoff without command-first CLI recipes. Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` (Task 10 focused suites + dogfood path; panel/controller tests).
- [x] Activity rail is a high-contrast console with readable event rows (ok/bad tones, gutter, type, summary). Evidence: `docs/acceptance/workbench-ops-complete-evidence.md` and style commit `02a3d49`; `WorkbenchPanel` Activity tests.
- [x] Workbench can list publish-path sessions through read-only daemon APIs. Evidence: `/workbench/sessions`, `/workbench/activity`, and Not Added read API daemon/client/bridge tests cover pipeline queue semantics.
- [x] User handoff stays disposable, plain-language, and selection-scoped while the CLI command comes from daemon capabilities. Evidence: handoff tests cover selected sessions, visible readiness and provenance context, no durable assignment, and no authored dossier prose.
- [x] Deterministic artifact suggestions are advisory only. Evidence: the labeled corpus exercises runbook, ADR, and incident-timeline signals; V3 submission may ignore every suggestion or author other grounded optional kinds selected by the agent.
- [x] One V3 run owns 1–12 explicitly selected sessions. Evidence: API/service/CLI tests reject duplicate or oversized selections, mismatched database identity, stale evidence, and claim conflicts.
- [x] Submit stores validated per-session enrichment, optional-artifact drafts, findings, and run state without output rows. Evidence: service/API tests observe zero artifacts before finish and reject missing enrichment, unsupported claims, protocol leakage, weak joins, and substantive duplicates.
- [x] Every substantive optional-artifact claim has typed support and a normalized verbatim excerpt of at least 20 characters in canonical evidence. Evidence: semantic quality and persisted-acceptance tests cover the exact field/support-kind matrix.
- [x] V3 finish is atomic and idempotent across durable enrichment, rebuilt canonical dossiers, zero or more agent-selected optional artifacts, current-only search, pipeline state, claims, Activity, and receipt. Evidence: fault injection rolls back at every mutation boundary and retry returns the same V3 receipt.
- [x] Absence of useful optional work creates no optional artifact and no per-session N/A obligation. Evidence: V3 authoring and product-contract tests accept zero optional artifacts and reject blanket optional-kind resolution semantics.
- [x] Every receipt artifact is published and reusable through Logbook and artifact-primary MCP. Evidence: the durable fixture completes five `search_artifacts` → `get_artifact` reuse tasks without raw session tools.
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

## Durable artifact recovery readiness (Gate C)

- [x] Fixture machine gate uses production candidate, validation, publication, Logbook, and MCP paths without opening production data. Run `npm run dogfood:durable-artifacts`.
- [x] Mandatory fixture thresholds are exact: `dossierFidelity`, `claimSupportCoverage`, `persistedArtifactEquality`, labeled candidate recall/precision, Logbook recall@5, MCP recall@5, and artifact-only reuse pass rate all equal `1.0`; claim-support integrity failures, protocol leaks, duplicate substantive fingerprints, unexpected kinds, missing kinds, and raw session tools used by reuse tasks all equal `0`; candidate provenance never exceeds 12; the 100-session discovery page completes within 2,000 ms.
- [x] The fixture kind mix is exactly three runbooks, two ADRs, and two incident timelines; the publication slice includes one optional artifact of each kind plus daemon-built canonical dossiers.
- [x] Recovery audit is read-only and fail-closed on the exact known population: 1,283 V1 dossiers, zero optional artifacts, 66 completed V1 runs, exact membership/template/windows/actor/schema, and one SHA-256 audit hash.
- [x] Recovery prepare requires an explicit database path and exclusive daemon-equivalent writer ownership, makes a SQLite-consistent backup including WAL state, verifies identity and integrity, refuses audit drift, and retains exactly one backup.
- [x] Recovery invalidation requires the exact audit hash and `--confirm`, is one transaction, removes only matched artifact/search/provenance rows, resets affected sessions and optional statuses, releases matched claims, records Activity, and preserves V1 runs/receipts.
- [x] Historical V2 candidate/control inspection is retained as release evidence only. Current V3 Workbench exposes Copy Agent Prompt as its primary authoring control and has no independent canonical-dossier publication control.
- [x] Gate C code readiness is signed from the exact app candidate plus proportionate verification of later surgical deltas. Evidence: app commit `95b23fc1` passed Workbench focused suites 88/88, durable-artifact dogfood with `machineGatePassed: true` and `productionAccessed: false`, full verification at 274 files/2,138 tests, build, schema-24 endpoint matrix, all smokes, and responsive inspection. The later Logbook-only `claimSupport` renderer follow-up passed its 14-test inspector suite, no-citation/product/surface contracts, typecheck, production build, read-only responsive live-fixture inspection, and independent focused review; it is not part of the running `95b23fc1` evaluation package.

Fixture machine PASS does not authorize production. A separately authorized
25-session canary must sample five sessions from each evidence band (sparse,
ordinary, tool-heavy, failure/fix, decision-heavy), publish and visually compare
all canonical dossiers, author every positive candidate one run at a time, and
receive human scores for findability, grounding, reusability, specificity, and
readability. Passing requires 100% review, median overall score at least 4.0, and
no artifact below 3.0. Record authorization, identity, backup, rehearsal,
invalidation, review, rollback, and rollout evidence in the
[production canary worksheet](durable-artifact-production-canary.md); empty
fields never imply a pass.

Stop and restore the single backup if any dossier section differs materially from
the original; unsupported authoring-protocol language appears; a claim excerpt
does not exactly match canonical evidence; unrelated provenance shares a
substantive fingerprint; any expected kind has zero yield; any V2 run exceeds 12
provenance sessions; candidate recall is below 90%; candidate precision is below
80%; any artifact scores below 3/5; or median usefulness is below 4/5. Only after
human approval may rollout continue in waves of 25 candidates, with a 20%
stratified review sample and automatic pause on any stop condition.

## Verification
- [x] `npm run verify` passes on app commit `95b23fc1`. Evidence: 274 test files / 2,138 tests, production build, schema-24 endpoint matrix, and live/compatibility/import/MCP smokes passed. The operator explicitly prohibited another long suite for the later surgical Logbook-only follow-up; its focused delta checks are recorded above.
- [x] cargo tests pass. Evidence: 23 Rust tests passed on 2026-06-26.
- [x] npm run doctor passes. Evidence: isolated current-branch daemon doctor passed on 2026-06-26.
- [x] Durable artifact fixture dogfood passes the machine gate. Evidence: on 2026-07-13, `npm run dogfood:durable-artifacts` reported the exact 3/2/2 candidate mix, all required fidelity/support/retrieval/reuse rates at `1.0`, zero integrity failures/leaks/duplicates/kind errors/raw-session reuse, and a 323.37 ms 100-session discovery page; `productionAccessed` was false. Human review remains deliberately incomplete in fixture output.
- [x] Current authoring capabilities identify `workbench-authoring-v3`, selected-session canonical evidence, nonbinding suggestions, and the operations `suggestions`, `open`, `status`, `evidence`, `context`, `submit`, `finish`; the transport protocol identifier remains `masthead.workbench.authoring/v1`.
- [x] Current contract gates pass. Evidence: `verify:no-citations`, `check:product-contract`, `check:surface-contract`, `check:endpoint-matrix`, and `typecheck` passed on the app release candidate. Endpoint smoke probed schema 24 and exercised the read-only bridge allowlist and mutation blocklist.
- [x] Release-candidate hermetic Vitest suite passes. Evidence: the full gate passed 274 files / 2,138 tests on app commit `95b23fc1`; the later renderer delta passed its focused suite.
- [x] Current production build passes. Evidence: `npm run build` completed Vite and daemon builds after the Logbook renderer follow-up on 2026-07-14.
- [x] Development and packaged Electron smokes pass for app commit `95b23fc1`. Evidence: Electron 42.5.0 launched the isolated database and the packaged CLI reached the packaged daemon; the later source-only renderer follow-up was not repackaged.
- [ ] GitHub Actions run passes for the final commit.
