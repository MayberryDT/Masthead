# ADR 0013: Canonical Dossier Snapshots and Candidate-Driven Authoring

## Status

Accepted.

## Context

The first artifact-focused production run created 1,283 session dossiers and no runbooks, ADRs, or
incident timelines. The generated dossiers replaced Masthead's established dossier with generic
agent-authored prose, frequently described the authoring protocol instead of the source session,
and produced blanket not-applicable resolutions for every optional kind. The run was schema-valid
but did not create durable knowledge that a person or agent could reuse.

Masthead already has a useful session dossier: `getSessionDossier()` assembles the original
human-facing identity, coverage, narrative, files, tools, verification, attention, excerpts,
timeline, reuse, and usage sections from canonical session data. Asking an authoring agent to
recreate that body introduced a second, weaker meaning of session dossier.

Optional artifacts have a different shape. A runbook, ADR, or incident timeline is valuable only
when positive evidence shows that the session history contains a reusable procedure, material
decision, or failure narrative. Treating all three kinds as obligations for every session spends
authoring effort on absence and encourages templated output.

## Decision

`getSessionDossier()` remains the semantic and visual source of truth for a session dossier.
Publication stores an immutable, versioned snapshot of that canonical dossier and excludes only
the recursive artifact listing. The daemon builds the snapshot. Agents never author, summarize,
enrich, or replace a session dossier body. The existing dedicated session-enrichment path remains
separate and may continue to improve the canonical source data before a snapshot is published.

Optional artifact authoring uses `masthead.workbench.authoring/v2`:

1. The daemon discovers positive-evidence candidates for `runbook`, `adr`, and
   `incident_timeline` from canonical session evidence.
2. Candidates may be grouped only by a strong, evidence-backed join key. One V2 authoring run owns
   exactly one candidate group and no more than 12 provenance sessions.
3. The bundle contains only the candidate's optional artifact output. It cannot contain a dossier
   body or per-session not-applicable obligations.
4. Every substantive claim carries claim support: a verbatim excerpt plus its canonical evidence
   reference and session id. The daemon verifies that support before publication.
5. Submission rejects authoring-protocol leakage, unsupported claims, weak provenance joins, and
   materially duplicated template content. Finish applies and publishes the accepted artifact and
   completes its candidate group atomically and idempotently.
6. V1 artifacts from the failed generation are invalidated. V1 runs and their exact bundle hashes
   remain audit history, but V2 never reuses them and their sessions become eligible for canonical
   dossier publication and candidate discovery.

The daemon remains the writable authoring boundary, `mastheadctl` remains a thin HTTP adapter, and
MCP remains artifact-primary and read-only. This ADR supersedes ADR 0012 only where ADR 0012 requires
an agent-authored session package or one published/N/A/contributed resolution for every optional
kind in every run.

## Consequences

- There is one user-facing meaning of session dossier and one rendering contract for it.
- Dossier publication is deterministic, local, inexpensive, and independent of agent quality.
- Absence of optional-artifact evidence creates no artifact and requires no generated N/A prose.
- Authoring work is bounded by a concrete reusable knowledge candidate instead of an arbitrary
  session batch.
- Evidence support is inspectable and machine-verifiable without treating protocol compliance as
  artifact content.
- Failed V1 output can be removed from Logbook without erasing the audit trail that explains it.
- Mass publication cannot resume until fixture, retrieval, reuse, recovery, and production-canary
  gates pass.
