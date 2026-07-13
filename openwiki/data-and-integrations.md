# Data and integrations

This page covers the canonical local store, the daemon HTTP surface, the MCP boundary, published artifacts, and derived enrichment data.

## Canonical data path

Masthead uses one runtime data directory per writable daemon. The canonical store is `masthead.sqlite` inside that directory. `docs/architecture/data-paths.md` is the clearest summary of the runtime ownership rules.

The main idea is simple:

- source files and harness histories remain owned by the original tool,
- Masthead imports and normalizes the useful parts,
- the SQLite store becomes the source of truth for Masthead-owned data,
- read-only consumers read from that canonical store.

Live connector events are part of that flow: `src/daemon/server.ts` routes ingest by runtime, and `src/core/liveIdentity.ts` scopes canonical live sessions by host plus runtime so multiple harnesses can share a source session ID without colliding.

**Published knowledge** lives in artifact tables (`session_artifacts` + provenance), not as “Logbook session rows.” Schema migration `018_artifact_first_logbook` introduces that model. Dogfood may wipe published artifact state and rebuild via Workbench; see `docs/reference/artifact-first-logbook-cutover.md`.

## Daemon API

The local HTTP daemon is the main integration surface for the app, smoke tests, doctor, and worktree bridge. `src/daemon/server.ts` implements the API; `docs/reference/daemon-api.md` lists the endpoints.

Important contracts:

- `GET /health` is the compatibility oracle (includes schema version; artifact-first expects schema **18+**).
- `GET /projection` serves the live Now projection.
- **`GET /logbook/artifacts`** searches published artifact capsules (`q`, `kind`, `project`, `dateFrom`, `dateTo`, `limit`, `offset`). This is the Logbook primary read path.
- **`GET /logbook/artifacts/:artifactId`** returns one artifact body, provenance session ids, join rationale, and evidence refs.
- **`GET /logbook/search`** is an artifact-only compatibility alias. It returns `artifacts`, never session rows.
- `GET /sessions` and session detail routes remain for evidence, Workbench, and compile — not the primary Logbook listing.
- `GET /workbench/sessions` (and related Workbench reads) expose package-path pipeline state.
- `GET /workbench/authoring/candidates` exposes keyset-paginated positive-evidence candidates and advances one bounded discovery page.
- `POST /workbench/dossiers/publish` publishes 1–100 daemon-built canonical dossier snapshots without accepting prose.
- `POST /workbench/authoring/runs` opens one candidate-owned V2 run from `{ actorId, databaseId, candidateId }`; arbitrary session arrays are rejected.
- `GET /sources/connectors` and hook routes support Sources V2 live connect.
- Write endpoints (`/ingest`, Workbench mutations, `/data/delete`, etc.) stay local to the daemon and are not exposed through MCP.

`POST /ingest` uses the runtime query parameter or `x-masthead-runtime` header. Connector tests use a validation-only ingest variant so installer/test flows can verify the hook path without mutating the store when appropriate.

Workbench enrichment and optional-artifact authoring go through Workbench/CLI paths with receipts. Normal `mastheadctl workbench` authoring commands are thin daemon HTTP calls. The candidate supplies the exact 1–12 provenance sessions, and submit accepts one `workbench-authoring-v2` optional artifact with typed, verbatim claim support. There is **no Logbook bulk-enrich UI or primary bulk-enrich product path**.

The original dossier is different: the daemon snapshots `SessionDossierDto` as
`canonical-session-dossier-v1`, and Logbook renders that immutable body through
the original dossier presentation. An authoring agent has no dossier-body write
path. Optional artifacts (`runbook`, `adr`, `incident_timeline`) exist only for
positive-evidence candidates; no candidate means no optional work and no N/A prose.

## MCP

`src/mcp/server.ts` starts a stdio MCP server and requires `MASTHEAD_DB_PATH`.

The MCP layer is intentionally read-only:

- it opens the active Masthead database,
- exposes retrieval tools over the same canonical data,
- writes audit rows for access,
- does not mutate Masthead state, source state, Git, or shell state.

**Artifact-primary tools** (prefer for reuse):

- `search_artifacts`
- `get_artifact`

Session/transcript tools remain for compile-time evidence. Full list: `docs/reference/mcp-tools.md`.

## Enrichment

`src/enrichment/enrichmentCoordinator.ts` turns session facts into durable derived records (capsules, live summaries, search projections). The pipeline is evidence-sensitive: it fingerprints facts and avoids rewriting a current result when the fingerprint and provider match.

Published knowledge reaches Logbook on two explicit paths: the daemon publishes
canonical dossier snapshots, while a candidate-sized V2 run validates and
atomically publishes one supported runbook, ADR, or incident timeline. Enrichment
alone does not put a row in Logbook.

## Failed V1 recovery

Recovery is intentionally CLI-only and offline; there are no recovery HTTP or MCP
routes. `audit-v1-generation --db <path> --json` is read-only and recognizes only
the exact failed population. `prepare-v1-recovery --db <path> --json` acquires
exclusive writer ownership and retains one verified SQLite-consistent backup.
`invalidate-v1-generation --db <path> --audit-hash <sha256> --confirm --json`
re-audits and removes only the hash-matched artifact/search/provenance rows in one
transaction, resets affected sessions for canonical dossier publication and V2
candidate discovery, releases matching claims, and preserves V1 runs and receipts.
Production recovery requires separate authorization after the fixture release gate
and temporary-copy rehearsal.

## Identity and privacy notes

- `src/core/sessionReducer.ts`, `src/core/liveProjection.ts`, and related core files define the pure session model and live board behavior.
- `src/core/redaction.ts` and the enrichment/MCP code are where evidence should be bounded and privacy-aware.
- The docs explicitly avoid `.env` values and secrets; configuration references should stay at the variable/behavior level only.

## What to watch out for

- Keep the writable daemon and read-only MCP roles separate in docs and code changes.
- Don’t treat enrichment as raw storage; it is derived data that depends on canonical facts.
- Don’t document any Logbook route as session search; the primary path is `/logbook/artifacts`, and the compatibility alias is artifact-only.
- Keep the data-path docs consistent with `MASTHEAD_DATA_DIR` and `MASTHEAD_DB_PATH`.
- If you change what is persisted, check data lifecycle and retention before assuming long-lived storage.
