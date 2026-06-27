# ADR 0006: Canonical Session Dossier

## Status

Accepted.

## Context

Board showed live cards and Logbook showed canonical session detail, but the two surfaces did not share one durable detail model. Board cards can originate from live runtime/source ids, while Logbook rows are already canonical. Reusing source ids directly would make details depend on the current adapter and would weaken Masthead's canonical session database boundary.

## Decision

Masthead exposes a canonical session dossier from the SQLite session graph at `GET /sessions/:sessionId/dossier`.

Board cards now carry `canonicalSessionId`, `sourceSessionId`, `hostId`, and `runtime` when the server can derive them. Board and Logbook both render the shared `SessionDossier` UI inside their existing modal shells. The dossier route is read-only and allowed through the worktree bridge.

Unsupported source-opening or control actions stay hidden in the dossier. The only interactive actions in this surface are copy actions and existing safe review dispositions.

## Consequences

- Board and Logbook can converge on one session detail vocabulary without forcing every surface to use Board card DOM.
- Copyable session context is grounded in canonical data and can be reused through MCP or manual copy flows.
- Live cards can fall back to their in-memory view if canonical dossier data is not yet available.
- New adapter fields should enter the dossier through canonical tables/repositories first, not through per-adapter UI branches.
