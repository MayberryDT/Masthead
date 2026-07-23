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
start command. Every mutation verifies daemon URL, database ID, build SHA, manifest path, and live
instance identity so development and production cannot share a launcher or database accidentally.

## Packs and complete-selection obligation

The daemon divides the full selection into fixed packs of 5–12 sessions, except the final remainder.
One agent follows the returned next action until the immutable request receipt exists. Resume uses
the same request ID only after a crash; it does not reduce the selected work or turn completed packs
into optional follow-up.

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

## Quality behavior

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
