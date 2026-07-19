# Logbook and Workbench (artifact-first)

**Decisions:** [ADR 0011](../docs/adr/0011-artifact-first-logbook.md) (Logbook unit), [ADR 0012](../docs/adr/0012-daemon-owned-artifact-authoring.md) (daemon seam), [ADR 0013](../docs/adr/0013-canonical-dossier-and-candidate-authoring.md) (preserved rendering/evidence findings), [ADR 0014](../docs/adr/0014-agent-led-enriched-artifact-authoring.md) (preserved V3 history), [ADR 0015](../docs/adr/0015-guided-authoring-campaigns.md) (current V4 guided authoring), [ADR 0009](../docs/adr/0009-logbook-only-shows-published-sessions.md) (Workbench pipeline ownership).

**Language:** `CONTEXT.md`.

**Cutover:** [artifact-first-logbook-cutover.md](../docs/reference/artifact-first-logbook-cutover.md).

**UI plan (history):** `docs/superpowers/plans/2026-07-09-logbook-workbench-artifact-ui.md`.

## One-line split

| Surface | Unit | Job |
|---------|------|-----|
| **Now** | Live session card | Shallow running/idle/attention |
| **Workbench** | Captured **session** on package path | Transcript, quality, compile handoff, multi-kind resolution |
| **Logbook** | Published **artifact** | Search/browse/open knowledge capsules |

Sessions never become Logbook rows. Provenance points back to sessions.

## Clean-install history intake

The app-level first-run coordinator may start a one-time Workbench-owned history import after live
connector setup. **Everything** means every discovered supported history unit, with no hidden recent
cap; the recent option is the only bounded range. Each runtime uses one durable transcript job that
materializes canonical session identity and evidence together.

Jobs survive restart under the same id. Completed work units are not repeated, interrupted units
return to the queue, and the coordinator restores Import history / Reconcile progress until the
jobs terminate. A metadata shell is provisional: after transcript hydration, Workbench reruns the
quality decision and can return it to the publish path. Tool-only transcripts are usable evidence;
only complete duplicate or hook-only units are terminal noise.

The adapter owns the **transcript unit** and its stable source-session identity. One Grok conversation
directory is one unit; reasoning record ids stay evidence inside that conversation and never become
session ids. Hermes JSON, JSONL, and SQLite evidence merges under the source session id, including
structured tool calls and results.

A fresh recent-history import admits only units whose declared activity is inside the requested
range. An older changed unit is an incremental refresh only when Masthead already has a cursor for
that unit. A requested unit cap is reported as deferred work, not as a completed range. Import
receipts disclose whether each unit used semantic activity, a source-path timestamp, file modified
time, or an unknown timestamp basis.

Import health and Workbench quality answer different questions. Partial, unrecognized, or
identity-ambiguous units need **Import repair** and do not enter Not Added. Complete sessions then
follow the Workbench quality path: meaningful or ambiguous short conversations stay on the package
path for review; only empty, hook-only, diagnostic-only, exact-duplicate, or manually excluded
sessions enter Not Added. An automatic suppression is reversible when its evidence revision changes;
a manual exclusion remains sticky.

## Logbook (locked UI)

- **Row** = published artifact only (`session_dossier`, `runbook`, `adr`, `incident_timeline`).
- **Columns:** Kind · Title/Highlight · Project · Conf · Provenance · Published.
- **Layout:** left capsule table, right inspector = **body + always-visible provenance** (join rationale when multi-session).
- **Filters:** kind · project · date · search (no runtime/model primary, no bulk enrich, no checkboxes, no summary strip).
- **Empty after wipe:** normal until Workbench republishes.

### Code map

| Concern | Where |
|---------|--------|
| Columns / row / table / toolbar / inspector | `src/ui/logbook/` |
| Controller (search + `getLogbookArtifact` detail) | `src/app/logbook/useLogbookController.ts` |
| Client search/detail | `src/app/daemonClient.ts` (`searchLogbook` → `/logbook/artifacts`) |
| Store | `src/daemon/db/sessionArtifactRepository.ts`, `logbookArtifactRepository.ts` |
| HTTP | `GET /logbook/artifacts`, `GET /logbook/artifacts/:artifactId` |

