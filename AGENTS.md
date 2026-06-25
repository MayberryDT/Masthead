# Masthead Agent Instructions

## Product Identity

Masthead is a local-first, harness-neutral session data layer and session manager. Do not describe
or design it primarily as a live monitoring console, supervision tower, analytics dashboard, or task
manager.

The product hierarchy is:

1. canonical session database,
2. Logbook and search,
3. read-only MCP access,
4. live Now view,
5. source/import administration.

Observability is a view over continuously collected session data.

## Design Source Of Truth

Read `design.md` before Masthead UI work. It is the single master design source for this repo and follows Google's DESIGN.md structure while preserving this project's lowercase filename.

`prd.md` remains the product/source-of-scope document. Historical files under `docs/superpowers/plans/` are implementation history, not current visual direction. Do not resurrect the old Raycast-inspired design file or use archived screenshots as the current design contract unless Tyler explicitly asks for that.

Sessions, Logbook, Sources, Agent Access, and Settings share one visual language, but each surface
must use the information architecture best suited to its job. Do not force all surfaces into the
live session-card composition.

Surface archetypes:

- Now: live cards.
- Logbook: dense table plus inspector.
- Sources: adapter/settings rows plus import jobs.
- Agent Access: setup, permissions, tools, and audit tables.
- Settings: vertical settings sections and danger zone.

Shared visual language does not permit reusing fixed live-card DOM or CSS on every surface.
Before finishing UI work, run the surface contract check and use the in-app Browser to inspect the
affected surfaces at desktop, tablet, and narrow mobile widths.

## Browser Automation

When browser automation is needed, use the Codex in-app Browser plugin with the `iab` backend first. Do not fall back to standalone Playwright, external browser-control servers, shell-launched browsers, or Computer Use for browser work unless the user explicitly approves that fallback. References to `tab.playwright` inside the Browser plugin are acceptable only after the in-app Browser runtime is connected, because that still controls the in-app Browser.

## Worktree Startup

Use the harness-neutral live launcher for local Masthead testing:

```bash
npm run dev
```

Do this from whatever Masthead checkout or Git worktree the agent is working in. Do not hand-wire a new worktree UI directly to `http://127.0.0.1:17373/projection`; the primary connector usually only allows the primary UI origin and the browser will hit CORS failures.

`npm run dev` automatically handles both cases:

- If no primary connector is running, it starts the connector on `127.0.0.1:17373` and the UI on the first available UI port starting at `5173`.
- If a healthy primary connector is already running on `127.0.0.1:17373`, it starts a read-only worktree bridge on the first available bridge port starting at `17374`, starts the UI on the first available UI port, and points that UI at the bridge.

The bridge forwards read endpoints only. The route matcher is method-aware and covers the live
projection endpoints plus canonical read APIs such as session search/detail/excerpts, projects,
sources, imports, data summary, and MCP status/tools/audit reads. Keep new read-only product APIs
behind that matcher rather than maintaining a stale literal documentation list. It intentionally
rejects write endpoints such as `/ingest`, `/retention`, `/data/delete`, and `/clear`, so a
secondary worktree cannot clear or mutate the primary connector store while UI work is being tested.

Useful overrides:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
MASTHEAD_BRIDGE_PORT=17374 npm run dev
```

Before claiming the connection is working, verify the rendered page, not just process state. A healthy secondary worktree should show live sessions and should not show `No live connection` or `No live Codex sessions yet`.
