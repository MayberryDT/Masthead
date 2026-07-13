# Masthead PRD

> **Supersession (2026-07):** Logbook’s primary searchable unit is a **published artifact**, not a
> session row. Workbench still owns the raw→ready session pipeline. The daemon publishes the original
> canonical dossier as an immutable snapshot; positive-evidence candidates drive runbook, ADR, and
> incident-timeline authoring under **ADR 0013**. ADR 0011 and `CONTEXT.md` define the artifact-first
> boundary. Sections below
> that say “Logbook of past sessions” or “show imported sessions in Logbook” are historical scope
> language—do not reintroduce session-library Logbook UX. Prefer OpenWiki + ADR 0011 for current
> product truth.

## Product Definition

Masthead is a local-first, harness-neutral data layer and session manager for AI agents.

Agent runtimes already create valuable local session history: prompts, responses, tool calls,
files, models, decisions, failures, and outcomes. That data is fragmented across harnesses and
normally becomes difficult to find or reuse once a session ends.

Masthead discovers that history, imports it into a canonical local session graph, continuously
syncs new activity, enriches sessions into compact human- and agent-readable records, and exposes
the result through this product hierarchy:

1. **Canonical session database** — the local source of truth.
2. **Workbench** — the raw-to-publish pipeline for sessions and multi-kind artifacts.
3. **Logbook** — a durable searchable library of published artifacts.
4. **Read-only MCP** — artifact-primary reuse, with session tools retained for evidence.
5. **Now** — a glanceable live view of current sessions.
6. **Sources** — harness discovery and live-connector enablement.

Agent access is the compact MCP information/setup category inside Settings, not a primary
destination or standalone surface.

Live observability is a view over the data layer. It is not Masthead’s category.

## Dream Outcome

After Masthead is installed, every supported agent session becomes durable, organized context.

The user no longer needs to remember which harness, model, machine, project directory, or date
contained an important piece of work. A person can find it in Logbook, and any MCP-compatible
agent can retrieve it with evidence.

Masthead turns context the user already paid to create into memory every agent can reuse.

## Product Boundary

The first useful vertical slice should prove one complete Codex loop:

1. Detect existing Codex history.
2. Import canonical session metadata and transcript records.
3. Show imported sessions in Workbench and publish canonical dossier artifacts into Logbook.
4. Discover a positive-evidence optional-artifact candidate and publish it through one V2 run.
5. Retrieve the published artifacts through read-only MCP with source evidence.
6. Continue syncing new Codex activity into Now and Workbench without duplicating canonical sessions.

Masthead does not become an agent or orchestrator. It does not create a task backlog, launch
agents, approve actions, mutate Git, run shell commands, drive browsers, or expose write-capable
MCP tools. It organizes local session data the user already created and makes that history useful
to humans and existing agents.

The product starts Codex-first because that is the current workflow and because a complete adapter
loop is more useful than shallow support for many runtimes. The core model must still stay
adapter-neutral so Masthead can later support Claude Code, Hermes, OpenClaw, Pi, Kilo Code,
OpenCode, Gemini CLI, Cursor-style agents, Copilot agents, Aider, OpenHands,
SWE-agent-style harnesses, and other popular agent runtimes.

### MVP Definition of Done

The first build is done when Masthead can be dogfooded against real local Codex work and reliably demonstrate the core supervision loop:

1. It runs locally without an account, cloud database, required API key, or internet dependency after installation.
2. It installs, verifies, disables, and uninstalls the Masthead-managed Codex hook through an explicit admin flow with backup and rollback.
3. It discovers at least three simultaneous Codex sessions and shows them as live session cards.
4. Each card shows project, branch or worktree, current state, duration, last meaningful activity, and whether the session has unresolved attention.
5. A Codex approval request or user question creates a top-priority Needs attention item within about one second under normal local conditions.
6. A failed command is visible with exit status, command category, timestamp, and supporting event reference.
7. Three repeated equivalent failures create a possible-loop or repeated-failure item without interrupting on one transient failure.
8. A session that reports completion without observed verification creates a review-needed item.
9. Two active Codex sessions in the same Git worktree family that edit the same normalized repo-relative path create a high-severity conflict card with concrete evidence.
10. Two active sessions in unrelated repositories do not create a false hard conflict.
11. Same-working-directory attribution is clearly labeled degraded unless direct provider evidence proves ownership.
12. Raw prompts, full transcripts, full diffs, full command output, secret contents, screenshots, browser state, shell history, and local database contents are not captured by default.
13. Local history, unresolved alerts, and review dispositions survive restart.
14. Complete local data deletion removes Masthead-local history without touching Codex, Git, source files, or external services.
15. Fixture replay and dogfood tests cover the above scenarios without private credentials.

### Non-Negotiable Product Invariants

- **Canonical local ownership:** Masthead’s SQLite session graph is the source of truth for
  Masthead interfaces after import.
- **Harness-neutral identity:** Session identity is `host + runtime + source session ID`.
- **Raw, normalized, derived separation:** Historical evidence and model enrichment are never
  silently conflated.
- **Read-only agent access:** MCP retrieves history but cannot mutate sessions, files, Git, shell,
  or harness state.
- **Durable by default:** Canonical session metadata and capsules are not subject to short
  observability retention.
