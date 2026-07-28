# Workbench V5 guided artifact authoring

The implemented live contract is `workbench-authoring-v5`. Masthead owns durable request identity,
fixed packs, canonical evidence catalogs, validation, publication, Activity, and receipts. The coding
agent owns every enrichment field and every optional-artifact decision; Masthead never writes
enrichment prose.

See [ADR 0016](../adr/0016-agent-led-v5-pack-authoring.md) and the
[V5 migration note](workbench-authoring-v5-migration.md). V1–V4 records remain readable for audit,
while their mutations fail with `authoring_contract_retired` before writing.

## Handoff and identity

**Copy Agent Prompt** creates one durable request from the compile-ready selection and discloses any
review-needed rows left out. The clipboard contains only the opaque request ID and one instance-bound
start command (plus stop-rule restatement). Every mutation verifies daemon URL, database ID, build
SHA, manifest path, and live instance identity so development and production cannot share a launcher
or database accidentally.

Review-hold sessions never enter the handoff selection. Operators must accept them to ready or fail
them to Not Added before they can join a later request. Package-path size alone is not the authorable
count; see [Logbook and Workbench](../../openwiki/logbook-and-workbench.md#workbench-quality-exits-three-way).

## Packs and complete-selection obligation

The daemon divides the full selection into fixed packs of 5–12 sessions, except the final remainder.
One agent follows the returned next action until the immutable **request** receipt exists.

**Stop rule:** pack finish is not request completion. After a non-final finish the daemon returns a
continue action (typically `claim_next`); the agent must run `nextAction.command` immediately and
must not report success. Stop only when `nextAction.kind === "complete"` and the request receipt
exists. A pack receipt proves that pack only.

**Resume:** use the same request ID with `author bootstrap --request <id>` (then the returned next
action / start). Completed packs stay published; the selection is not reduced and finished packs are
not optional follow-up.

## CLI loop

1. `author bootstrap --request <id>` returns the thick contract, pack policy, quality rules, stable
   identity, request state, and next action.
2. `author start --request <id>` claims the next available pack.
3. `author inspect --pack <id>` traverses canonical evidence using the returned cursors.
4. `author scaffold --pack <id> --file <path>` writes identity, evidence catalogs, and blank skill
   fields only.
5. The agent fills title, description, at least three keywords, purpose, outcome, key work, honest
   verification, and optional-artifact considerations.
6. `author save --pack <id> --file <path>` returns a per-session `publishable`, `soft_flag`, or
   `hard_reject` result.
7. `author finish --pack <id>` publishes passers atomically, records warnings and rejects, stores the
   pack receipt, and releases the next pack.
8. Repeat until `author receipt --request <id>` returns the immutable completed-request receipt.

There is no review command, canary decision, operator approval, required opportunity disposition,
or request-wide `needs_revision` state in V5.

## Evidence and scaffold boundary

The scaffold contains canonical identity plus an evidence catalog and empty authored fields. It does
not contain a deterministic title, summary, purpose, outcome, keyword suggestion, or prose hint. The
agent must inspect the evidence, then cite canonical evidence for the core fields: title,
description, purpose, outcome, key work, and verification.

Agents never author a session dossier body. Accepted durable enrichment is applied to the canonical
session graph, then the daemon rebuilds the immutable `canonical-session-dossier-v1` presentation.

## Capture quality vs authoring quality

Two different quality layers:

1. **Workbench capture / publication quality** (before handoff) — three exits: **ready** (`keep`),
   **review hold** (`review` on package path), **Not Added** (`suppress`). Only ready rows enter
   **Copy Agent Prompt**. Review hold with Not Added = 0 is normal: review is not Not Added, and it
   is not agent-ready either. Operator bulk accept/fail is the intended drain for large review
   backlogs.
2. **V5 save quality** (inside a pack) — hard rejects skip that session and let the pack continue;
   soft flags publish with Activity warnings. Neither outcome creates a request-wide revision loop.

## Quality behavior (save-time)

Hard rejects skip that session and let the pack continue: empty or generic titles, protocol or
compaction boilerplate, empty or insufficient keywords, a purpose that is clearly not the user ask,
or missing/unknown core grounding. Soft flags publish with Activity warnings for weak verification or
thin key work. Missing decisions are valid when the session contained no durable decision.

One pack may publish a mix of passing, soft-flagged, and rejected sessions. Save never sends the
whole request into a revision loop.

## Optional artifacts

For each pack the agent records grounded yes/no consideration for useful `runbook`, `adr`, or
`incident_timeline` work. A yes may include a claim-supported artifact draft; a no records a concise
reason. Knowledge opportunities are nonbinding, no kind is mandatory, and a no never blocks a
dossier. Masthead does not create empty or not-applicable artifacts.

## Publication, search, and audit

Finish runs inside one immediate SQLite transaction. A failed invariant rolls back enrichment,
artifacts, search indexing, pipeline state, Activity, and the receipt together. A successful retry
returns the same receipt without duplicate output.

Logbook and read-only MCP rank agent-authored title, description, and keywords ahead of the complete
artifact body. Session and transcript tools remain available for evidence. MCP exposes no authoring
mutation.

Historical V1–V4 status, evidence, findings, reviews, and receipts remain readable with their original
contract labels. They cannot be started, saved, approved, finished, relabeled, or resumed as V5.
