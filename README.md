# Masthead

**Every agent session. Searchable, reusable, local.**

Masthead imports and continuously indexes session history from AI-agent harnesses. It turns
scattered local transcripts into a searchable Logbook, shows live sessions in plain English, and
exposes historical context to the user’s existing agents through a read-only MCP server.

Masthead starts with Codex and is designed for harness-neutral adapters.

## Product Surfaces

- **Now:** glanceable live status for active sessions and attention states.
- **Logbook:** searchable durable library of imported session history.
- **Sources:** runtime discovery, import progress, sync state, adapter health, and source policy.
- **Agent Access:** read-only MCP setup, permissions, exposed tools, and retrieval audit.
- **Settings:** local storage, privacy, retention, export, and deletion controls.

## Privacy Boundary

Masthead is local-first. The canonical session graph, search records, source policies, enrichment
state, and MCP audit log live in the local Masthead database. Source harness files and project repos
remain owned by their original tools.

The default product boundary is read-only toward external tools: Masthead imports and retrieves
history, but normal app and MCP surfaces must not approve agent actions, mutate Git, run shell
commands, edit project files, or launch agents. Remote model enrichment is optional and must be
redacted, scoped, previewable, and auditable when enabled.

## Development

Install dependencies:

```bash
npm install
```

Run the harness-neutral live launcher:

```bash
npm run dev
```

Useful scripts:

```bash
npm run dev:ui
npm run dev:fixture
npm run build
npm run build:daemon
npm run typecheck
npm test -- --run
npm run doctor
npm run dogfood
npm run dogfood:fixture
npm run dogfood:live
npm run ingest
npm run mcp
npm run demo:hook
```

`npm run dev` starts the connector and UI when no primary connector is running. In a secondary
worktree, it starts a read-only bridge to the primary connector so UI work can be tested without
mutating the primary store.