- **Live is one view:** The Now surface must not dictate the composition of Workbench, Logbook,
  Sources, or Settings.
- **Original-harness provenance:** Every session preserves enough source identity to inspect or
  resume work in the originating harness when possible.
- **Evidence before claims:** Masthead may summarize agent work, but it must show the evidence
  behind attention, conflict, retrieval, and outcome judgments.
- **One dossier contract:** `SessionDossierDto` and its original renderer are the only user-facing
  session dossier. Publication stores an immutable `canonical-session-dossier-v1` snapshot; agents
  cannot author, enrich, or replace its body.
- **Positive-evidence optional artifacts:** Runbooks, ADRs, and incident timelines begin as explicit
  candidates. One `workbench-authoring-v2` run owns one candidate and at most 12 provenance sessions;
  absence of evidence creates no artifact and no per-session N/A obligation.
- **Durable reuse:** Every optional-artifact claim has daemon-verified typed support and a verbatim
  canonical excerpt. Published bodies must contain enough core knowledge for Logbook and read-only MCP
  reuse without reopening a raw transcript.
- **Local by default:** Core functionality must work without remote services. Remote LLM use is
  opt-in, redacted, scoped, previewable, and auditable.
- **Uncertainty is visible:** When attribution is weak, shared, or inferred, the UI must say so
  plainly.

## User Stories

