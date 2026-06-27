# Session Dossier

The session dossier is the shared detail surface for Board and Logbook sessions. It is backed by the canonical SQLite session graph and is exposed through:

```http
GET /sessions/:sessionId/dossier
```

`sessionId` is the canonical Masthead session id, not the runtime/source session id. Board cards carry `canonicalSessionId` so live cards can open the same dossier as Logbook rows.

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

If the transcript is missing, use Sources to enable transcript import and sync supported harness history. The detail view only routes to Sources; it does not automatically import transcripts or open source applications.

## UI Rules

Board and Logbook use the same `SessionDossier` component inside their existing modal shells. Unsupported source-opening actions are intentionally hidden. The dossier can copy context or ids, but it does not open source apps, mutate Git, run commands, approve requests, or steer agents.

If canonical dossier data is unavailable, Board can render a live-only fallback from the selected card. Logbook should treat missing dossier data as a fetch error because Logbook rows already use canonical ids.
