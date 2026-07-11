# Session Evidence and Dossier Artifacts

Masthead has two related but distinct session-dossier views:

1. **Canonical session evidence detail** supports Now, Workbench, compile, and deep inspection.
2. **Published `session_dossier` artifact body** is the session-scoped knowledge object opened from
   a Logbook artifact capsule.

They may share underlying evidence, but they are not the same product row. Sessions never appear as
Logbook rows.

## Canonical session evidence detail

```http
GET /sessions/:sessionId/dossier
```

`sessionId` is the canonical Masthead session ID, not the runtime/source session ID. Now cards carry
`canonicalSessionId` so a live card can request canonical evidence when it exists.

The response may contain:

- `identity`: canonical/source IDs, project, runtime, model, lifecycle, worktree, timing, confidence,
- `coverage`: transcript/evidence coverage and missing-data warnings,
- `narrative`: objective, prompts, outcome, topics, technologies, and narrative provenance,
- `files`, `tools`, `verification`, and `attention`,
- `timeline`: messages, tools, file effects, checkpoints, runtime signals, and attention events,
- `reuse`: bounded context and source identity,
- `usage`: canonical token counts,
- current local artifact/enrichment provenance when available.

This route is evidence-facing. It may include unpublished session material and does not make the
session searchable in Logbook.

## Transcript evidence

```http
GET /sessions/:sessionId/transcript
```

Transcript rows are role/type filterable and paginated. Hook-only sessions show a coverage warning
instead of presenting repeated runtime metadata as conversation text.

Coverage states are:

- `complete`: usable transcript, tool activity, and file effects are present,
- `partial`: some useful evidence is present but coverage is missing,
- `hook_only`: live/runtime evidence exists without conversation transcript,
- `metadata_only`: only sparse identity metadata is available.

If transcript evidence is missing, use Workbench to check availability and request import for the
exact session/source. Detail views do not import transcripts automatically.

## Published session-dossier artifact

```http
GET /logbook/artifacts/:artifactId
```

A published artifact whose kind is `session_dossier` has provenance of exactly one canonical
session. Its capsule is the Logbook search hit; its body records objective, context, approach,
decisions, files, tools, outcome, verification, risks, lessons, confidence, missing evidence, and
evidence refs.

The published artifact has its own opaque artifact ID, publication state, current/superseded
lineage, and provenance record. Opening it does not call the session dossier route as the primary
Logbook detail path.

## UI rules

- Now may show a shallow live fallback when canonical evidence is unavailable.
- Workbench may inspect canonical session evidence before any artifact exists.
- Logbook opens artifact bodies and always shows provenance.
- Unsupported source-opening actions remain hidden.
- Neither detail path opens source apps, mutates Git, runs commands, approves requests, or steers
  agents.