1. As a solo developer, I want to see every active Codex session on one board, so that I do not have to visit each thread to understand my current work.
2. As a solo developer, I want Masthead to discover Codex sessions automatically, so that monitoring does not depend on manual session entry.
3. As a solo developer, I want each session card to show the project, branch, worktree, duration, current state, and last meaningful activity, so that I can understand the session at a glance.
4. As a solo developer, I want compact session cards when many sessions are active, so that the board uses second-monitor space efficiently.
5. As a solo developer, I want a session card to expand into full detail, so that I can inspect evidence without losing the broader board context.
6. As a solo developer, I want healthy sessions to stay visually quiet, so that attention is not wasted on background activity.
7. As a solo developer, I want sessions needing action to stand out, so that the board immediately answers what needs attention.
8. As a solo developer, I want state labels such as running, reading, testing, approval, conflict, stalled, review, complete, and local only, so that I can distinguish session conditions quickly.
9. As a solo developer, I want "Needs attention" language instead of person-specific labels, so that the product remains generic and professional.
10. As a solo developer, I want decorative visual elements removed or tied to meaning, so that the interface does not feel busy or misleading.
11. As a solo developer, I want attention colors or motion to mean a real state change, so that visual emphasis is trustworthy.
12. As a solo developer, I want the default screen to be the actual app surface, so that Masthead does not waste space on marketing copy or repeated explanation.
13. As a solo developer, I want the board to work on desktop and smaller viewports, so that I can use it on a second monitor, laptop, or narrow window.
14. As a solo developer, I want a top summary of active, attention, conflict, and completed counts, so that I can quickly understand the system load.
15. As a solo developer, I want the board to prioritize sessions by urgency, so that approvals, conflicts, failures, and stalled work appear before quiet work.
16. As a solo developer, I want keyboard navigation through session cards, so that I can triage without relying only on the mouse.
17. As a solo developer, I want search and filtering by project, status, file, branch, and alert type, so that I can find a session from local history.
18. As a solo developer, I want to open the original Codex thread from a session card, so that I can respond in the source tool when needed.
19. As a solo developer, I want to open a changed file or read-only diff from Masthead, so that I can review evidence quickly.
20. As a solo developer, I want Masthead to show when a Codex approval request is pending, so that permissions do not sit unnoticed.
21. As a solo developer, I want Masthead to show when Codex asks a question, so that human input is not buried in a thread.
22. As a solo developer, I want destructive, production, credential, migration, deployment, and data-loss approvals to be treated as immediate decisions, so that high-blast-radius actions are never hidden.
23. As a solo developer, I want Masthead to detect failed commands, so that broken sessions do not keep running silently.
24. As a solo developer, I want repeated equivalent command failures to create a possible-loop warning, so that I can intervene before an agent wastes time.
25. As a solo developer, I want loop warnings to be phrased as possible rather than certain, so that the UI does not overstate inference.
26. As a solo developer, I want long-running commands to be distinguished from stalled sessions, so that Masthead does not interrupt me for legitimate work.
27. As a solo developer, I want a stalled session threshold, so that sessions with no meaningful progress can be surfaced.
28. As a solo developer, I want stalled thresholds to be adjustable later, so that Masthead can match how I actually work.
29. As a solo developer, I want Masthead to independently observe Git state, so that it does not rely only on what an agent says it changed.
30. As a solo developer, I want changed paths, diff stats, staged state, unstaged state, untracked files, branch, worktree, head commit, and dirty state tied to sessions, so that I can review real work.
31. As a solo developer, I want Codex session identity to be the canonical unit of work, so that thread, command, Git, process, and file observations attach to one coherent task.
32. As a solo developer, I want identity confidence labels, so that I know when a file or command is directly attributed, correlated, shared workspace, or unattributed.
33. As a solo developer, I want same-working-directory sessions marked as degraded when attribution is ambiguous, so that Masthead does not create false confidence.
34. As a solo developer, I want Masthead to recommend separate worktrees for high-confidence parallel work, so that conflict detection becomes more reliable.
35. As a solo developer, I want exact same-file overlap across active sessions to create a high-severity conflict, so that I can stop agents from overwriting each other.
36. As a solo developer, I want same Git worktree-family detection to be reliable before remote-clone heuristics, so that V0 alerts are crisp and defensible.
37. As a solo developer, I want Masthead to show conflict evidence including sessions, branches, worktrees, shared paths, Git snapshot time, and source events, so that I understand why the alert exists.
38. As a solo developer, I want same branch and same worktree collisions to be visible, so that I can avoid competing changes in one workspace.
39. As a solo developer, I want migration, lockfile, schema, auth, billing, deployment, dependency, and CI changes marked as high-risk paths, so that review priority reflects blast radius.
40. As a solo developer, I want ignored build artifacts and cache churn suppressed by default, so that Masthead does not become noisy.
41. As a solo developer, I want secret and environment files represented as path metadata only, so that sensitive contents stay hidden.
42. As a solo developer, I want port collisions and local development resource collisions surfaced separately from Git conflicts, so that runtime interference is visible without confusing it with merge risk.
43. As a solo developer, I want shared local database and migration command risks to be visible, so that parallel sessions do not corrupt or reorder stateful work.
44. As a solo developer, I want Masthead to show whether a session ran tests, lint, type checks, or builds after code changed, so that completion claims can be evaluated.
45. As a solo developer, I want completion without verification to create a review item, so that "agent said done" is not treated as proof.
46. As a solo developer, I want Masthead to show if tests passed before later edits, so that stale verification is not mistaken for current verification.
47. As a solo developer, I want completed sessions to remain visible until reviewed, so that useful work does not disappear.
48. As a solo developer, I want outcome records to include changed files, commands, test results, commits, final dirty state, unresolved alerts, and user disposition, so that history reflects the actual result.
49. As a solo developer, I want outcome labels such as accepted, partially accepted, abandoned, superseded, failed, needs review, and unknown, so that completed sessions can be triaged.
50. As a solo developer, I want outcome definitions to be flexible, so that Masthead can adapt as I learn what "good" and "done" mean in practice.
51. As a solo developer, I want immutable evidence separated from adjustable policy, so that changing rules later does not rewrite history.
52. As a solo developer, I want per-repo policy overrides, so that docs-only tasks, UI tasks, migrations, and backend tasks can have different completion expectations.
53. As a solo developer, I want to dismiss or snooze attention items with a reason, so that Masthead can reduce repeat noise without silently changing behavior.
54. As a solo developer, I want Masthead to suggest local policy changes after repeated dismissals, so that the product can learn without hidden model memory.
55. As a solo developer, I want every attention item to show observed facts, inferred interpretation, missing evidence, and a suggested next step, so that I can calibrate trust.
56. As a solo developer, I want LLM-created queue items labeled as contextual or inferred, so that I know which parts are model interpretation.
57. As a solo developer, I want LLM queue items rejected when they lack evidence references, so that hallucinated alerts do not enter the workflow.
58. As a solo developer, I want P0 alerts to require deterministic evidence, so that urgent interruptions are never based only on model judgment.
59. As a solo developer, I want raw evidence expandable beside LLM summaries, so that I can verify any recommendation.
60. As a solo developer, I want the LLM to propose actions but not execute them, so that Masthead remains an assistant to supervision rather than an autonomous operator.
61. As a solo developer, I want remote LLM use to be off by default, so that private project state stays local unless I opt in.
62. As a solo developer, I want remote LLM payloads to be redacted and previewable, so that I know what leaves my machine.
63. As a solo developer, I want local-only mode to remain useful without internet access, so that Masthead is not dependent on a hosted service.
64. As a solo developer, I want raw prompts, full transcripts, full diffs, and full command output disabled by default, so that Masthead captures the minimum useful evidence.
65. As a solo developer, I want capture settings per project, so that sensitive repos can stay metadata-only while less sensitive repos can use richer context.
66. As a solo developer, I want retention controls for snippets, summaries, event history, and pinned items, so that local data does not grow or linger unexpectedly.
67. As a solo developer, I want complete local data deletion, so that I can remove Masthead history from my machine.
68. As a solo developer, I want the Codex hook install flow to show exactly what it changes, so that I can trust the integration.
69. As a solo developer, I want existing Codex hook configuration backed up and merged rather than overwritten, so that Masthead does not break my setup.
70. As a solo developer, I want the hook to fail open when Masthead is closed or unreachable, so that Codex remains usable.
71. As a solo developer, I want hook diagnostics and a test event, so that I know ingestion works.
72. As a solo developer, I want one-click uninstall or rollback for Masthead's hook, so that I can remove it cleanly.
73. As a solo developer, I want adapter degradation to be visible, so that I know when Codex payloads or local observers are unreliable.
74. As a solo developer, I want Masthead to avoid unstable transcript scraping as a primary integration, so that the product does not depend on fragile internals.
75. As a solo developer, I want a local event history that can be replayed, so that bugs and state derivation can be debugged.
76. As a solo developer, I want history search by date, project, file, command, status, alert, branch, commit, and outcome, so that I can reconstruct what happened.
77. As a solo developer, I want crash recovery to restore unresolved alerts and recent session state, so that the board remains useful after restart.
78. As a solo developer, I want duplicate events deduplicated, so that hook retries or out-of-order delivery do not create noisy duplicates.
79. As a solo developer, I want UI updates within about one second under normal conditions, so that the board feels live.
80. As a solo developer, I want six or more concurrent sessions to remain smooth, so that Masthead can support realistic parallel agent usage.
81. As a solo developer, I want long timelines virtualized, so that history does not slow the app.
82. As a solo developer, I want command output excerpts bounded and redacted, so that evidence is useful without storing unbounded logs.
83. As a solo developer, I want native notifications only for configured high-priority events, so that Masthead does not create another noisy inbox.
84. As a solo developer, I want OS notifications coalesced, so that repeated failures or repeated alerts do not spam me.
85. As a solo developer, I want in-app alerts to be the source of truth when the board is visible, so that second-monitor use stays calm.
86. As a solo developer, I want safe local workflow actions such as mark reviewed, mark expected, mark false positive, snooze, abandon, or supersede, so that Masthead supports triage without mutating the source tools.
87. As a solo developer, I want clear blast-radius language on actions, so that I can distinguish opening evidence from changing Codex, Git, or local state.
88. As a solo developer, I want no automatic approvals, shell execution, Git mutation, or agent launching in V0, so that the first release keeps trust boundaries narrow.
89. As a solo developer, I want the UI to feel like a focused session manager rather than analytics software, so that the product matches real supervision work.
90. As a solo developer, I want a dark, dense, hairline-bordered visual system with restrained typography, so that Masthead feels like a native developer console.
91. As a solo developer, I want functional state indicators rather than decorative charts, so that every visual element earns its space.
92. As a solo developer, I want state color to be sparse and meaningful, so that attention and conflict signals are not diluted.
93. As a solo developer, I want the future adapter list to shape architecture but not V0 scope, so that Masthead can grow without compromising the first proof.
94. As a future Claude Code user, I want Masthead to support Claude Code through an adapter, so that the same attention and conflict model works beyond Codex.
95. As a future OpenCode or Gemini CLI user, I want Masthead to support different transport styles, so that sessions can be normalized even when runtimes expose different protocols.
96. As a future Kilo Code, OpenClaw, Hermes, or Pi user, I want Masthead to avoid Codex-specific core nouns, so that support can be added without rewriting the product.
97. As an open-source contributor, I want fixture replay tests and documented schemas, so that I can build adapters safely.
98. As an open-source contributor, I want the core licensed permissively, so that the local desktop tool can be adopted, inspected, and extended.
99. As a security-conscious user, I want no mandatory account, telemetry, or cloud database, so that Masthead remains local-owned software.
100. As the first dogfood user, I want the first release to prove one vertical loop end to end before widening, so that the product earns trust before becoming broad.