## Workbench (guided enriched artifact authoring)

One durable `workbench-authoring-v4` request produces enriched dossiers and any useful optional artifacts:

1. **Enriched dossier** — the agent writes current durable enrichment for every selected session;
   the daemon then renders the original canonical dossier structure.
2. **Runbook**, **ADR**, **incident timeline** — the agent may create zero or more optional artifacts
   from assignment evidence. A knowledge opportunity is nonbinding, but every high-signal opportunity
   requires an evidence-backed authored, dismissed, merged, or changed-kind disposition.

### Daemon-owned guided authoring

Workbench creates a durable request before copying a handoff. The handoff contains only the opaque
request ID and one instance-bound start command, with no multi-step recipe or session list. One
daemon-owned authoring module then enforces the same quality behavior:

1. persist the compile-ready selection and campaign policy through **Copy Agent Prompt** while
   disclosing any review-needed sessions left out;
2. group assignments of at most 12 sessions using strong opportunity joins before dossier-only groups;
3. return one required next action and record traversal of every canonical evidence page;
4. review grounded enrichment, optional-artifact claims, and opportunity dispositions progressively;
5. stage the first accepted assignment as a three-session canary for operator approval; and
6. atomically publish one accepted assignment before releasing the next.

Masthead never splits a strong opportunity merely to manufacture the canary. It uses a complete
strong group of at most three sessions or diverse dossier-only sessions; if neither exists, request
creation returns `guided_canary_not_constructible` and persists nothing. The immutable assignment
receipt is the proof of success, and a finish retry returns the same receipt. V1, V2, and V3 remain
audit-only; their mutation routes return `authoring_contract_retired`.

### Locked UI vocabulary

- Columns include enrichment, dossier publication, and optional-artifact state.
- Copy Agent Prompt persists the selection and copies one instance-bound start command, no session list or multi-step recipe.
- The agent enriches assignment sessions and exercises optional-artifact judgment; opportunities are nonbinding but require disposition when high signal.
- Canary drafts remain staged until an operator approves or rejects them from Workbench Activity.
- Apply ≠ publish.

### Guided authoring vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Assignment = one daemon-grouped authoring unit containing at most 12 sessions.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = authored, dismissed, merged, or changed kind, with evidence-backed rationale.

Canary = the first staged assignment of at most 3 sessions, reviewed by an operator before publication.

Next action = the single command Masthead requires from the agent at the current assignment state.

### Code map

| Concern | Where |
|---------|--------|
| Panel / tooltips / columns | `src/ui/workbench/WorkbenchPanel.tsx` |
| Handoff text | `src/ui/workbench/workbenchHandoff.ts` |
| Controller | `src/app/workbench/useWorkbenchController.ts` |
| Pipeline | `src/workbench/` |
| Authoring module | `src/workbench/authoring/` |
| Durable runs | `src/daemon/db/workbenchAuthoringRepository.ts` |
| HTTP | `src/daemon/workbenchAuthoringApi.ts` |
| Thin CLI adapter | `src/cli/workbenchAuthoring.ts`, `src/cli/authoringClient.ts` |

## MCP (artifact-primary)

Prefer for reuse:

- `search_artifacts` — published capsules by query/kind/project.
- `get_artifact` — body + provenance + evidence refs.

Session tools (`search_sessions`, `get_session`, transcript/excerpts) remain for compile evidence, not the primary memory API. See `docs/reference/mcp-tools.md`.

MCP has no authoring mutations. Worktree bridges allow authoring capabilities,
status, and evidence reads, but block open, submit, and finish.

## Anti-patterns for agents

- Do not reintroduce Logbook bulk enrich, row checkboxes, or summary metrics strip.
- Do not treat “published session” as a Logbook search hit.
- Do not document Logbook as a session library or dual session/artifact browser.
- Do not put Workbench process tracking into Logbook.
- Plans under `docs/superpowers/plans/` are history, not the live product contract.
