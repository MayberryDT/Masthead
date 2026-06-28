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

For release-closeout work, use `docs/acceptance/product-release-gate.md` as the acceptance checklist.
Keep protocol/database identity terminology consistent across docs and code:
`MastheadHealthDto`, `MastheadApiClient`, `MastheadConnectionState`, `SourcePreflightDto`,
`AdapterStatusDto`, `McpStatusDto`.

## Version System

`package.json` is the single source of truth for the app version (currently 0.1.0+).

### Bumping

Use the provided npm scripts (they run `npm version <kind> --no-git-tag-version && npm run version:sync`):

```bash
npm run version:bump:patch
npm run version:bump:minor
npm run version:bump:major
```

`version:sync` validates that `package.json` remains the version source of truth. The Electron/Vite build reads that package version directly for runtime display.

All launch/build entrypoints (`dev`, `dev:ui`, `dev:desktop`, `dev:fixture`, `build`, `build:desktop`) run the sync step first.

The injected value is available at runtime via `src/app/version.ts` (`APP_VERSION` / `APP_VERSION_LABEL`) and is passed to `ObservabilitySidebar`.

## UI Citation Protocol (Visual Work Only)

When doing visual/UI polish work, temporarily wrap the affected JSX with the centralized helper so both you and the agent have a clear, labeled reference:

```tsx
<DevCite name="SessionCard">
  {/* the component or section being worked on */}
</DevCite>
```

### Behavior
- Only renders a bright colored box + label in dev when `VITE_MASTHEAD_DEV_CITATIONS=1`.
- Derives a deterministic bright color from the `name` (different components get different colors automatically).
- Uses `data-ui-cite` + CSS (`.dev-cite`, `.dev-cite-label`) for the overlay.
- Completely inert (no output, no styles) when the flag is off or in production builds.

### Workflow

1. Set the flag for your dev session: `VITE_MASTHEAD_DEV_CITATIONS=1 npm run dev:ui`
2. Add `<DevCite name="ExactComponentOrSection">` wrappers only around the parts you are visually changing.
3. Use unique, descriptive names (e.g. "SessionCard", "LogbookRow", "SourcesToolbar").
4. When done with the visual change, **remove the wrappers** (trivial delete).
5. Hooks for enforcement are installed automatically when you run `npm install` (via the `prepare` script). Before any commit, push, merge, or PR the pre-commit/pre-push hooks + `npm run verify:no-citations` will block if the flag is on or if `data-ui-cite=` markers remain in source (the helper module itself is excluded from the check).

The mechanism is purely runtime + dev-only. No build-time stripping or permanent source changes are required. The hooks simply enforce that you cleaned up before leaving the branch.
