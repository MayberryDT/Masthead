# Session Copy Contract

Masthead generates four strings per session:

| Field | Purpose |
| --- | --- |
| `title` | stable session title for Logbook and card identity |
| `liveSummary` | one-sentence current state for Board |
| `outcome` | one-sentence result after a session ends |
| `searchSummary` | dense retrieval text for search and MCP |

## Required qualities

Good session copy is:

- evidence-backed,
- specific to the project/work area,
- free of raw commands and paths,
- not generic,
- not first-person,
- not direct-address,
- short enough to scan.

## Forbidden examples

- `Updated.`
- `Updated files.`
- `Session is complete.`
- `Masthead session had recent activity.`
- `Changed files were updated in this session.`
- raw JSON, shell commands, URLs, secrets, paths, and commit hashes.

## Evidence rule

A string may mention only facts present in normalized rows, source metadata, file effects, command/tool records, checkpoints, latest feedback summaries, or LLM output that is linked to those inputs.

## Board live copy

Board live copy schedules a fresh rewrite for running cards on each configured Board refresh when remote live copy is enabled and configured. The daemon returns the projection immediately with deterministic copy, then applies completed live-copy results on a later projection. The default Board cadence is 10 seconds, and the live copy cache is disabled by default. Idle and ended cards keep local baseline copy without refresh failure metadata. Provider failures are recorded in the enrichment audit stream and do not block the projection response.

Each projection can include `copyRefreshSummary`, and each card can include `copyRefresh` when a completed refresh result is applied.

## Dossier reuse

The session dossier may reuse `title`, `liveSummary`, and `outcome` from the current session enrichment, but its copyable context packet must stay canonical and evidence-backed. It should combine the enriched narrative with canonical identity, source session ID, file effects, tools, verification status, token usage, MCP inclusion, and provenance rather than exposing raw transcript JSON or full command output.
