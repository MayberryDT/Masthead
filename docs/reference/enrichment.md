# Workbench Guided Artifact Authoring

Masthead authoring is agent-authored and daemon-owned. Workbench is the human collaboration surface;
the writable daemon owns durable requests, assignment planning, evidence coverage, validation,
editorial review, claims, identity checks, publication, and receipts. The installed CLI is a thin
HTTP adapter and never opens SQLite for normal authoring.

See [ADR 0015](../adr/0015-guided-authoring-campaigns.md) for the current decision. V1, V2, and V3
remain audit-only; legacy records and receipts may be read, but mutation attempts fail with
`authoring_contract_retired`.

## Human handoff

People select compile-ready sessions and choose **Copy Agent Prompt**. Workbench first creates one
durable guided authoring request, then copies only its opaque request ID and one instance-bound start
command. The handoff contains no session list, multi-step CLI recipe, file recipe, or privacy wizard.

Every authoring mutation verifies the daemon URL, database ID, build SHA, and instance manifest
identity. This keeps simultaneous development and production installations from sharing a launcher or
writing the wrong database.

## V4 vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Assignment = one daemon-grouped authoring unit containing at most 12 sessions.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = authored, dismissed, merged, or changed kind, with evidence-backed rationale.

Canary = the first staged assignment of at most 3 sessions, reviewed by an operator before publication.

Next action = the single command Masthead requires from the agent at the current assignment state.

## Request planning and canary

The current bundle version is `workbench-authoring-v4` and the policy is `guided-authoring-v1`. The
daemon groups a request into assignments of at most 12 sessions, using strong artifact-opportunity
joins first and dossier-only groups second. The agent receives one assignment and one required next
action; it never receives the full selection to partition.

The first assignment is a three-session canary capped at three sessions. Masthead chooses a complete
strong opportunity group of at most three sessions or diverse dossier-only sessions. It never splits
a larger strong group merely to manufacture a canary. If every selected session belongs to a larger
strong group, request creation returns `guided_canary_not_constructible` and persists nothing.

## Guided workflow

| State | Required behavior |
| --- | --- |
| **Start** | Resolve the request through its instance-bound launcher, verify instance identity, and claim the released assignment. |
| **Inspect** | Traverse every canonical redacted evidence page in ascending order. Masthead records only the exact returned refs at the current assignment revision and returns the next unread cursor. |
| **Save** | Submit grounded enrichment for every assignment session, zero or more optional artifacts, and required high-signal opportunity dispositions. Saving creates no Logbook rows. |
| **Review** | Resolve structured grounding, completion, enrichment-delta, protocol-leakage, reuse, and duplication findings. Masthead returns the single next revision action. |
| **Canary decision** | The first accepted assignment remains staged until an operator approves or rejects it from Workbench. |
| **Finish** | Atomically apply one accepted assignment, rebuild canonical dossiers, publish useful optional artifacts, update search and pipeline state, release claims, store the immutable receipt, and release the next assignment. |

Retrying a successful finish returns the same receipt and creates no duplicate output.

## Complete evidence traversal

Each assignment pins one revision across all member sessions. Inspect starts with the first session
that has unread evidence and pages in canonical ascending order. Supplementary query, kind-filtered,
or descending reads do not count toward completion. If any member evidence changes, the assignment
advances to the fresh revision and only access rows from that revision count.

The agent must answer, with support, what the user asked for, what work occurred, what changed, which
decisions were made, what verification proved, what failed or remains unresolved, and what another
person could reuse without reopening the transcript.

## Grounded enrichment and artifacts

One draft contains grounded durable enrichment for every assignment session and zero or more
`runbook`, `adr`, or `incident_timeline` artifacts. Agents never author a session dossier body; after
acceptance the daemon rebuilds `canonical-session-dossier-v1` from current canonical data.

Every substantive dossier and optional-artifact claim carries a typed canonical evidence reference
and a verbatim excerpt of at least 20 normalized characters. Grounding covers the title, summary,
purpose, outcome, key work, decisions, blockers, verification narrative, and continuation claims when
present. A completed outcome cannot claim unknown verification; missing verification must be stated.

Knowledge opportunities do not manufacture artifacts. Low-signal or unsupported kinds create no
artifact and no blanket not-applicable text. High-signal opportunities require an evidence-backed
authored, dismissed, merged, or changed-kind disposition. Authored and changed-kind dispositions link
to a matching draft; merged dispositions resolve through another persisted opportunity that produces
an artifact. Generic copied dismissals fail review even when they cite a real evidence ref.

## Editorial and reuse quality

V4 rejects protocol narration copied from the handoff, unsupported completion, negligible enrichment
that restates the deterministic baseline, weak joins, unsupported dispositions, secret-looking output,
and materially duplicated templates across the request. Supported sessions whose actual subject is
CLI or prompt design are valid; protocol language is rejected only when evidence does not establish it
as the session's work.

Optional artifacts must be independently reusable. A runbook includes trigger, preconditions,
performed steps, expected results, verification, and failure or rollback handling. An ADR includes the
durable decision, context, alternatives actually considered, consequences, and reversal conditions.
An incident timeline includes symptoms or impact, ordered events, root cause, contributing factors,
remediation, and recovery verification.

## Atomic publication and retrieval

Finish runs inside one immediate SQLite transaction. Any failed invariant rolls back enrichment,
artifacts, search indexing, pipeline state, claims, revisions, Activity, and the receipt together. The
staged canary cannot finish before operator approval.

Published artifacts are searchable through Logbook and read-only MCP `search_artifacts` and
`get_artifact`. Session and transcript tools remain available for evidence inspection. MCP has no
authoring operations.

## Legacy audit boundary

Historical V1, V2, and V3 status, evidence, findings, bundles, completion reports, and recovery
receipts remain readable for audit. Legacy authoring protocol identifiers such as
`masthead.workbench.authoring/v1`, `workbench-authoring-v1`, `workbench-authoring-v2`, and
`workbench-authoring-v3` describe those immutable records only. They cannot be reopened, submitted,
finished, or converted into V4 work.