## Implementation Decisions

- **Product boundary:** Build Masthead as a local-first session data layer and session manager, not a coding agent, chat client, CI system, project manager, PR manager, hosted monitoring service, or employee analytics product.

- **First adapter:** Implement Codex first. The core state model must remain adapter-neutral, but the initial product quality should be proven through a complete Codex vertical slice before adding other runtimes.

- **Future adapter vocabulary:** Use neutral domain terms such as session, event, request, artifact, tool call, command run, approval, file change, alert, conflict, and outcome. Do not bake Codex-specific terms into core reducers, storage, UI state, or schemas.

- **Initial architecture:** Use a thin real desktop architecture: Electron/Chromium desktop shell, TypeScript local daemon, SQLite local store, and React/TypeScript UI. The daemon owns canonical session data; Electron owns desktop shell responsibilities such as windows, tray, local OS actions, packaging, and daemon lifecycle.

- **Privileged boundary:** Keep filesystem, process, Git, hook ingestion, SQLite writes, redaction, and local observer logic behind the daemon and Electron main/preload boundary. The UI should call narrow typed commands rather than directly reaching into privileged local state.

- **Build sequence and exit gates:** Build in vertical slices that each leave a testable artifact:
  1. **Fixture shell:** Desktop shell, local SQLite store, fixture replay, and mocked session-board UI. Exit when replayed fixtures produce multiple cards and one expanded detail view.
  2. **Hook ingestion:** Fail-open Codex hook helper, local ingestion endpoint, event validation, redaction, and deduplication. Exit when a real Codex session start or approval event appears in Masthead and Codex still works when Masthead is closed.
  3. **Session state:** Session identity resolver, state reducer, live card projection, and restart recovery. Exit when three live Codex sessions are distinguishable by project, branch/worktree, status, and last activity.
  4. **Git evidence:** Git observer, worktree-family identity, changed paths, diff stats, commit detection, and attribution confidence. Exit when Masthead independently shows what changed for each session or marks attribution degraded.
  5. **Conflict proof:** Exact same-file overlap, same-branch/worktree warning, and conflict evidence card. Exit when an intentional two-session file collision is detected before manual merge.
  6. **Attention queue:** Deterministic approval/question/failure/stalled/completed-without-verification rules, coalescing, snooze/dismiss, and native notification policy. Exit when the user can find the session needing intervention without opening every Codex thread.
  7. **LLM contextual layer:** Evidence-packet builder, local/remote privacy controls, schema-validated model output, and inferred queue cards. Exit when contextual items are useful, labeled, evidence-backed, and rejected when unsupported.
  8. **Outcome/history:** Outcome evidence bundle, flexible outcome policy, review dispositions, search, export/delete, and dogfood acceptance script. Exit when completed sessions have credible, inspectable result records.

