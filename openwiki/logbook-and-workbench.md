# Logbook and Workbench (artifact-first)

**Decisions:** [ADR 0011](../docs/adr/0011-artifact-first-logbook.md) (Logbook unit), [ADR 0012](../docs/adr/0012-daemon-owned-artifact-authoring.md) (daemon seam), [ADR 0013](../docs/adr/0013-canonical-dossier-and-candidate-authoring.md) (preserved rendering/evidence findings), [ADR 0014](../docs/adr/0014-agent-led-enriched-artifact-authoring.md) (superseded V3 audit history), [ADR 0015](../docs/adr/0015-guided-authoring-campaigns.md) (superseded V4 audit contract), [ADR 0016](../docs/adr/0016-agent-led-v5-pack-authoring.md) (current V5 contract), [ADR 0009](../docs/adr/0009-logbook-only-shows-published-sessions.md) (Workbench pipeline ownership).

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
follow the Workbench quality path described below.

## Workbench quality exits (three-way)

After complete import evidence exists, capture quality precheck returns one of three dispositions.
They are not the same bucket:

| Disposition | Operator name | Where the session sits | Authoring? |
|-------------|---------------|------------------------|------------|
| **keep** | Ready (compile-ready) | Package path, quality passed | Eligible for **Copy Agent Prompt** |
| **review** | Quality review / review hold | Package path, still needs a quality decision | **Not** included in handoff |
| **suppress** | Not Added to Logbook | Not Added bucket (reason visible) | Never in default agent selection |

**Ready** means the session passed the quality floor and can enter a V5 request. **Review hold**
means the precheck could not confidently keep or suppress (for example insufficient evidence or an
ambiguous short transcript). Those rows stay on the package path until an operator disposes them;
they do **not** move to Not Added by default. **Not Added** is only for confirmed non-publication
noise (empty, hook-only, diagnostic-only, exact-duplicate) or an explicit operator fail/exclusion.

### Why Not Added can be 0 while half the queue will not author

Not Added and quality review are independent. A large import corpus can show **Not Added = 0** while
hundreds of sessions sit in **quality review** on the package path. Select-all and package-path
counts include those review rows; **Copy Agent Prompt** still uses **compile-ready only** and
discloses how many review-needed sessions were left out. That is intentional: Masthead does not
silently force review sessions into authoring without a quality decision.

### Operator disposition (intended)

Operators drain review hold without one-by-one Pipeline clicks:

- **Accept** (bulk or selected review) → quality passed → compile-ready for the next handoff.
- **Fail** (bulk or selected review) → Not Added with an explicit operator reason (for example
  `operator_rejected` or `insufficient_evidence_confirmed`).

Passed, already-published, and true Not Added rows are unaffected. Review hold does not auto-age
into Not Added unless a separate aging policy is enabled later; until then the queue only shrinks
through accept, fail, or evidence revision that re-runs precheck. Automatic suppressions remain
reversible when evidence revision changes; manual exclusion stays sticky.

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

New work uses the V5 runtime. V1–V4 records remain readable for audit, but their mutation routes are
retired and cannot run or resume an enrichment campaign. See the
[V5 migration note](../docs/reference/workbench-authoring-v5-migration.md).

One durable `workbench-authoring-v5` request produces enriched dossiers and any useful optional artifacts:

1. **Enriched dossier** — the agent writes current durable enrichment for every selected session;
   the daemon then renders the original canonical dossier structure.
2. **Runbook**, **ADR**, **incident timeline** — the agent may create zero or more optional artifacts
   from assignment evidence. Knowledge opportunities are nonbinding and require no disposition.

### Daemon-owned guided authoring

Workbench creates a durable request before copying a handoff. The handoff contains only the opaque
request ID and one instance-bound start command, with no multi-step recipe or session list. One
daemon-owned authoring module then enforces the same quality behavior:

1. persist the compile-ready selection and campaign policy through **Copy Agent Prompt** while
   disclosing any review-needed sessions left out;
2. create fixed packs of 5–12 sessions, except the final remainder;
3. return one required next action and record traversal of every canonical evidence page;
4. review grounded enrichment and any optional-artifact claims progressively; and
5. atomically publish accepted pack sessions before releasing the next pack.

