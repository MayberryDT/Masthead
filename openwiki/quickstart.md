# OpenWiki Quickstart

Masthead is a local-first, harness-neutral session data layer that turns AI-agent session history into
**evidence-backed engineering knowledge artifacts** people and agents can search and reuse. Sessions are
the capture and Workbench pipeline unit; **Logbook rows are published artifacts**, not session table rows.

This wiki is the fastest map for both humans and coding agents. Start here, then follow the links that match the area you want to change.

## Authoring runtime boundary

New guided requests use the V5 authoring boundary: durable packs publish without a canary or
operator approval gate, and knowledge opportunities do not require dispositions. V1–V4 records
remain readable for audit, but their mutation routes are retired. Open V4 campaigns must be
abandoned or retained as read-only history; see
[`workbench-authoring-v5-migration.md`](../docs/reference/workbench-authoring-v5-migration.md).

## What Masthead is

Masthead is not primarily a chat client, live monitoring console, or task manager. The product hierarchy is:

1. canonical session database,
2. Workbench (raw → publish pipeline for sessions and multi-kind artifacts),
3. Logbook (**published artifacts only** — session dossiers, runbooks, ADRs, incident timelines),
4. read-only MCP (artifact-primary reuse; session/transcript tools for evidence),
5. live Now (shallow cards),
6. Sources V2 (harness live-connect only).

Ownership in one line each:

- **Workbench** owns transcript import, cleanup, agent enrichment, daemon-rebuilt dossier publication,
  and optional-artifact authoring. **Copy Agent Prompt** creates a durable
  guided authoring request, then copies only its request ID and instance-bound start command.
- **Logbook** is an **artifact book**: capsule list + body inspector + provenance. No bulk enrich, checkboxes, or session-library chrome.
- **Sources** owns discovering local harnesses and enabling live connectors — not import jobs or per-session Workbench work. Contract: [sources.md](sources.md) → `docs/reference/sources-v2.md`.
- **Now** is shallow live presence only.

Vocabulary and cutover: `CONTEXT.md`, [ADR 0011](../docs/adr/0011-artifact-first-logbook.md), [artifact cutover](../docs/reference/artifact-first-logbook-cutover.md). Surface map: [Logbook and Workbench](logbook-and-workbench.md).

## Major domains

- [Architecture](architecture.md) — how `src/app`, `src/daemon`, `src/core`, `src/enrichment`, `src/mcp`, and `src/electron` fit together.
- [Logbook and Workbench](logbook-and-workbench.md) — artifact Logbook UI/API, enriched canonical dossiers, and agent-led optional artifacts.
- [Sources V2](sources.md) — discover harnesses, enable live connectors, activation, first-run connect.
- [Data and integrations](data-and-integrations.md) — canonical storage, data paths, MCP boundary, enrichment.

## Where to go for Logbook / Workbench code

- `src/ui/logbook/`, `src/app/logbook/` — Logbook UI and controller (artifact search + detail).
- `src/ui/workbench/`, `src/app/workbench/`, `src/workbench/` — Workbench UI, controller, pipeline.
- `src/cli/` — agent-facing CLI (`mastheadctl`, workbench commands).
- `src/daemon/db/sessionArtifactRepository.ts`, `logbookArtifactRepository.ts` — published artifact store.
- `GET /logbook/artifacts`, `GET /logbook/artifacts/:id` — canonical Logbook read path. The legacy `/logbook/search` alias also returns artifact capsules, never session rows.

## Canonical source docs

These are the main existing docs this wiki synthesizes:

