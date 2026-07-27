# Masthead

Masthead is a local-first, harness-neutral session data layer for AI-agent work.
It captures local harness history into a canonical SQLite session graph, runs a
Workbench raw→publish pipeline, stores **published knowledge as artifacts** in
Logbook, and exposes that knowledge to existing agents through read-only MCP
tools (artifact-primary).

Sessions remain the unit of capture and Workbench pipeline. **Logbook rows are
published artifacts** (session dossiers, runbooks, ADRs, incident timelines),
not session table rows. Live Now is a shallow view over collected session data,
not the product category.

Start with agents: `openwiki/quickstart.md`, `CONTEXT.md`, and
`docs/adr/0011-artifact-first-logbook.md`.

## Current runtime

- Canonical local SQLite ownership for Masthead-owned sessions, published
  artifacts + provenance, source/connector state, import jobs, settings, and MCP
  audit rows (schema 37; full-body artifact search arrived in schema 21).
- Multi-adapter / multi-harness live connect (Sources V2) and conservative
  history adapters where coverage exists.
- Workbench package path: transcript checks/import, quality, Activity, V5 guided authoring, durable
  enrichment, daemon-rebuilt dossiers, optional-artifact judgment, and atomic pack publication.
- Logbook artifact book: `GET /logbook/artifacts` + body/provenance inspector;
  full-body search plus kind · project · date filters; no bulk enrich /
  checkboxes / summary strip.
- Read-only MCP with **`search_knowledge` / `get_knowledge`** preferred for reuse (v1 aliases kept);
  session/transcript tools for evidence and compile.
- `npm run dev` launcher (writable daemon or read-only worktree bridge).
- Electron Dev desktop launcher (`npm run install:electron-dev-launcher` from the
  checkout you intend to run — path is hardwired into the desktop entry).
- Product, surface, endpoint-matrix, doctor, smoke, build, and test gates.

## V5 authoring boundary

ADR 0016 defines the implemented `workbench-authoring-v5` request and fixed-pack loop. The coding
agent owns enrichment meaning; Masthead owns identity, evidence catalogs, validation, atomic
publication, Activity, and receipts. V1–V4 reads remain audit-only and all legacy mutations fail with
`authoring_contract_retired`.

## Experimental

- Deeper schema coverage for additional source adapters beyond the initial
  bounded scanners.
- Transcript import breadth and exclusion policy tuning.
- Legacy/dev native remote enrichment hooks. Current guided authoring uses the user's existing coding
  agent through a thin instance-bound CLI and requires no native remote model key.
- Longer packaged desktop release-smoke automation.

## Install

Masthead requires Node 24.15 or newer.

```bash
npm install
```

## Run

Use the harness-neutral launcher from this checkout or any Masthead worktree:

```bash
npm run dev
```

The launcher starts the daemon on `127.0.0.1:17373` and the UI on the first
available Vite port starting at `5173`. If another compatible primary daemon is
already running, a secondary worktree starts a read-only bridge instead of
opening the primary database for writes.

Useful overrides:

```bash
MASTHEAD_UI_PORT=5180 npm run dev
MASTHEAD_CONNECTOR_MODE=primary npm run dev
MASTHEAD_CONNECTOR_MODE=bridge MASTHEAD_UPSTREAM_URL=http://127.0.0.1:17373 npm run dev
MASTHEAD_BRIDGE_PORT=17374 npm run dev
```

## V5 Artifact Authoring Contract

The user flow is:

**Select sessions → Copy Agent Prompt → paste the request ID and instance-bound start command into one
coding agent → that agent finishes every fixed pack → inspect and reuse published artifacts in
Logbook and MCP.**

Under `workbench-authoring-v5`, Workbench persists the full compile-ready selection and discloses
review-needed rows left out. The copied handoff contains no session list or multi-step recipe. The
daemon groups fixed packs of 5–12 sessions, except the final remainder, and returns one next action at
every state. Resume uses the same request only to recover a crash; the complete selection remains the
job.

The scaffold contains identity, canonical evidence catalogs, and blank skill fields. The agent writes
title, description, keywords, purpose, outcome, key work, honest verification, and optional-artifact
judgment. Masthead never writes enrichment prose. Save projects the local scaffold to a bounded
authored draft containing fields, evidence IDs, optional decisions/drafts, and pack/evidence identity;
the immutable evidence catalog is rehydrated by the daemon instead of echoed over HTTP. Save returns
per-session publishable, soft-flag, or hard-reject results, and finish publishes passers atomically
without a canary, operator approval, required opportunity disposition, or request-wide revision halt.

The instance-bound CLI is thin HTTP transport and does not open SQLite for normal authoring. V1–V4
status, evidence, reviews, and receipts remain readable, while legacy mutations fail with
`authoring_contract_retired`. Every V5 mutation verifies daemon URL, database ID, build SHA, manifest
path, and instance identity. See
[ADR 0016](docs/adr/0016-agent-led-v5-pack-authoring.md),
[ADR 0017](docs/adr/0017-bounded-v5-authored-draft-transport.md),
[ADR 0012](docs/adr/0012-daemon-owned-artifact-authoring.md), and the
[daemon API reference](docs/reference/daemon-api.md).