Each pack finish stores an immutable **pack** receipt and may release the next pack. The
**request** is complete only when the daemon returns `nextAction.kind === "complete"` and the
immutable **request** receipt exists. A finish retry returns the same pack receipt without
duplicate publication. V1–V4 remain audit-only; their mutation routes return
`authoring_contract_retired`.

### Agent stop rule (full-request obligation)

Finishing one pack is not finishing the request.

- **Stop only** when `nextAction.kind` is `"complete"` **and** a request-level receipt exists.
- After a non-final pack finish, `nextAction.kind` is typically `"claim_next"` (or an equivalent
  continue action). The agent must immediately run `nextAction.command`. Do not report the job done.
- Soft language such as “remaining packs” or a pack-scoped loop is not a completion signal.
- Masthead never writes enrichment prose; the agent still owns every pack until the request receipt.

Handoff clipboard and bootstrap responses restate this stop rule so a thin start payload cannot be
mistaken for a one-pack milestone.

### Resume incomplete requests

If the agent process stops mid-request (crash, context limit, or early stop):

1. Keep the **same request id** (do not create a second request for the remaining packs).
2. Run the instance-bound **bootstrap** (or start) command for that request.
3. Follow the returned `nextAction` only. Completed packs stay published; the daemon does not
   re-open them or shrink the original selection.
4. Continue until the request receipt exists.

Resume is recovery, not optional follow-up. Packs already finished remain part of the audit trail.

### Locked UI vocabulary

- Columns include enrichment, dossier publication, and optional-artifact state.
- Copy Agent Prompt persists the selection and copies one instance-bound start command, no session list or multi-step recipe.
- The agent enriches assignment sessions and exercises optional-artifact judgment; opportunities are nonbinding.
- Workbench Activity observes normal publication; it does not approve V5 packs.
- Apply ≠ publish.

### Guided authoring vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Pack = one fixed V5 authoring unit containing 5–12 sessions, except the final remainder.

Assignment = historical V4 campaign unit retained for audit.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = historical V4 resolution state; V5 opportunities are nonbinding.

Canary = historical V4 approval state; V5 has no canary.

Next action = the single command Masthead requires from the agent at the current pack state.

### Code map

| Concern | Where |
|---------|--------|
| Panel / tooltips / columns | `src/ui/workbench/WorkbenchPanel.tsx` |
| Handoff text | `src/ui/workbench/workbenchHandoff.ts` |
| Controller | `src/app/workbench/useWorkbenchController.ts` |
| Pipeline | `src/workbench/` |
| Authoring module | `src/workbench/authoring/` |
| Durable V5 requests and packs | `src/daemon/db/workbenchAuthoringV5Repository.ts` |
| HTTP | `src/daemon/workbenchAuthoringApi.ts` |
| Thin CLI adapter | `src/cli/workbenchAuthoring.ts`, `src/cli/authoringClient.ts` |

## MCP (artifact-primary)

Prefer for reuse:

- `search_knowledge` / `get_knowledge` — published capsules (primary); `search_artifacts` / `get_artifact` remain v1 aliases.
- Handlers: `src/agentAccess/` (artifact-first agent API); MCP transport: `src/mcp/`.
- `get_artifact` — body + provenance + evidence refs.

Session tools (`search_sessions`, `get_session`, transcript/excerpts) remain for compile evidence, not the primary memory API. See `docs/reference/mcp-tools.md`.

MCP has no authoring mutations. Guided-request status and assignment review remain read-only. V1–V4
status, reviews, and receipts remain audit history; their mutations return
`authoring_contract_retired`.

## Anti-patterns for agents

- Do not reintroduce Logbook bulk enrich, row checkboxes, or summary metrics strip.
- Do not treat “published session” as a Logbook search hit.
- Do not document Logbook as a session library or dual session/artifact browser.
- Do not put Workbench process tracking into Logbook.
- Do not equate Not Added count with “how many sessions need quality attention”; review hold is separate.
- Do not treat pack finish, pack receipt, or “remaining packs acknowledged” as request completion.
- Do not open a new V5 request to finish packs that already belong to an incomplete request; resume via bootstrap.
- Plans under `docs/superpowers/plans/` are history, not the live product contract.