- `CONTEXT.md` — ubiquitous language (artifact-first).
- `README.md` — repo-level overview and run/verify entrypoints.
- `design.md` — master design source (Logbook section refined by ADR 0011).
- `prd.md` — product scope; **read with ADR 0011 supersession note** for Logbook unit of search.
- `docs/adr/0011-artifact-first-logbook.md` — Logbook is an artifact book.
- `docs/adr/0013-canonical-dossier-and-candidate-authoring.md` — preserved original-rendering and evidence findings; its V2 authoring flow is superseded.
- `docs/adr/0014-agent-led-enriched-artifact-authoring.md` — superseded V3 decision and immutable audit history.
- `docs/adr/0015-guided-authoring-campaigns.md` — current implemented V4 guided-authoring contract.
- `docs/adr/0009-logbook-only-shows-published-sessions.md` — Workbench pipeline ownership (Logbook unit refined by 0011).
- `docs/architecture/data-paths.md` — runtime data directory and store ownership.
- `docs/reference/daemon-api.md` — daemon HTTP API.
- `docs/reference/mcp-tools.md` — MCP tools (prefer `search_artifacts` / `get_artifact`).
- `docs/reference/sources-v2.md` — Sources V2 live-connect contract (current).
- `docs/reference/artifact-first-logbook-cutover.md` — wipe/rebuild published artifact state.
- `docs/reference/production-cold-activation.md` — explicit offline-only boundary for pre-manifest legacy production installs.
- `docs/superpowers/plans/` — **implementation history only**, not current visual/product SoT.

## Run and verify

Useful scripts from `package.json`:

- `npm run dev` — local launcher for the daemon and UI.
- `npm run dev:desktop` / Electron Dev launcher — desktop shell (see launcher note below).
- `npm run build` — typecheck and build.
- `npm run test` — Vitest after daemon build.
- `npm run verify` — full product/surface/typecheck/test/build/smoke gate.
- `npm run doctor` — runtime and source readiness diagnostics.
- `npm run smoke` — live, compatibility, import, and MCP smoke checks.

### Electron Dev launcher

`npm run install:electron-dev-launcher` **must be run from the checkout you intend to run**. The desktop entry and systemd unit hardwire that path. After switching branches/worktrees/main, reinstall the launcher or Masthead Dev will keep serving a stale tree.

Dogfood Logbook may be **empty after artifact cutover**. It remains empty until Workbench completes
guided enrichment and publication; historical V1–V4 records are audit-only and cannot rebuild it.

## Where to go next

- Changing app state, navigation, or UI orchestration: [Architecture](architecture.md)
- Changing Logbook/Workbench product surfaces: [Logbook and Workbench](logbook-and-workbench.md)
- Changing Workbench pipeline code: `src/workbench/`, `src/ui/workbench/`, `src/app/workbench/`, `src/cli/`
- Changing harness discovery or live connectors: [Sources V2](sources.md)
- Changing persistence, MCP, or enrichment: [Data and integrations](data-and-integrations.md)

## Notes for future agents

- Read `design.md` before visual work; read `CONTEXT.md` + ADR 0011 before Logbook/Workbench product work.
- Treat `prd.md` as scope history with a supersession banner — do not reintroduce session-as-Logbook-row.
- Do not read or document `.env` files or secrets.
- Keep the `src/core`/`src/daemon` boundary clear: core is transformation logic; daemon owns runtime state and persistence.
- Logbook has **no** bulk enrich UI; bulk/session-library chrome is deleted. Workbench owns compile and publish.
- An enriched dossier means the original canonical dossier structure rendered after current durable enrichment; agents never author its body.
- New requests are `workbench-authoring-v5` and use daemon-grouped packs without canary
  staging. V4 requests and operator reviews remain audit-only.

## Guided authoring vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Pack = one fixed V5 authoring unit containing 5–12 sessions, except the final remainder.

Assignment = historical V4 campaign unit retained for audit.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = historical V4 resolution state; V5 opportunities are nonbinding.

Canary = historical V4 approval state; V5 has no canary.

Next action = the single command Masthead requires from the agent at the current pack state.

- For new source or setup behavior, check both `src/daemon/sources/` and renderer Sources controllers; onboarding spans both layers.
