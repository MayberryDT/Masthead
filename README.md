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

## Current runtime during the V4 cutover

- Canonical local SQLite ownership for Masthead-owned sessions, published
  artifacts + provenance, source/connector state, import jobs, settings, and MCP
  audit rows (schema 24; full-body artifact search arrived in schema 21).
- Multi-adapter / multi-harness live connect (Sources V2) and conservative
  history adapters where coverage exists.
- Workbench package path: transcript checks/import, quality, claims, Activity, selection-scoped V3
  authoring, durable enrichment, daemon-rebuilt dossiers, optional-artifact judgment, and atomic
  publication. This is the installed runtime being replaced, not the desired authoring contract;
  do not use it for a new bulk or production enrichment campaign during the V4 cutover.
- Logbook artifact book: `GET /logbook/artifacts` + body/provenance inspector;
  full-body search plus kind · project · date filters; no bulk enrich /
  checkboxes / summary strip.
- Read-only MCP with **`search_artifacts` / `get_artifact`** preferred for reuse;
  session/transcript tools for evidence and compile.
- `npm run dev` launcher (writable daemon or read-only worktree bridge).
- Electron Dev desktop launcher (`npm run install:electron-dev-launcher` from the
  checkout you intend to run — path is hardwired into the desktop entry).
- Product, surface, endpoint-matrix, doctor, smoke, build, and test gates.

## Accepted V4 target — implementation in progress

ADR 0015 defines durable guided authoring requests, daemon-grouped assignments, complete evidence
traversal, progressive editorial review, the staged operator-approved canary, instance-bound
launchers, and assignment-atomic finish. The detailed contract below guides implementation, but the
current daemon and CLI do not advertise or execute V4 until their later implementation tasks land.
At cutover, V1–V3 reads remain audit-only and all legacy mutations fail with
`authoring_contract_retired`.

## Experimental

- Deeper schema coverage for additional source adapters beyond the initial
  bounded scanners.
- Transcript import breadth and exclusion policy tuning.
- Legacy/dev native remote enrichment hooks. The accepted guided-authoring target uses a durable
  Workbench request plus a thin instance-bound CLI to the daemon-owned V4 module; that target remains
  pending implementation, and no native remote model key will be required.
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

## Accepted V4 Artifact Authoring Contract

This is the accepted target flow and remains pending until the guided service, API, CLI, launcher,
Workbench review, and cutover tasks land. The current runtime is described above.

After cutover, the user flow is:

**Select sessions → create a guided request → copy its instance-bound start command → agent follows
the next action → operator approves the canary → Masthead publishes accepted assignments →
inspect/reuse in Logbook and MCP.**

Under `workbench-authoring-v4`, a Workbench selection creates one durable guided authoring request.
The copied handoff contains only its opaque request ID and one instance-bound start command, with no
session list or multi-step recipe. The daemon groups assignments of at most 12 sessions and guides the
agent through complete canonical evidence traversal, grounded enrichment, optional-artifact judgment,
and editorial review by returning one required next action at every state.

The daemon rebuilds the original canonical dossier structure from current enriched session data;
agents do not replace its presentation. Every substantive dossier and optional-artifact claim
supplies typed verbatim claim support from canonical evidence. Knowledge opportunities are
nonbinding, but high-signal opportunities require an evidence-backed disposition. Unsupported
completion, protocol narration, negligible enrichment, weak joins, and materially duplicated
templates are rejected.

The first accepted assignment is a three-session canary capped at three sessions and remains staged
until operator approval. Masthead never splits a strong opportunity to manufacture that canary: it
uses a complete strong group of at most three or diverse dossier-only sessions, otherwise request
creation returns `guided_canary_not_constructible` and persists nothing. Finish atomically publishes
one accepted assignment and releases the next.

The installed CLI is thin agent-facing transport to the daemon-owned V4 authoring boundary and does
not open SQLite for normal authoring. V1, V2, and V3 remain audit-only; their status and receipts stay
readable, while legacy mutations fail with `authoring_contract_retired`. Every mutation verifies the
daemon URL, database ID, build SHA, and manifest identity through the instance-bound launcher. See
[ADR 0015](docs/adr/0015-guided-authoring-campaigns.md),
[ADR 0012](docs/adr/0012-daemon-owned-artifact-authoring.md), and the
[daemon API reference](docs/reference/daemon-api.md).

### V4 vocabulary

Guided authoring request = the durable Workbench selection and campaign policy.

Assignment = one daemon-grouped authoring unit containing at most 12 sessions.

Knowledge opportunity = nonbinding evidence that may support a runbook, ADR, or incident timeline.

Opportunity disposition = authored, dismissed, merged, or changed kind, with evidence-backed rationale.

Canary = the first staged assignment of at most 3 sessions, reviewed by an operator before publication.

Next action = the single command Masthead requires from the agent at the current assignment state.

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
sessions for current enrichment and V4 guided-authoring eligibility, releases
matching claims, and preserves V1 runs and receipts as audit history. Never run
production invalidation before the fixture gate, temporary-copy rehearsal, and
separately authorized human-reviewed V4 canary pass.

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
npm run dogfood:durable-artifacts
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

`npm run dogfood:durable-artifacts` and the V3 acceptance worksheet are preserved audit evidence.
Current V4 release acceptance must prove guided evidence traversal, grounded dossier deltas,
opportunity dispositions, the staged operator-approved canary, instance identity, atomic publication,
and Logbook/MCP retrieval on an isolated corpus without touching production data.

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
