# Masthead PRD

## Product definition

Masthead is a local-first, harness-neutral session data layer that turns AI-agent session history
into evidence-backed engineering knowledge artifacts people and agents can search and reuse.

Agent runtimes already create valuable local history: prompts, responses, tool calls, files,
decisions, failures, verification, and outcomes. That data is fragmented across harnesses and
normally becomes difficult to find or reuse when a session ends. Masthead captures or imports the
history into one canonical local session graph, deepens useful sessions through Workbench, publishes
validated artifacts into Logbook, and exposes the resulting knowledge through read-only MCP.

The product hierarchy is:

1. **Canonical session database** — the local source of truth for captured session evidence.
2. **Workbench** — the raw-to-publish collaboration pipeline for sessions and artifacts.
3. **Logbook** — the searchable book of published artifacts.
4. **Read-only MCP** — artifact-primary agent reuse with session tools retained for evidence.
5. **Now** — shallow live presence over continuously collected session data.
6. **Sources** — harness discovery and live-connector enablement.

Sessions are capture, Workbench, evidence, and provenance units. A session is never a Logbook row.
Every Logbook row is a published artifact capsule whose body and provenance can be inspected.

## Product wedge

Masthead does not compete primarily as a monitoring console, transcript vault, task manager, or
generic memory layer. Its wedge is reusable engineering knowledge compiled from work the user
already paid an agent to perform.

The default artifact set is:

- **Session dossier** — a single-session account of objective, approach, decisions, outcome,
  verification, risks, lessons, and evidence.
- **Runbook** — a reproducible, potentially multi-session fix or operational recipe.
- **ADR** — a potentially multi-session architecture or design decision with alternatives and
  consequences.
- **Incident timeline** — a potentially multi-session failure narrative ordered by time.

The session package (capsule plus dossier body) is required on the automatic path. Workbench
attempts runbook, ADR, and incident timeline when evidence supports them; otherwise it records an
explicit session-relative N/A. N/A does not create a Logbook row. A session may also satisfy a kind
by contributing provenance to an existing published multi-session artifact.

## Primary user

The first user is a developer who works across multiple local AI coding harnesses and wants the
useful results of that work to survive beyond individual threads.

Their core jobs are:

- connect supported local harnesses without surrendering data ownership,
- see shallow live state without treating Masthead as an agent supervisor,
- identify captured sessions worth deepening,
- import transcript evidence only with explicit source-scoped permission,
- hand compile work to an existing coding agent,
- search published engineering knowledge rather than raw session rows,
- let future agents retrieve that knowledge with provenance and bounded evidence.

## Core journeys

### First run and capture

1. Start Masthead locally.
2. Discover supported harnesses in Sources.
3. Enable, activate, and test live connectors.
4. Import supported existing history or receive new live session evidence.
5. Store canonical session identity and evidence in local SQLite.

Sources owns live connection. It does not own per-session transcript import, enrichment, or
publication.

### Workbench compile

1. Enroll useful captured sessions on the Workbench publish path.
2. Check transcript availability without importing transcript contents.
3. Import transcript evidence only with exact source-scoped permission or explicit user direction.
4. Run deterministic quality checks and suppress obvious noise.
5. Generate a disposable handoff for the user's coding agent.
6. Let the agent claim work, inspect bounded evidence, select provenance, author outputs, validate
   evidence references, and apply artifacts through `mastheadctl`.
7. Publish each valid artifact independently; apply is not publish.
8. Resolve optional automatic kinds through publish, N/A, or contribution.

The user-visible session states are **compile-ready** and **automatic work resolved**. Automatic
work resolved means the session package is published and runbook, ADR, and incident timeline are
each published, N/A, or satisfied by contribution.

### Knowledge retrieval

1. Search Logbook by artifact text, kind, project, and date.
2. Open an artifact body with confidence, provenance sessions, join rationale, and evidence refs.
3. Prefer `search_artifacts` and `get_artifact` when an MCP-connected agent needs reusable knowledge.
4. Use session, excerpt, and transcript MCP tools only when deeper compile evidence is required.

## Surface ownership

### Now

