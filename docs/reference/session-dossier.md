# Session Dossier

The original session dossier is Masthead's only dossier contract. It is backed by
the canonical SQLite session graph and represented by `SessionDossierDto`. The live
canonical read is exposed through:

```http
GET /sessions/:sessionId/dossier
```

`sessionId` is the canonical Masthead session id, not the runtime/source session
id. Board cards carry `canonicalSessionId` so live cards can open this dossier.
Logbook does not treat the session as a row: it opens a published artifact whose
body is an immutable snapshot of the same canonical dossier.

## Contents

The dossier response contains:

- `identity`: canonical id, source id, project, runtime, model, lifecycle, worktree, timing, and source confidence.
- `coverage`: complete, partial, hook-only, or metadata-only coverage state with transcript counts and missing-data warnings.
- `narrative`: objective, prompts, outcome, topics, technologies, unresolved claims, and narrative provenance when enrichment exists.
- `files`: canonical file effects with display paths and change counts when available.
- `tools`: captured tool calls/results with status and output previews.
- `verification`: derived status and verification commands.
- `attention`: command failures, runtime warnings/errors, and missing-verification signals.
- `timeline`: messages, tools, file effects, checkpoints, runtime signals, and attention events.
- `reuse`: copyable context packet, MCP inclusion, source runtime/id, and canonical id.
- `usage`: input, output, and total token counts from canonical usage rows.

## Published canonical snapshot

The daemon publishes `session_dossier` artifacts with schema and snapshot version
`canonical-session-dossier-v1`. The body is a deep, immutable snapshot of the
original dossier. It preserves identity, coverage, narrative, files, tools,
verification, attention, excerpts, timeline, durable enrichment and state, reuse,
and usage. Only the live DTO's recursive `artifacts` listing is excluded.

Publication is daemon-owned and occurs only through accepted `workbench-authoring-v4` assignment
finish. The agent must traverse complete canonical evidence and provide typed, verbatim claim support
for every substantive enrichment claim. Finish applies that enrichment, rebuilds the canonical
snapshot from current canonical data, publishes and indexes it atomically, and records exactly one
provenance session. Agents never author or replace dossier presentation; optional-artifact drafts
cannot contain a dossier. A dossier in the three-session canary remains staged until operator approval.

Historical V1, V2, and V3 dossier publication records remain audit-only. Legacy mutation attempts
return `authoring_contract_retired`; they cannot republish a dossier.

Logbook recognizes the exact `canonical-session-dossier-v1` schema and renders it
through `SessionDossierContent`, the body component used by the original dossier
experience. A malformed canonical body and an unknown future schema are explicit
errors, not silently relabeled legacy dossiers.

## Transcript-first behavior

The detail surface shows canonical transcript messages when available. The transcript section reads from:

```http
GET /sessions/:sessionId/transcript
```

Transcript items are role/type filterable and paginated. Hook-only sessions show a coverage warning instead of presenting repeated hook metadata as conversation text.

## Coverage states

- `complete`: usable transcript, tool activity, and file effects are present.
- `partial`: at least one useful evidence class is present, but some coverage is missing.
- `hook_only`: live hook or runtime metadata exists, but the conversation transcript is missing.
- `metadata_only`: only sparse session identity metadata is available.

## Transcript import

If the transcript is missing, use Workbench to check transcript availability and request transcript import for the specific session/source. The detail view does not automatically import transcripts or open source applications.

## Enrichment Provenance

Advanced dossier provenance shows enrichment provider, model, prompt version, provider status, confidence, missing evidence, source references, and latest failed enrichment attempt when available. If remote enrichment fails, the dossier should state the failure instead of presenting local deterministic copy as a successful model result.

## UI Rules

Board uses the `SessionDossier` modal shell; Board and Logbook share
`SessionDossierContent` for the original human-facing sections. Unsupported
source-opening actions are intentionally hidden. The dossier can copy context or
ids, but it does not open source apps, mutate Git, run commands, approve requests,
or steer agents.

If canonical dossier data is unavailable, Board can render a live-only fallback
from the selected card. Logbook artifact detail is self-contained and does not
fetch a live dossier to reconstruct its body.
