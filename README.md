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

## Stable Today

- Canonical local SQLite ownership for Masthead-owned sessions, published
  artifacts + provenance, source/connector state, import jobs, settings, and MCP
  audit rows (schema 23; full-body artifact search arrived in schema 21).
- Multi-adapter / multi-harness live connect (Sources V2) and conservative
  history adapters where coverage exists.
- Workbench package path: transcript checks/import, quality, claims, Activity,
  positive-evidence artifact candidates, candidate-sized agent handoffs,
  daemon-owned canonical dossier publication, V2 authoring runs, and atomic publication.
- Logbook artifact book: `GET /logbook/artifacts` + body/provenance inspector;
  full-body search plus kind · project · date filters; no bulk enrich /
  checkboxes / summary strip.
- Read-only MCP with **`search_artifacts` / `get_artifact`** preferred for reuse;
  session/transcript tools for evidence and compile.
- `npm run dev` launcher (writable daemon or read-only worktree bridge).
- Electron Dev desktop launcher (`npm run install:electron-dev-launcher` from the
  checkout you intend to run — path is hardwired into the desktop entry).
- Product, surface, endpoint-matrix, doctor, smoke, build, and test gates.

## Experimental

- Deeper schema coverage for additional source adapters beyond the initial
  bounded scanners.
- Transcript import breadth and exclusion policy tuning.
- Legacy/dev native remote enrichment hooks. Optional-artifact authoring uses
  user-facing Workbench candidate handoffs plus a thin installed CLI to the
  daemon-owned V2 authoring module; no native remote model key is required.
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

## Artifact Authoring

There is one session dossier contract. The daemon builds the original
`SessionDossierDto`, stores an immutable `canonical-session-dossier-v1` snapshot,
and Logbook renders it with the original dossier presentation. Agents never write
dossier prose. Workbench’s **Publish canonical dossiers** action calls
`POST /workbench/dossiers/publish` separately from optional-artifact authoring.

Runbooks, ADRs, and incident timelines start only from positive canonical
evidence. Workbench shows the candidate kind, status, summary, and provenance
count, then copies a plain-language handoff for one selected candidate. One
`workbench-authoring-v2` run owns exactly one candidate and at most 12 provenance
sessions. Every substantive claim supplies a typed `claimSupport` entry whose
at-least-20-character excerpt must occur verbatim in canonical evidence.
Unsupported authoring-process language, weak joins, and duplicate substantive
content are rejected before publication.

The normal installed CLI is a thin daemon HTTP adapter:

```bash
mastheadctl workbench capabilities --json
mastheadctl workbench candidates --status pending --limit 100 --json
mastheadctl workbench open --database-id <id> --candidate <candidate-id> --json
mastheadctl workbench evidence --run <run-id> --session <session-id> --limit 100 --json
mastheadctl workbench submit --run <run-id> --file <bundle.json> --json
mastheadctl workbench finish --run <run-id> --json
```

`submit` stores validation findings without output rows. `finish` atomically
publishes the optional artifact and canonical dossiers for its provenance,
updates search and pipeline state, releases claims, and persists one retry-safe
receipt. See [ADR 0013](docs/adr/0013-canonical-dossier-and-candidate-authoring.md),
[ADR 0012](docs/adr/0012-daemon-owned-artifact-authoring.md), and the
[daemon API reference](docs/reference/daemon-api.md).

### Failed V1 generation recovery

These maintenance commands are the deliberate exception to the normal HTTP-only
CLI boundary. They require an explicit database path and exclusive writer
ownership. Audit and prepare do not mutate product rows; invalidate additionally
requires the exact SHA-256 audit hash and `--confirm`:

```bash
mastheadctl workbench audit-v1-generation --db <path> --json
mastheadctl workbench prepare-v1-recovery --db <path> --json
mastheadctl workbench invalidate-v1-generation --db <path> --audit-hash <sha256> --confirm --json
```

The audit fails closed unless the exact known population is present: 1,283 V1
dossiers, zero optional artifacts, and 66 completed V1 runs. Prepare acquires the
daemon-equivalent writer locks, creates a SQLite-consistent backup, verifies its
database identity and integrity, and retains exactly one backup. Invalidate removes
only the hash-matched artifacts, search rows, and provenance, resets affected
sessions for canonical dossier publication and V2 candidate discovery, releases
matching claims, and preserves V1 runs and receipts as audit history. Never run
production invalidation before the fixture gate, temporary-copy rehearsal, and
separately authorized 25-session human-reviewed canary pass.

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

`npm run dogfood:durable-artifacts` is a fixture-only machine gate. It requires
perfect dossier fidelity, claim support, labeled candidate precision/recall,
Logbook/MCP recall@5, and artifact-only reuse; zero leaks, duplicate substantive
fingerprints, or kind errors; at most 12 provenance sessions; and a 100-session
discovery page within two seconds. It cannot satisfy the production human gate,
which requires every canary artifact reviewed, median usefulness at least 4/5,
and no artifact below 3/5.

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
