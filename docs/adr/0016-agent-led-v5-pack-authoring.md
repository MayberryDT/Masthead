# ADR 0016: Agent-led V5 pack authoring

## Status

Accepted and implemented.

This decision supersedes ADR 0015 for all new authoring work. V1–V4 records remain readable audit
history, but their mutation routes are retired.

## Context

V4 made the daemon own a durable campaign, but its canary approval, mandatory opportunity
dispositions, and campaign-wide revision loops turned authoring into an operator-supervised process.
They also encouraged protocol-shaped prose instead of useful session memory. Masthead must preserve
durable infrastructure and evidence checks while leaving all enrichment meaning to the coding agent.

## Decision

1. New requests use `workbench-authoring-v5`; V1–V4 mutations return
   `authoring_contract_retired` before writing, while status, review, receipt, and evidence reads
   remain available for audit.
2. **Copy Agent Prompt** persists the complete compile-ready selection, discloses excluded
   review-needed rows, and copies only the opaque request ID plus one instance-bound start command.
3. The daemon divides the complete selection into fixed packs of 5–12 sessions, except the final
   remainder. The agent must finish every pack; resume exists only to recover a crash.
4. Masthead returns an evidence catalog and blank skill fields. The agent writes title,
   description, keywords, purpose, outcome, key work, honest verification, and optional-artifact
   judgment. Masthead never writes enrichment prose. The local scaffold retains the catalog, while
   save uses the bounded authored projection defined by ADR 0017 and rehydrates canonical evidence
   server-side.
5. Save classifies each session independently. Hard rejects are skipped and recorded; soft flags may
   publish with a warning; neither outcome creates a request-wide `needs_revision` state.
6. Knowledge opportunities are nonbinding. Each pack records grounded yes/no consideration, and an
   optional runbook, ADR, or incident timeline is published only when the agent judges it useful.
7. Finish atomically publishes passing and soft-flagged sessions, records rejects, stores an
   immutable receipt, and releases the next pack. No canary or operator approval mutation exists.
8. Search and MCP rank agent-authored title, description, and keywords ahead of the complete
   immutable artifact body.

## Consequences

- Workbench Activity observes progress and reasons; it is not an approval console.
- The product does not expose supervisors, workers, or nested authors. One agent follows the
  daemon-owned next action until the complete request receipt exists.
- Release proof proceeds through 10-session, 50-session, and full-selection gates. These validate
  quality and autonomy without reintroducing a canary or operator checkpoint.
- Historical V4 assignments, canary reviews, dispositions, and receipts retain their original
  meaning and are never relabeled or resumed as V5.
