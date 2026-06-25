# Masthead Agent Instructions

## Design Source Of Truth

Read `design.md` before Masthead UI work. It is the single master design source for this repo and follows Google's DESIGN.md structure while preserving this project's lowercase filename.

`prd.md` remains the product/source-of-scope document. Historical files under `docs/superpowers/plans/` are implementation history, not current visual direction. Do not resurrect the old Raycast-inspired design file or use archived screenshots as the current design contract unless Tyler explicitly asks for that.

The main visual invariant is that Sessions, Logbook, and Sources share the same center-workspace system: operator heading, compact toolbar, meaningful stats when useful, and fixed-format evidence cards. Do not rebuild Logbook or Sources as flat utility lists or generic analytics dashboards.

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

The bridge forwards read endpoints only: `/health`, `/projection`, `/events`, `/fixture`, `/sources`, and `/logbook/search`. It intentionally rejects write endpoints such as `/ingest`, `/retention`, and `/clear`, so a secondary worktree cannot clear or mutate the primary connector store while UI work is being tested.

Useful overrides:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
MASTHEAD_BRIDGE_PORT=17374 npm run dev
```

Before claiming the connection is working, verify the rendered page, not just process state. A healthy secondary worktree should show live sessions and should not show `No live connection` or `No live Codex sessions yet`.