### V5 vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Pack = one fixed V5 authoring unit containing 5–12 sessions, except the final remainder.

Assignment = a historical V4 campaign unit retained for audit.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = historical V4 audit state; V5 opportunities are nonbinding.

Canary = historical V4 approval state; V5 has no canary.

Next action = the single command Masthead requires from the agent at the current pack state.

### Failed V1 generation recovery

These maintenance commands are the deliberate exception to the normal HTTP-only
CLI boundary. They require an explicit database path and exclusive writer
ownership. Audit and prepare do not mutate product rows; invalidate additionally
requires the exact SHA-256 audit hash and `--confirm`:

```bash
mastheadctl workbench audit-v1-generation --db <path> --json
mastheadctl workbench prepare-v1-recovery --db <path> --json
mastheadctl workbench invalidate-v1-generation --db <path> --audit-hash <sha256> --confirm --json
mastheadctl workbench restore-v1-recovery --db <active> --backup <sibling masthead.sqlite.backup-current> --audit-hash <sha256> --confirm --json
```

The audit fails closed unless the exact known population is present: 1,283 V1
dossiers, zero optional artifacts, and 66 completed V1 runs. Prepare acquires the
daemon-equivalent writer locks, creates a SQLite-consistent backup, verifies its
database identity and integrity, and retains exactly one backup. Invalidate removes
only the hash-matched artifacts, search rows, and provenance, resets affected
sessions for current enrichment and V5 guided-authoring eligibility, releases
matching claims, and preserves V1 runs and receipts as audit history. Never run
production invalidation before the fixture gate, temporary-copy rehearsal, and
separately authorized production release process.

Restore is offline and fail-closed. It accepts only the exact sibling
`masthead.sqlite.backup-current`, requires daemon-equivalent exclusive ownership,
verifies identity, integrity, and the audited hash before staging, atomically
replaces the active database, then verifies the restored active database before
releasing ownership. The verified backup is preserved.

## Verify

Fast product checks:

```bash
npm run check:product-contract
npm run verify:no-citations
npm run doctor
npm run check:endpoint-matrix
```

Full local gate:

```bash
npm run verify
npm run test:electron
npm run test:electron-security
npm run smoke:electron
npm run smoke:electron:packaged
```

`npm run doctor` checks the active daemon contract, installed authoring command
and database identity, source/import readiness, Sources pipeline diagnostics,
Logbook state, read-only MCP status/tools, and local data summary. `npm run
verify` runs the product and surface contracts, typecheck, Vitest, build,
endpoint matrix, and smoke suite.

Earlier V1–V4 worksheets remain historical audit evidence, but their mutation harnesses are retired and
aren't release commands. Current release acceptance is `docs/acceptance/product-release-gate.md`: it proves V5 identity,
flag-and-continue quality, atomic publication, and the 10/50/full-selection autonomy gates.

## Data Path

`MASTHEAD_DATA_DIR` owns the runtime directory for a writable daemon. By
default, development data is stored under:

```text
Linux:   ~/.local/share/masthead-dev
macOS:   ~/Library/Application Support/Masthead Dev
Windows: %LOCALAPPDATA%/Masthead Dev
```

Inside that directory, `masthead.sqlite` is the canonical Masthead store.
Legacy NDJSON files are migration or compatibility inputs, not the runtime
source of truth. Source harness files and Git repositories remain owned by
their original tools.

See [docs/architecture/data-paths.md](docs/architecture/data-paths.md).

## MCP Boundary

The launch MCP server is read-only. It can search sessions, return bounded
session evidence, list project history, and report coverage. It cannot mutate
files, Git, shell state, harness sessions, source imports, settings, or
Masthead data.

See [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md).

## Start Here

- First run: [docs/tutorials/first-run-codex-import.md](docs/tutorials/first-run-codex-import.md)
- Import existing Codex history: [docs/how-to/import-codex-history.md](docs/how-to/import-codex-history.md)
- Reset local Masthead data: [docs/how-to/reset-local-data.md](docs/how-to/reset-local-data.md)
- Daemon API reference: [docs/reference/daemon-api.md](docs/reference/daemon-api.md)
- Sources reference: [docs/reference/sources.md](docs/reference/sources.md)
- Adapter reference: [docs/reference/adapters.md](docs/reference/adapters.md)
- Workbench enrichment reference: [docs/reference/enrichment.md](docs/reference/enrichment.md)
- Session dossier reference: [docs/reference/session-dossier.md](docs/reference/session-dossier.md)
- Configuration reference: [docs/reference/configuration.md](docs/reference/configuration.md)
- Release gates: [docs/release-gates.md](docs/release-gates.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
