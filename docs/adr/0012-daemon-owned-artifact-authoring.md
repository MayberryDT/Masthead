# ADR 0012: Daemon-Owned Artifact Authoring

## Status

Accepted for daemon ownership and atomic publication. The V1 session-bundle,
agent-written dossier, complete-manifest, and per-kind N/A resolution portions are
superseded by [ADR 0013](0013-canonical-dossier-and-candidate-authoring.md).

## Context

Masthead’s highest-value output is excellent, evidence-backed artifacts. The earlier Workbench CLI
implemented both transport and domain behavior: it opened SQLite directly, assembled bounded
evidence packets, validated individual files, and applied outputs one operation at a time. That made
the result depend on the agent’s command sequencing, exposed database-path choices outside the
daemon, truncated long sessions, and could leave partially applied bundles.

A copied Workbench handoff and directed work should use the same quality policy. The difference is
only who supplies the instruction: a copied handoff asks the agent to complete automatically, while
directed work lets the user steer the same underlying authoring loop.

## Decision

The writable Masthead daemon owns the artifact-authoring seam. `mastheadctl` is a thin HTTP adapter
for agents, not a second domain implementation and not a SQLite client.

The historical contract was `masthead.workbench.authoring/v1`:

1. `capabilities` discovers the installed command, database identity, contract version, evidence
   policy, and operations.
2. `open` verifies that database identity before creating or reusing one durable authoring run and
   one live claim per selected session.
3. `evidence` exposes all canonical redacted evidence through a manifest and complete cursor
   pagination. Authoring requires no additional privacy or transcript permission prompt.
4. `submit` validates and stores the complete artifact bundle plus structured findings. It creates
   no enrichment or artifact rows.
5. `finish` applies enrichment, creates every artifact, publishes every created artifact, resolves
   optional kinds, verifies Logbook visibility, releases claims, and stores an automatic completion
   report in one SQLite transaction. Retry returns the same receipt without duplicates.

One artifact bundle contains exactly one session package per selected session plus an explicit
resolution for each automatic kind: published artifact, N/A, or contribution to an existing
published artifact. `applied` is an intermediate state and never counts as automatic resolution.

> **Superseded by ADR 0013:** V2 does not accept session packages or dossier prose,
> does not assign every optional kind to every session, and does not require an N/A
> resolution. The daemon publishes canonical dossiers independently; one V2 run
> owns one positive-evidence optional-artifact candidate.

In V1, the daemon used the same grounded schema and evidence rules for copied handoffs and directed
work. The copied handoff told the agent to finish unattended, revise deterministic findings, publish
valid outputs, and resolve every automatic kind. It contained a plain-language request rather than
a shell recipe. ADR 0013 replaces that resolution model with one candidate per V2 run.

MCP remains artifact-primary and read-only. It can search full published artifact bodies and fetch
artifact detail, but cannot open, submit, finish, improve, rewrite, remove, or otherwise mutate
authoring state.

Logbook correction tools for improve, rewrite, supersede, or remove are future scope. Their absence
does not justify weakening the automatic authoring path.

## Consequences

- Normal authoring clients never select or open a SQLite database; the daemon’s database identity is
  the authority.
- Installed development and packaged launchers can point agents at the active daemon without
  embedding implementation recipes in Workbench UI.
- Candidate evidence remains cursor-paginated, but V2 authoring is scoped to one
  candidate rather than an obligation to exhaust every item for an arbitrary session set.
- Validation is bundle-wide and grounded. Findings are durable and revision is safe because submit
  has no output side effects.
- The retained decision is atomic, idempotent daemon publication. Under V2, finish publishes the
  candidate's optional artifact plus daemon-built canonical dossiers for its provenance, Logbook
  search indexing, pipeline updates, claims, Activity, and the completion receipt in one transaction.
- Read-only worktree bridges allow authoring discovery, status, and evidence reads while blocking
  open, submit, and finish mutations.