Now shows shallow live cards: state, runtime/source identity, recent activity, and small evidence
counts. It is not a transcript viewer, artifact browser, enrichment surface, or task board.

### Workbench

Workbench is a dense operations table plus Activity rail. It owns transcript work, quality,
claims, evidence, disposable handoffs, artifact authoring coordination, apply receipts, per-artifact
publication, N/A, contribution, and Not Added review. User-facing UI does not expose command recipes
or become an in-app artifact editor.

### Logbook

Logbook is a dense artifact capsule table plus body/provenance inspector. It has no session rows,
bulk selection, enrichment controls, process tracking, or session-era summary strip.

### Sources

Sources is a connector inventory for Discover -> Enable -> Activate -> Test -> Ready. It does not
present import jobs or Workbench pipeline state as its primary workflow.

### Settings

Settings is one compact surface for everyday preferences, Data, Agent access, Advanced, and Danger
zone. Agent access is the MCP information and setup section inside Settings, not a standalone
product destination.

## Product invariants

- **Canonical local ownership:** Masthead SQLite is the source of truth for Masthead-owned data.
- **Harness-neutral identity:** canonical identity includes host, runtime, and source session ID.
- **Raw, normalized, derived separation:** source evidence and model-authored claims are not silently
  conflated.
- **Evidence before claims:** artifact claims cite evidence from their declared provenance set.
- **Per-artifact publication:** applying an artifact never silently publishes it.
- **Artifact-primary retrieval:** Logbook and default MCP reuse operate on published artifacts.
- **Read-only MCP:** MCP cannot mutate Masthead, files, Git, shell, sources, or harness sessions.
- **Local by default:** no account, cloud database, required model key, or internet is required after
  installation.
- **Explicit transcript permission:** transcript import is source-scoped and user-directed.
- **Visible uncertainty:** confidence, missing evidence, inferred state, and join rationale remain
  inspectable.
- **Original-harness provenance:** canonical sessions retain source identity without taking ownership
  of source files or history.
- **Live is one view:** Now does not dictate the composition of Workbench, Logbook, Sources, or
  Settings.

## Release scope

The first release must:

- run locally with the canonical SQLite store and Electron shell,
- support the focused live connector set documented in `docs/reference/sources-v2.md`,
- preserve runtime-scoped canonical session identity,
- support conservative history import where verified adapters exist,
- provide Workbench transcript, quality, claim, evidence, handoff, validate, apply, publish, N/A,
  contribution, and Activity paths,
- publish and retrieve session dossiers, runbooks, ADRs, and incident timelines with provenance,
- expose artifact-primary read-only MCP tools plus bounded session evidence tools,
- protect source data, transcripts, and external state at every mutation boundary,
- pass `docs/acceptance/product-release-gate.md` and the repository verification suite.

## Out of scope

Masthead does not:

- create or assign agent tasks,
- launch, steer, approve, pause, or terminate agent work,
- mutate Git, files, shells, browsers, or source harness sessions through MCP,
- rank developers or provide employee monitoring,
- require a hosted Masthead account or cloud database,
- make raw transcripts or source files the primary Logbook object,
- silently cluster weakly related sessions into multi-session artifacts,
- replace the source harness as the owner of original session history.

## Success criteria

Masthead succeeds when:

- a user can connect a supported harness and see truthful live/captured session state,
- a useful session can travel through Workbench without exposing CLI mechanics to the user,
- every automatic kind ends in published, N/A, or contribution state with receipts,
- Logbook contains only published artifact capsules and opens artifact bodies with provenance,
- an MCP-connected agent can find a relevant artifact and trace its claims to bounded session
  evidence,
- resetting Masthead-owned data never mutates source harness history,
- current documentation and automated product contracts describe the same flow.

## Decision references

- Vocabulary: `CONTEXT.md`
- Visual source of truth: `design.md`
- Artifact-first Logbook: `docs/adr/0011-artifact-first-logbook.md`
- Documentation authority: `docs/adr/0012-documentation-authority-and-history-policy.md`
- Sources V2: `docs/adr/0010-sources-v2-live-connect-only.md`
- Current surface map: `openwiki/logbook-and-workbench.md`
- Current release checklist: `docs/acceptance/product-release-gate.md`
