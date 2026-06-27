# Usage Statistics

Masthead usage statistics are derived from the canonical SQLite session graph. They summarize local session activity without calling provider pricing APIs and without estimating cost.

## Endpoint

```text
GET /usage/summary?window=today|24h|7d|30d|all
```

The response shape is:

```json
{
  "ok": true,
  "usage": {
    "window": "today",
    "generatedAt": "2026-06-26T18:00:00.000Z",
    "range": { "from": "2026-06-26T06:00:00.000Z", "to": "2026-06-26T18:00:00.000Z" },
    "totals": {
      "sessions": 0,
      "projects": 0,
      "runtimes": 0,
      "models": 0,
      "messages": 0,
      "toolCalls": 0,
      "fileEffects": 0,
      "mcpQueries": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "totalTokens": 0,
      "tokenRows": 0,
      "tokenCoverageSessions": 0
    },
    "byModel": [],
    "byProject": [],
    "byRuntime": [],
    "activity": [],
    "coverage": {
      "sources": 0,
      "importedSessions": 0,
      "sessionsWithTokenUsage": 0,
      "sessionsWithoutTokenUsage": 0,
      "currentEnrichments": 0,
      "mcpQueries": 0
    }
  }
}
```

## UI

- The left sidebar shows compact Today stats for sessions, tokens, tool calls, and MCP queries.
- The Usage tab exposes the full statistics view with window controls, summary metrics, breakdown tables, activity buckets, and data coverage.
- Empty states distinguish between no indexed sessions and sessions that exist without imported token rows.

## Source Tables

The repository reads from canonical Masthead tables: `sessions`, `runtimes`, `messages`, `tool_calls`, `file_effects`, `model_usage`, `mcp_query_log`, `ingest_sources`, and `session_enrichments`.
