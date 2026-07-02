# Configuration Reference

Masthead is configured with environment variables. Defaults are local and development-friendly.

## Daemon

| Variable | Default | Purpose |
| --- | --- | --- |
| `MASTHEAD_HOST` | `127.0.0.1` | Daemon bind host |
| `MASTHEAD_PORT` | `17373` | Daemon bind port; `0` allows a random port in tests |
| `MASTHEAD_ALLOWED_ORIGINS` | Vite local origins and `masthead://app` | Comma-separated CORS allowlist |
| `MASTHEAD_DATA_DIR` | Platform dev app-data path | Root for runtime files |
| `MASTHEAD_DB_PATH` | `<data-dir>/masthead.sqlite` | Canonical SQLite path |
| `MASTHEAD_STORE_PATH` | `<data-dir>/legacy/events.ndjson` | Legacy compatibility journal path |
| `MASTHEAD_LEGACY_DATA_DIR` | unset | Optional legacy migration input directory |
| `MASTHEAD_GIT_REFRESH_MS` | `60000` | Known-session Git refresh interval |
| `MASTHEAD_CODEX_HOME` | user home | Home directory used for Codex source discovery |
| `MASTHEAD_BUILD_VERSION` | package version | Health build version override |
| `MASTHEAD_BUILD_SHA` | `development` | Health build SHA override |

## Launcher

| Variable | Purpose |
| --- | --- |
| `MASTHEAD_UI_PORT` | Preferred Vite UI port |
| `MASTHEAD_CONNECTOR_MODE` | `auto`, `primary`, or `bridge` |
| `MASTHEAD_UPSTREAM_URL` | Primary daemon URL for bridge mode |
| `MASTHEAD_PRIMARY_CONNECTOR_URL` | Alias for bridge upstream |
| `MASTHEAD_BRIDGE_PORT` | Preferred read-only bridge port |
| `VITE_MASTHEAD_PROJECTION_URL` | UI projection URL override |
| `VITE_MASTHEAD_MODE` | `fixture` for fixture UI mode |
| `VITE_MASTHEAD_DEV_CITATIONS` | Dev-only UI citation overlay; must be unset before commit |

## MCP

| Variable | Purpose |
| --- | --- |
| `MASTHEAD_MCP_COMMAND` | Command used in generated MCP launch config |
| `MASTHEAD_NODE_PATH` | Node executable override for daemon/Electron/MCP launch |
| `MASTHEAD_MCP_ENTRY` | MCP server entry path |
| `MASTHEAD_DB_PATH` | Required database path for the MCP server |

## Codex Hook

| Variable | Purpose |
| --- | --- |
| `MASTHEAD_INGEST_URL` | Hook target, usually `http://127.0.0.1:17373/ingest` |
| `MASTHEAD_HOOK_TIMEOUT_MS` | Hook forwarding timeout |
| `MASTHEAD_HOOK_MAX_BYTES` | Hook stdin byte limit |
| `MASTHEAD_CODEX_HOOKS` | Codex hooks file override for settings/doctor |
| `MASTHEAD_HOOK_SCRIPT` | Hook script path used by settings |
| `MASTHEAD_DOCTOR_STRICT_HOOKS` | Treat missing hook readiness as a strict doctor failure |

## Optional Enrichment

| Variable | Purpose |
| --- | --- |
| `MASTHEAD_LIVE_COPY` | Compatibility flag. Set to `0` or `1` to explicitly disable or enable live Board headline frame extraction |
| `MASTHEAD_REMOTE_ENRICHMENT` | Set to `1` to enable durable remote enrichment. Defaults to off |
| `MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS` | Timeout for durable remote enrichment requests. Defaults to `12000` |
| `MASTHEAD_LLM_COPY` | Legacy compatibility flag. Enables both live Board headline extraction and durable remote enrichment unless a specific flag overrides it |
| `OPENAI_API_KEY` | API key for optional enrichment |
| `MASTHEAD_OPENAI_MODEL` | Optional model override |

Remote enrichment is optional and scoped. Core import, Logbook, MCP, and local data ownership must work without it.
