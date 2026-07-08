# OpenWiki Quickstart

Masthead is a local-first, harness-neutral session data layer and session manager for AI-agent work. It captures local harness history into a canonical SQLite session graph, runs a Workbench raw→publish pipeline, makes published sessions searchable in Logbook, and exposes read-only MCP access for existing agents.

This wiki is the fastest map for both humans and coding agents. Start here, then follow the links that match the area you want to change.

## What Masthead is

Masthead is not primarily a chat client or task manager. The product hierarchy is:

1. canonical session database,
2. Workbench (raw → publish pipeline),
3. Logbook (published/searchable only),
4. read-only MCP,
5. live Now (shallow),
6. Sources (capture + source-scoped transcript permissions).

Ownership in one line each:

- **Workbench** owns transcript import, cleanup, enrichment, and publication into Logbook.
- **Logbook** is published sessions only — search/browse/dossier, not the raw import or publish pipeline.
- **Sources** owns harness capture, health, and source-scoped transcript permissions — not per-session import work.

That ordering is reflected in the runtime split between renderer, daemon, core logic, workbench, enrichment, MCP, and Electron shell.

## Major domains

- [Architecture](architecture.md) — how `src/app`, `src/daemon`, `src/core`, `src/enrichment`, `src/mcp`, and `src/electron` fit together.
- [Sources and onboarding](sources.md) — discovery, setup, capture permissions, and first-run onboarding.
- [Data and integrations](data-and-integrations.md) — canonical storage, data paths, MCP boundary, and enrichment outputs.

## Where to go for Workbench code

- `src/ui/workbench/` — Workbench UI panel and handoff helpers.
- `src/app/workbench/` — Workbench renderer controller.
- `src/workbench/` — pipeline state, queue, transcript workflow, quality, apply paths.
- `src/cli/` — agent-facing CLI (`mastheadctl`, workbench commands).

## Canonical source docs

These are the main existing docs this wiki synthesizes:

- `README.md` — repo-level overview and run/verify entrypoints.
- `design.md` — master design source.
- `prd.md` — product scope and invariants.
- `docs/architecture/data-paths.md` — runtime data directory and store ownership.
- `docs/explanation/session-graph.md` — canonical session graph model.
- `docs/reference/daemon-api.md` — daemon HTTP API.
- `docs/reference/sources.md` — source setup and import behavior.

## Run and verify

Useful scripts from `package.json`:

- `npm run dev` — local launcher for the daemon and UI.
- `npm run dev:desktop` — Electron desktop shell.
- `npm run build` — typecheck and build.
- `npm run test` — Vitest after daemon build.
- `npm run verify` — full product/surface/typecheck/test/build/smoke gate.
- `npm run doctor` — runtime and source readiness diagnostics.
- `npm run smoke` — live, compatibility, import, and MCP smoke checks.

## Where to go next

- Changing app state, navigation, or UI orchestration: [Architecture](architecture.md)
- Changing Workbench raw→publish pipeline: `src/workbench/`, `src/ui/workbench/`, `src/app/workbench/`, `src/cli/`
- Changing source setup, capture permissions, or onboarding: [Sources and onboarding](sources.md)
- Changing persistence, MCP, or enrichment behavior: [Data and integrations](data-and-integrations.md)

## Notes for future agents

- Read `design.md` before visual work.
- Treat `prd.md` as the scope contract.
- Do not read or document `.env` files or secrets.
- Keep the `src/core`/`src/daemon` boundary clear: core is transformation logic; daemon owns runtime state and persistence.
- For new source or setup behavior, check both `src/daemon/sources/sourceSetupService.ts` and `src/app/App.tsx`; the onboarding flow is split across renderer state and daemon setup status.