- **Event model:** Store normalized events in an append-only event store. Derived session state, alerts, conflicts, and outcomes should be rebuildable from events plus current Git/process observations.

- **Event envelope:** Every normalized event should include schema version, internal event ID, session ID when known, source, source event ID when available, occurred time, received time, project/repo/worktree identifiers when known, event type, summary, payload, sensitivity label, and payload hash.

- **Deduplication:** Deduplicate events using provider event ID when available, plus session ID, event type, normalized payload hash, and a short time window. The system must tolerate retries and out-of-order arrival.

- **Minimum V0 data entities:** The local store should represent projects, repositories, worktrees, sessions, events, command runs, file changes, Git snapshots, commits, alerts, conflicts, outcome evidence, outcome policy snapshots, review dispositions, settings, and audit records. Raw provider payloads may be retained only according to sensitivity and capture settings.

- **Deep module boundaries:** The implementation should keep the following modules independently testable:
  - **Event ingestion:** provider/local observer payloads in; validated normalized events or diagnostics out.
  - **Session identity resolver:** event, cwd, process, and Git evidence in; canonical session linkage plus confidence out.
  - **Session state reducer:** ordered or unordered events in; current session state and secondary flags out.
  - **Git observer:** registered worktree in; normalized Git snapshot, changed paths, diff stats, and repo identity out.
  - **Conflict engine:** active sessions and Git/resource evidence in; conflict cards with severity, paths/resources, and evidence out.
  - **Attention engine:** session state, commands, conflicts, outcomes, and policy in; prioritized Needs attention items out.
  - **Evidence-packet builder:** local evidence in; privacy-filtered packet for UI or LLM summarization out.
  - **LLM attention validator:** model response and evidence references in; accepted, downgraded, or rejected contextual item out.
  - **Outcome engine:** final session evidence and policy in; outcome label, review-needed state, and audit snapshot out.
  - **UI projection layer:** derived app state in; stable card, detail, queue, conflict, and history view models out.

- **Session identity module:** Treat the Codex session/thread as the canonical session. Attach repo, worktree, branch, process, command, file, and Git observations as evidence. Identity confidence must be explicit: direct, correlated, shared workspace, or unattributed.

- **Session state reducer:** The reducer should produce one primary status plus secondary flags. Primary statuses include starting, planning, reading, editing, running command, testing, waiting for approval, waiting for user, blocked, stalled, possibly looping, failed, completed unreviewed, completed reviewed, abandoned, and unknown. Secondary flags include dirty worktree, uncommitted changes, tests passed or failed, no tests observed, high-risk change, exact file overlap, shared resource collision, agent claims complete, approval pending, question pending, and adapter degraded.

- **Codex ingestion path:** Start with passive Codex lifecycle hooks plus independent Git/process observation. Add App Server integration later for richer managed mode after the passive loop is proven.

- **Hook installer:** Use an explicit first-run onboarding/admin flow for the global user-level Codex hook. Show the planned change, back up existing config, merge rather than overwrite, run a test event, and provide uninstall/rollback.

- **Hook helper behavior:** The hook helper must be tiny, validate input, redact obvious secrets, forward to a loopback/local ingestion endpoint or local socket with a short timeout, exit successfully when Masthead is unavailable, avoid normal stdout, and never block Codex operation.

- **Git observer module:** Use Git as an independent source of truth for repository identity, worktree identity, branch, head commit, staged paths, unstaged paths, untracked non-ignored paths, diff stats, and commit detection.

- **File/process observer module:** Use file and process observation as triggers and supporting evidence, not as the only source of truth. Account for watcher unreliability, editor save behavior, large repos, and process attribution limits.

- **Conflict engine:** V0 conflict detection should focus on same real workspace overlap and same Git common-directory/worktree-family evidence. Exact same repo-relative path overlap between active sessions is the first high-confidence conflict.

- **Conflict categories:** Support exact file overlap, same worktree or branch collision, high-risk path overlap, migration overlap, shared resource collision, and later module/shared-contract overlap and safe merge simulation.

- **Separate clone policy:** Separate clones with matching remote URL and branch are future lower-confidence remote integration risks, not V0 hard conflicts.

- **Ignored file policy:** Track Git-visible changes and high-risk tracked paths by default. Exclude ignored build/cache output and private raw artifacts by default. Represent secret/env files as path metadata only unless the user explicitly enables richer capture.

- **Shared local resource policy:** Detect ports, dev servers, local databases, Docker/Compose resources, generated output directories, and migration commands as shared-resource warnings. Keep these separate from Git merge conflicts.

- **Attention engine:** Produce a prioritized Needs attention queue that combines deterministic hard rules with evidence-grounded LLM-contextual items.

