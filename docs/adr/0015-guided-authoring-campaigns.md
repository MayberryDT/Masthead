# ADR 0015: Guided Authoring Campaigns

## Status

Accepted.

Implementation status: implemented. The runtime advertises `workbench-authoring-v4`; the guided
service, API, instance-bound CLI, Workbench canary review, and legacy mutation retirement are present.
Production release acceptance remains separately gated by the final dogfood, signed human review,
and production canary evidence in `docs/acceptance/product-release-gate.md`.

## Context

The selection-scoped V3 contract proved that Masthead could preserve the canonical dossier renderer,
accept agent-authored enrichment, validate grounded optional artifacts, and publish atomically. It did
not make the agent inspect all evidence or exercise editorial judgment before finish. A failed bulk
handoff consequently admitted 3,230 deterministic dossier templates as if they were enriched knowledge.

Masthead needs a durable, daemon-guided campaign rather than a prompt that transfers partitioning and
workflow control to the agent. The daemon must make the next required action explicit, retain evidence
coverage and review state across restarts, and give the operator a bounded canary before publication.

## Decision

1. A Workbench selection creates one durable guided authoring request; the copied handoff contains only its request ID and instance-bound start command.
2. The daemon groups the request into assignments of at most 12 sessions using strong artifact-opportunity joins first and dossier-only groups second.
3. The first assignment is a canary of at most 3 sessions. Its accepted draft remains staged until an operator approves it from Workbench.
4. The CLI returns one required next action at every state and records complete canonical evidence traversal before a draft may become publishable.
5. Every substantive dossier and optional-artifact claim carries typed verbatim claim support. High-signal opportunities require an evidence-backed authored, dismissed, merged, or changed-kind disposition.
6. V4 rejects protocol narration, unsupported completion, negligible enrichment, and materially duplicated templates across the request.
7. Finish publishes one accepted assignment atomically and releases the next assignment. V1, V2, and V3 remain audit-only.
8. Authoring launchers are instance-bound and every mutation verifies daemon URL, database ID, build SHA, and manifest identity.

The current bundle contract is `workbench-authoring-v4`. Legacy V1, V2, and V3 records and receipts
remain readable as immutable audit history. Their mutation routes fail with
`authoring_contract_retired` before claims, drafts, enrichment, or artifacts are written.

The three-session canary is a maximum, not a target manufactured by splitting evidence. Masthead uses
a complete strong opportunity group of at most three sessions or diverse dossier-only sessions. If
every selected session belongs to a larger strong group, request creation fails closed with
`guided_canary_not_constructible` and persists nothing.

## Vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Assignment = one daemon-grouped authoring unit containing at most 12 sessions.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = authored, dismissed, merged, or changed kind, with evidence-backed rationale.

Canary = the first staged assignment of at most 3 sessions, reviewed by an operator before publication.

Next action = the single command Masthead requires from the agent at the current assignment state.

## Consequences

- Workbench stores the selected campaign before copying a handoff; the user does not carry a session
  list or multi-step authoring recipe between Masthead and the agent.
- The agent must traverse every canonical evidence page, ground substantive claims, and respond to
  editorial findings before an assignment can publish.
- High-signal opportunities require an evidence-backed disposition, while unsupported optional kinds
  still produce no artifact and no blanket not-applicable prose.
- The first accepted assignment stays out of Logbook until operator approval, so a template or
  grounding failure cannot fan out across the request.
- Finish remains daemon-owned, atomic, and idempotent for one accepted assignment at a time. MCP
  remains artifact-primary and read-only.

This ADR supersedes ADR 0014 as the current authoring contract. It preserves ADR 0013 and ADR 0014's
canonical rendering, complete-evidence, typed claim-support, strong-join, duplicate-prevention, and
atomic-publication safeguards.
