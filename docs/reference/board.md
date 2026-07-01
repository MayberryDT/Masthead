# Board

Board is Masthead's live view over continuously collected session data. It is not the canonical database; it projects the latest canonical and live evidence into cards.

## Live Copy

When remote live copy is enabled and configured, each `GET /projection` schedules fresh headline copy for visible running cards on the configured Board refresh interval. The daemon returns the projection immediately with deterministic copy, then applies completed live-copy results on a later projection. The default refresh interval is 10 seconds. Idle and ended cards keep their deterministic or previously persisted copy and do not receive refresh failure badges.

Live copy cache is disabled by default. If `MASTHEAD_LIVE_COPY_CACHE_MS` is explicitly set through runtime configuration, cached results are an opt-in optimization rather than the default behavior.

## Failure State

Remote copy failures do not masquerade as successful LLM copy. A card keeps its deterministic or persisted baseline copy. Provider failures are recorded in the enrichment audit stream rather than blocking the projection response. Blocking test and fixture paths can still report failure metadata:

- `timeout`
- `api_error`
- `invalid_output`
- `validation_failed`
- `not_configured`

The projection can also include `copyRefreshSummary` with requested, succeeded, failed, and disabled counts for the refresh.

## Inputs

Board copy input includes lifecycle/status buckets, attention/conflict signals, work context, latest feedback claims, refresh metadata, recent event deltas, and compact live-copy facts such as recent event summaries, tool names, file basenames, command failures, and canonical enrichment context when available.