- **Severity boundary:** P0 immediate-decision alerts require deterministic evidence. P1/P2 items can include deterministic or LLM-contextual reasoning when evidence is present. P3 items are informational and should not interrupt by default.

- **Attention evidence contract:** Every attention item must include session, project, type, severity, timestamp, short title, evidence references, affected paths/commands/events, confidence or support level, suggested next action, dismissal/snooze state, and resolution state.

- **LLM attention contract:** LLM-created items must include observed facts, inferred interpretation, unknowns or missing evidence, recommended action, support level, risk labels, and evidence references. Reject or down-rank items with no evidence, weak evidence, or claims unsupported by the evidence packet.

- **Prompt-injection boundary:** Treat repo files, transcripts, command output, logs, diffs, markdown, HTML, and prior agent prompts as untrusted evidence. Separate trusted policy from untrusted evidence and validate all LLM output before display.

- **Privacy default:** Store metadata and compact redacted evidence locally by default. Raw prompts, full agent messages, full command output, full diffs, ignored private files, screenshots, browser state, credentials, and local database contents are disabled by default.

- **Remote LLM default:** Remote LLM summarization is off by default. If enabled, it must be per project/provider, redacted, packetized, previewable before first send, and auditable.

- **Redaction module:** Run redaction before persistence and again before remote send. Detect common API keys, tokens, private keys, connection strings, cookies, auth headers, credential URLs, secret-like env vars, and sensitive personal data patterns where practical.

- **Retention module:** Provide local retention controls for normalized metadata, redacted snippets, queue summaries, audit records, and pinned items. Prefer pointers and hashes over duplicating raw content.

- **Outcome engine:** Model outcomes as immutable evidence plus flexible policy. Evidence includes files, diff stats, command runs, tests/builds/lint/type checks, commits, final Git state, unresolved alerts/conflicts, timestamps, source confidence, and user review history.

- **Outcome policy engine:** Allow adjustable policy for verification command classifiers, high-risk path globs, stale-verification windows, large-diff thresholds, disposition labels, notification rules, and repo-specific completion expectations. Recompute derived labels without rewriting evidence.

- **UI information architecture:** V0 should include Live Board, Needs attention, Session Detail, Conflict Radar, and History. The Live Board is the default screen and the card system is the primary organizing pattern.

- **Session card model:** Compact cards show project, objective/title, state, duration, branch/worktree or relevant context, current command or last meaningful event, changed-file count, verification/conflict indicators, and one concise reason when attention is needed.

- **Expanded session model:** Expanded cards show objective, current activity, evidence summary, observed/inferred/missing sections, commands, changed files, conflict evidence, verification state, outcome state, and safe actions.

- **Visual system:** Use a dark developer-console style with charcoal surfaces, hairline borders, muted mono labels, compact cards, restrained typography, and minimal color. No hero section, decorative charts, meaningless bars, or generic analytics dashboard composition.

- **Functional state styling:** Color, motion, and emphasis must map to state. Attention and conflict indicators may use a sparse functional accent, but decorative aurora-style elements should not appear as fake charts or unlabelled chrome.

- **Responsive layout:** On large screens, support up to four compact cards per row with dense spacing. On medium screens, reduce columns. On mobile/narrow widths, cards stack cleanly and expanded details remain readable.

- **Safe V0 actions:** Allow open/focus source session, open repo/folder, open file, open read-only diff, snooze, dismiss, mark expected, mark reviewed, mark false positive, mark abandoned, mark superseded, add local note, pause capture, delete/export Masthead-local data, and run read-only conflict analysis.

- **Blocked V0 actions:** Do not approve or deny Codex requests, stop or steer turns, launch agents, run shell commands, mutate Git, stage, commit, push, pull, merge, rebase, edit repo files, control browsers, change sandbox/network permissions, or mutate Codex configuration from normal dashboard controls.

- **Notifications:** Use native notifications only for configured high-priority events or when Masthead is backgrounded. Coalesce repeated alerts. When the board is visible, prefer in-app persistent alerts.

- **History/search:** Keep local history searchable by project, session, file, command, date, status, branch, commit, alert type, conflict type, and outcome disposition.

- **Open-source posture:** Use an MIT-licensed core unless a dependency or future commercial strategy creates a concrete reason to revisit the choice. Keep event protocol, Codex adapter, collector, Git observer, conflict engine, desktop UI, SQLite schema, tests, and fixtures in the open core.

- **Risk register and mitigations:**
  - **Hook trust friction:** Mitigate with explicit install preview, stable hook definition, backup, rollback, health check, and fail-open behavior.
  - **False attention noise:** Mitigate with evidence contracts, coalescing, snooze/dismiss reasons, policy tuning, and no OS notification for low-priority items by default.
  - **False conflict attribution:** Mitigate with worktree-first detection, confidence labels, degraded same-directory mode, and no hard conflict across separate clones in V0.
  - **LLM hallucination:** Mitigate with evidence packets, schema validation, rejected zero-evidence items, visible observed/inferred/missing sections, and deterministic P0 boundaries.
  - **Privacy leakage:** Mitigate with metadata-first capture, redaction before persistence and remote send, remote off by default, payload preview, and local deletion/export controls.
  - **Desktop shell performance and packaging friction:** Electron replaced the Tauri/WebKitGTK shell after Linux performance proved unacceptable. Mitigate with fixture-first development, packaged Electron smoke tests, security fuse checks, stable daemon contracts, and local service-launch verification.
  - **Watcher/process unreliability:** Mitigate by using filesystem and process observers as triggers, while Git snapshots and provider events remain stronger evidence.
  - **Over-broad scope:** Mitigate by treating non-Codex adapters, App Server control mode, PR management, cloud sync, and automation as explicit post-V0 work.

