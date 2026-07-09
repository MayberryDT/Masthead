# Now

Now is Masthead's live view over continuously collected session data. It is not the canonical database; it projects the latest canonical and live evidence into cards.

## Multi-Harness Cards

Live cards include runtime, harness label, source session ID, and canonical session ID. The canonical ID is runtime-scoped, so sessions from Cursor, Claude Code, OpenCode, Grok Build, Hermes, Pi, and OMP can share a source session string without colliding.

The release target live connector set is documented in [live-connectors.md](live-connectors.md). Now renders their events through the same projection path rather than a separate monitoring-only store.

## Live State

Now overlays fresh explicit runtime-state reports from `/live/state` on top of canonical event history. The current card fields can include `runtimeState`, `displayState`, `stateAuthority`, `stateObservedAt`, `stateMessage`, and `stateStale`.

State selection is intentionally layered: fresh blocked reports win, unresolved approval/question blockers can hold a card in needs-action, fresh working/idle reports override older event inference, and stale working reports expire instead of sticking forever. `turn.completed` and hook Stop events display as idle/done runtime state, not permanent session closure.

Use `GET /sessions/:sessionId/live-explain` when a card status looks surprising. It reports the selected authority, latest state report, latest event fallback, unresolved blockers, and headline-fact freshness for that session.

## Headlines

Now cards use `BoardHeadlineView`, backed by the internal `BoardHeadlineFrame` contract in `docs/reference/board-headline-frame.md`.

Now can display Workbench enrichment when available. It does not require native LLM calls for V1.

When legacy/dev live LLM headlines are enabled and configured, each `GET /projection` can schedule fresh frame extraction for visible running, recently done/idle, selected, or expanded cards when bounded recent facts have changed and the configured refresh interval has elapsed. The daemon returns the projection immediately with either the last successful LLM headline or an explicit pending headline state. It does not render local deterministic prose as a fallback while the model is configured.

Offline local headlines are used only when live LLM headline access is unavailable or explicitly disabled. Those headlines are marked `source: "offline"`.

## Failure State

Provider failures do not masquerade as successful LLM headlines. Timeouts, API errors, invalid output, validation failures, and missing configuration are recorded in refresh metadata, diagnostics, or audit traces while the card stays pending or keeps its last successful LLM frame.

The projection can include `headlineRefreshSummary` with requested, succeeded, failed, pending, and generated-at counts for the refresh. Individual cards can include `headlineRefresh`.

## Inputs

Now headline input includes lifecycle/status buckets, attention/conflict signals, work context, latest feedback claims, refresh metadata, recent event deltas, transcript snippets approved for use, and compact headline facts such as recent event summaries, tool names, file basenames, command failures, and canonical enrichment context when available.
