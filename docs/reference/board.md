# Board

Board is Masthead's live view over continuously collected session data. It is not the canonical database; it projects the latest canonical and live evidence into cards.

## Headlines

Board cards use `BoardHeadlineView`, backed by the `BoardHeadlineFrame` contract in `docs/reference/board-headline-frame.md`.

When live LLM headlines are enabled and configured, each `GET /projection` can schedule fresh frame extraction for visible running cards on the configured refresh interval. The daemon returns the projection immediately with either the last successful LLM headline or an explicit pending headline state. It does not render local deterministic prose as a fallback while the model is configured.

Offline local headlines are used only when live LLM headline access is unavailable or explicitly disabled. Those headlines are marked `source: "offline"`.

## Failure State

Provider failures do not masquerade as successful LLM headlines. Timeouts, API errors, invalid output, validation failures, and missing configuration are recorded in refresh metadata, diagnostics, or audit traces while the card stays pending or keeps its last successful LLM frame.

The projection can include `headlineRefreshSummary` with requested, succeeded, failed, pending, and generated-at counts for the refresh. Individual cards can include `headlineRefresh`.

## Inputs

Board headline input includes lifecycle/status buckets, attention/conflict signals, work context, latest feedback claims, refresh metadata, recent event deltas, transcript snippets approved for use, and compact headline facts such as recent event summaries, tool names, file basenames, command failures, and canonical enrichment context when available.