## Testing Decisions

- Tests should verify external behavior and evidence contracts, not internal implementation details. Good tests answer whether Masthead shows the right session state, alert, conflict, privacy behavior, and outcome given realistic inputs.

- Build fixture replay as a first-class test tool. Sanitized Codex hook payloads, App Server-like payloads when available, Git snapshots, command runs, file changes, and process observations should replay into the event store and produce expected derived state.

- Test event normalization with valid, malformed, oversized, duplicate, retried, missing-field, and out-of-order payloads.

- Test the Codex adapter contract with sanitized official-like fixtures. Each fixture should preserve provider identifiers where available, produce normalized events, and label sensitivity correctly.

- Test hook helper behavior as an external contract: valid JSON forwards, bad JSON fails open, Masthead unavailable still exits successfully, timeouts are short, stdout is quiet, and no unbounded local logs are written.

- Test event-store rebuild by deriving session state, alerts, conflicts, and outcomes from stored events after simulated restart.

- Test deduplication using source event IDs, hashes, time windows, and repeated delivery.

- Test the session identity resolver with direct provider IDs, unique cwd/time correlation, process correlation, shared workspace ambiguity, and unattributed observations.

- Test same-directory degraded mode. Masthead must warn about shared workspace risk without claiming precise per-session file attribution unless direct provider evidence exists.

- Test the Git observer against temporary repositories with dirty state, staged files, unstaged files, untracked non-ignored files, ignored files, renames, branch changes, commits, and linked worktrees.

- Test exact-file conflict detection with two active sessions in the same Git common-directory/worktree family changing the same normalized repo-relative path.

- Test no-conflict behavior with two active sessions in unrelated repositories and two sessions in the same repo changing clearly disjoint paths.

- Test high-risk path classifiers for migrations, schemas, lockfiles, dependency manifests, auth paths, billing paths, deployment files, CI files, and env/config templates.

- Test ignored-file policy with build caches, generated outputs, env files, private keys, binary files, screenshots, and local database files. Private content must not be captured by default.

- Test shared local resource warnings for fixed port collisions, auto-shifted dev server ports, local database write/migration overlap, Docker/Compose resources, and lockfile/package-manager interactions.

- Test command classification for test, build, lint, type-check, package install, migration, deployment, destructive, and other commands.

- Test repeated-command-failure detection with normalized equivalent commands and ensure transient single failures do not interrupt while recovery is active.

- Test stalled-session detection with no meaningful progress, long-running expected commands, and noisy but non-progressing event streams.

- Test completed-without-verification and stale-verification behavior by changing files after a passing test.

- Test outcome derivation from evidence: changed paths, diff stats, commands, verification results, commits, dirty/clean final state, unresolved alerts, and user disposition.

- Test outcome policy recomputation. Changing large-diff thresholds, verification command patterns, high-risk path rules, or accepted disposition labels should update derived state without mutating immutable evidence.

- Test LLM attention output validation with valid evidence-backed items, zero-evidence hallucinations, unsupported file claims, weak evidence, conflicting evidence, prompt-injection attempts, and malformed schema output.

- Test redaction before persistence and before remote LLM send using token, private key, connection string, cookie, auth header, credential URL, cloud key, and secret-like env var fixtures.

- Test remote LLM payload preview and consent. Remote send must be blocked until explicitly enabled for the project/provider.

- Test local-only operation without internet. Core session board, Git observer, deterministic attention, conflict detection, local history, and deletion must still work.

- Test UI card priority ordering: approvals and questions first, confirmed conflicts next, repeated failures/stalled work next, review-needed completions next, active work next, and reviewed completions last.

- Test responsive layout at large desktop, medium desktop, tablet/narrow, and mobile widths. Confirm compact cards do not overflow, expanded cards remain readable, and the board reduces columns predictably.

- Test keyboard interaction for moving through cards, opening expanded details, closing panels, searching, and taking local-only triage actions.

- Test visual state semantics. Decorative bars or colored elements must either be absent or tied to labeled state. "Needs attention" must not depend on a person's name.

- Test native notification behavior where practical: only configured high-priority events notify, repeated events coalesce, backgrounded app behavior differs from visible board behavior, and sensitive prompt contents are not shown by default.

- Test local data deletion and export. Deletion should remove Masthead-local history and settings while not touching source repos, Codex sessions, Git state, or external tools.

- Dogfood acceptance tests should include: three simultaneous Codex sessions, two unrelated repos, two worktrees in the same repo, two sessions intentionally editing the same file, one approval request, one repeated failure, one stalled session, one completed-without-tests session, and one clean reviewed completion.

### Release Acceptance Gates

The first dogfood release should not be called ready until these gates pass:

1. **Fixture gate:** Sanitized fixtures replay into the local store and produce expected cards, alerts, conflicts, and outcomes.
2. **Hook gate:** Codex hook installation, health check, fail-open behavior, disable, and uninstall are verified without breaking existing Codex use.
3. **Live-session gate:** Three real Codex sessions appear and update on the board without manual session creation.
4. **Attention gate:** Approval, question, failed command, repeated failure, stalled, and completed-without-verification scenarios create the expected queue items.
5. **Conflict gate:** Exact same-file overlap in the same Git worktree family creates a high-severity conflict, while unrelated repos do not.
6. **Privacy gate:** Default capture excludes raw prompts, full transcripts, full diffs, full command output, secret contents, screenshots, browser state, shell history, and local database contents.
7. **LLM gate:** If contextual LLM attention ships in the release, unsupported model claims are rejected, remote send requires opt-in, and every accepted card has evidence references.
8. **Persistence gate:** Restart preserves sessions, unresolved alerts, conflicts, history, settings, and review dispositions.
9. **Deletion gate:** Local data deletion removes Masthead-local data and leaves Codex, Git, source repos, and external services untouched.
10. **UI gate:** The board supports compact multi-card layout, expanded session detail, responsive column changes, keyboard navigation, and no person-specific attention labels.
11. **Control-boundary gate:** No normal dashboard action can approve Codex requests, run commands, mutate Git, steer agents, drive browsers, or change external state.
12. **Dogfood gate:** The first vertical proof can be demonstrated end to end with real Codex sessions: live detection, Needs attention routing, Git evidence, exact-file conflict, and outcome review.

## Out of Scope

- Additional agent adapters beyond Codex are out of scope for the first release, even though the architecture must support them later.

- Hosted sync, cloud accounts, organization features, team dashboards, employee analytics, productivity ranking, and remote management are out of scope.

- Automatic approvals, autonomous agent control, agent fleet launching, background orchestration, turn steering, and agent interruption are out of scope.

- Git mutation is out of scope. Masthead must not stage, commit, push, pull, merge, rebase, revert, delete branches, or force push in V0.

- Shell, browser, and OS automation are out of scope. Masthead must not run commands, drive browsers, use computer-control surfaces, or change local permissions from normal dashboard actions.

- Codex App Server managed/control mode is out of scope for the first proof, except as a later integration path behind the adapter boundary.

- Remote clone conflict coordination is out of scope for V0 hard conflicts. It can appear later as a lower-confidence remote integration risk.

- Full transcript capture, full prompt capture, full command-output capture, full diff persistence, screenshots, browser state, shell history, and local database contents are out of scope by default.

- Generic token/cost analytics, model comparison dashboards, heatmaps, decorative charts, and broad observability vanity metrics are out of scope for the first release.

- Pull request management, CI platform features, code review automation, merge queues, and deployment orchestration are out of scope.

- Mobile app, multi-machine fleet management, remote access, and hosted collaboration are out of scope.

- A landing page or marketing-first app screen is out of scope for the product UI. The first screen is the working session surface.

## Further Notes

- Masthead is the project name and should be used consistently in product docs, UI, code comments, and future repository materials.

- The current prototype direction is a static visual guide only. It demonstrates compact session cards, one expanded session, multiple state examples, a concise top summary, and a dark console visual system. It does not implement real collectors, hooks, Git polling, LLM classification, persistence, or control logic.

- The visual direction should keep the supplied dark console reference but adapt it from landing-page language into a working desktop application. The useful parts are charcoal surfaces, hairline borders, restrained type, compact mono metadata, pill controls, and minimal meaningful accent. Hero sections, decorative aurora bars, and marketing copy should not carry into the app shell.

- The strongest first demo should show multiple Codex sessions where Masthead identifies the one needing attention, detects an exact same-file conflict with evidence, shows a failed or stalled session, and shows a completed session with outcome evidence.

- The most important trust rule is evidence over claims. Agent text may help explain context, but Git state, command exits, process state, file state, commits, and provider lifecycle events should carry more authority.

- The first implementation work should start with fixture replay and the static session-board UI state model, then connect real Codex hooks. Starting with the hook installer before the replayable core would make failures harder to isolate.

- Post-V0 adapter work should happen only after the Codex vertical proof is reliable. The likely adapter order is Claude Code, OpenCode, Gemini CLI, Kilo Code, GitHub Copilot or Cursor-style surfaces, Aider/OpenHands/SWE-agent-style harnesses, OpenClaw/KiloClaw-style orchestration agents, then Hermes and Pi after their current integration surfaces are verified.

- Every new adapter should meet an adapter-readiness gate before being treated as supported: documented integration surface, fixture capture, normalized event mapping, approval model mapping, session identity mapping, file/Git/resource evidence mapping, privacy review, degradation behavior, and dogfood scenario coverage.

- Open build decisions before implementation starts: minimum supported Codex version, exact hook payload subset required for V0, whether local LLM summarization ships before remote LLM opt-in, default retention periods, first supported operating system target, packaging/signing path, and desktop shell performance gates.

- The first release should be dogfooded before broad adapter work. The product will only deserve multi-agent support after the Codex vertical loop feels reliable, calm, useful, and privacy-respecting.
