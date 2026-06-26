# Masthead Launch-Ready Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Masthead launch-ready as a local-first, harness-neutral session data product by hardening its public contracts, canonical SQLite ownership, Codex source loop, read-only MCP boundary, repository health, and release gates.

**Architecture:** Treat the daemon API and SQLite session graph as the product core. The UI, Tauri bridge, `doctor`, smoke tests, docs, and MCP server must all consume the same contract and prove the same Codex-first loop: discover source, import sessions, search Logbook, retrieve through MCP, audit retrieval, and verify data ownership.

**Tech Stack:** Tauri 2, React 19, TypeScript 5.9, Node 24.15+, `node:sqlite`, SQLite WAL/FTS5, Vitest, Rust/Cargo for Tauri commands, GitHub Actions.

---

## Optimized Scope

This plan rewrites the pasted launch-ready draft into implementation packs. The original draft contains good launch principles but mixes architecture rationale, documentation goals, security posture, and product acceptance in one narrative. The optimized plan makes every workstream independently verifiable and keeps Masthead's current product identity intact:

1. Canonical session database.
2. Logbook and search.
3. Read-only MCP access.
4. Live Now view.
5. Source/import administration.

Launch-ready does not mean all future adapters or all security automation exist. It means Masthead can credibly ship the first Codex vertical slice with one canonical data path, clear contracts, accurate docs, and gates that prevent regressions.

## Current Baseline

Already present:

- Shared daemon protocol types in `src/shared/protocol.ts`.
- Health payload construction in `src/daemon/healthService.ts`.
- App client DTOs in `src/app/daemonClient.ts`.
- Canonical SQLite migrations and FTS-backed search under `src/daemon/db/`.
- Codex source discovery/import code under `src/adapters/codex/` and `src/daemon/import/`.
- MCP server, policy, retrieval tools, and smoke coverage under `src/mcp/` and `scripts/masthead-mcp-smoke.js`.
- Doctor and smoke scripts in `scripts/masthead-doctor.js`, `scripts/masthead-live-smoke.js`, `scripts/masthead-import-smoke.js`, `scripts/masthead-compatibility-smoke.js`, and `scripts/masthead-endpoint-matrix-smoke.js`.
- Product/release checks in `scripts/masthead-product-contract.js`, `scripts/masthead-surface-contract.js`, `npm run verify`, and `docs/acceptance/product-release-gate.md`.
- CI in `.github/workflows/ci.yml`.

Known launch gaps:

- Contract definitions are split between `src/shared/protocol.ts` and app-local DTOs in `src/app/daemonClient.ts`.
- Legacy SQLite migration currently copies the file before opening; it does not yet prove hot-backup semantics or capture a migration identity report.
- `doctor` proves important endpoints, but it is not yet the single release-grade diagnostic spine described by the launch draft.
- Root repository health files are mostly missing: license, contribution/support/security posture, code of conduct, templates, CODEOWNERS, and changelog.
- CI runs the main verification path, but security/release-hardening workflows and action pinning policy are not yet explicit.

## Success Contract

The launch core is complete when all of these pass from the repository alone:

- A new developer can answer what Masthead is, what is stable, how data moves through it, how to test it, and how to report/contribute within ten minutes.
- `/health` is the compatibility oracle for product version, daemon API version, schema version, runtime mode, writable/read-only state, database identity, capabilities, and migration state.
- SQLite is the only canonical runtime store for Masthead-owned product data; legacy NDJSON is migration/compatibility input only.
- A Codex source can be discovered, imported, searched in Logbook, retrieved through MCP, and audited without private credentials.
- Settings, Sources, Logbook, Agent Access, `doctor`, smoke tests, and docs all reflect the same daemon-owned state.
- `npm run verify`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run doctor`, and the final GitHub Actions run pass.
- `docs/acceptance/product-release-gate.md` has evidence for every checked item.

## File Map

Contract and versioning:

- Modify: `src/shared/protocol.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/daemon/healthService.ts`
- Modify: `src/core/daemonCompatibility.ts` if protocol classification needs to move out of `src/shared/protocol.ts`
- Test: `src/core/__tests__/daemonCompatibility.test.ts`
- Test: `src/daemon/__tests__/healthApi.test.ts`

Data ownership and SQLite maintenance:

- Modify: `src/daemon/db/sqlite.ts`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/legacyDataMigration.ts`
- Modify: `src/daemon/legacyJournalMigration.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/db/__tests__/sqliteRuntime.test.ts`
- Test: `src/daemon/__tests__/legacyDataMigration.test.ts`
- Test: `src/daemon/__tests__/canonicalOwnership.test.ts`

Sources and import loop:

- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/codex/discovery.ts`
- Modify: `src/adapters/codex/metadataImport.ts`
- Modify: `src/adapters/codex/transcriptParser.ts`
- Modify: `src/daemon/import/sourceStatusService.ts`
- Modify: `src/daemon/import/importCoordinator.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/adapters/codex/__tests__/discovery.test.ts`
- Test: `src/adapters/codex/__tests__/metadataImport.test.ts`
- Test: `src/adapters/codex/__tests__/transcriptParser.test.ts`
- Test: `src/daemon/import/__tests__/importCoordinator.test.ts`
- Test: `src/daemon/db/__tests__/sourceStatusService.test.ts`

Session compilation, Logbook, deletion:

- Modify: `src/daemon/db/sessionRepository.ts`
- Modify: `src/daemon/db/searchRepository.ts`
- Modify: `src/daemon/db/sessionQueryRepository.ts`
- Modify: `src/daemon/db/dataLifecycleRepository.ts`
- Modify: `src/enrichment/sessionCompiler.ts`
- Modify: `src/enrichment/enrichmentCoordinator.ts`
- Test: `src/enrichment/__tests__/sessionCompiler.test.ts`
- Test: `src/daemon/db/__tests__/sessionQueryRepository.test.ts`
- Test: `src/daemon/db/__tests__/searchFilters.test.ts`
- Test: `src/daemon/db/__tests__/scopedRawDeletion.test.ts`

MCP and Agent Access:

- Modify: `src/mcp/protocol.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/sessionRetrieval.ts`
- Modify: `src/mcp/policy.ts`
- Modify: `src/daemon/mcpStatusService.ts`
- Modify: `src/ui/AgentAccessPanel.tsx`
- Test: `src/mcp/__tests__/protocol.test.ts`
- Test: `src/mcp/__tests__/tools.test.ts`
- Test: `src/mcp/__tests__/retrieval.test.ts`
- Test: `src/mcp/__tests__/policy.test.ts`

Settings and runtime identity:

- Modify: `src/daemon/settingsService.ts`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/app/surfaces/SettingsSurface.tsx`
- Modify: `src/ui/settings/HookSettings.tsx`
- Modify: `src/ui/settings/EnrichmentSettings.tsx`
- Modify: `src/ui/settings/PrivacySettings.tsx`
- Modify: `src/ui/settings/StorageSettings.tsx`
- Modify: `src/ui/settings/DangerZone.tsx`
- Modify: `src-tauri/src/system_actions.rs`
- Modify: `src-tauri/src/connector.rs`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Test: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Test: `src/daemon/__tests__/settingsService.test.ts`
- Test: `src-tauri` Cargo tests

Doctor, smoke, release gates:

- Modify: `scripts/masthead-doctor.js`
- Modify: `scripts/masthead-live-smoke.js`
- Modify: `scripts/masthead-import-smoke.js`
- Modify: `scripts/masthead-mcp-smoke.js`
- Modify: `scripts/masthead-endpoint-matrix-smoke.js`
- Modify: `docs/acceptance/product-release-gate.md`
- Modify: `package.json`

Docs and repository health:

- Modify: `README.md`
- Modify: `prd.md`
- Modify: `docs/release-gates.md`
- Modify: `docs/architecture/data-paths.md`
- Create: `docs/tutorials/first-run-codex-import.md`
- Create: `docs/how-to/import-codex-history.md`
- Create: `docs/how-to/reset-local-data.md`
- Create: `docs/reference/daemon-api.md`
- Create: `docs/reference/mcp-tools.md`
- Create: `docs/reference/configuration.md`
- Create: `docs/explanation/session-graph.md`
- Create: `docs/adr/0001-sqlite-canonical-store.md`
- Create: `docs/adr/0002-read-only-local-mcp-first.md`
- Create: `docs/adr/0003-health-contract-compatibility-oracle.md`
- Create: `docs/adr/0004-source-adapters-before-canonical-session-graph.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `CODEOWNERS`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`

CI and security:

- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/security.yml`
- Create: `.github/workflows/release-smoke.yml`

## Task 1: Freeze the Daemon Contract Boundary

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/daemon/healthService.ts`
- Test: `src/core/__tests__/daemonCompatibility.test.ts`
- Test: `src/daemon/__tests__/healthApi.test.ts`
- Docs: `docs/reference/daemon-api.md`

- [ ] **Step 1: Write contract tests for the complete health payload**

  Add or extend tests that assert `/health` includes these fields with stable names:

  ```text
  ok
  product
  apiVersion
  schemaVersion
  buildVersion
  buildSha
  capabilities[]
  runtime.daemonInstanceId
  runtime.startedAt
  runtime.mode
  runtime.writable
  runtime.host
  runtime.port
  runtime.upstream
  data.dataDirectory
  data.databasePath
  data.databaseId
  data.migrationState
  data.sessions
  data.sources
  live.events
  live.diagnostics
  live.gitSnapshots
  ```

  Run:

  ```bash
  npm test -- --run src/core/__tests__/daemonCompatibility.test.ts src/daemon/__tests__/healthApi.test.ts
  ```

  Expected before implementation: at least one assertion fails for any missing launch-contract field or duplicated DTO shape.

- [ ] **Step 2: Consolidate API DTOs into the shared contract layer**

  Move duplicated DTOs from `src/app/daemonClient.ts` into `src/shared/protocol.ts` or a sibling `src/shared/api.ts` only when they are part of the public daemon boundary. Keep purely UI-only view models in app/UI files.

  Required exported contract names:

  ```text
  MastheadHealthDto
  MastheadApiClient
  MastheadConnectionState
  SourcePreflightDto
  AdapterStatusDto
  McpStatusDto
  ```

  Do not rename existing public terms casually; this repo already uses those names as protocol/database identity anchors.

- [ ] **Step 3: Make `/health` the single compatibility oracle**

  Ensure `classifyDaemonHealth()` rejects:

  ```text
  missing product/apiVersion
  wrong product
  unsupported apiVersion
  missing required capabilities
  missing runtime identity
  missing data identity
  failed migration state
  malformed non-object payloads
  ```

  Ensure it accepts current primary and read-only bridge modes.

- [ ] **Step 4: Document the daemon API reference**

  Create `docs/reference/daemon-api.md` with:

  ```markdown
  # Daemon API Reference

  ## Compatibility
  `/health` is the compatibility oracle. Clients must classify the daemon from this response before calling product endpoints.

  ## Version Fields
  - `buildVersion`: application version from `package.json`.
  - `apiVersion`: Masthead daemon API major version.
  - `schemaVersion`: canonical database schema version.
  - `buildSha`: build provenance when available.

  ## Data Identity
  - `dataDirectory`: resolved Masthead data root.
  - `databasePath`: active SQLite path.
  - `databaseId`: stable app-level database identity stored in SQLite.
  - `migrationState`: `ready`, `migrating`, or `failed`.

  ## Capabilities
  Current capabilities:
  - `live_projection`
  - `canonical_sessions`
  - `logbook_search`
  - `source_discovery`
  - `adapter_inventory`
  - `import_jobs`
  - `mcp_status`
  - `settings`
  - `data_lifecycle`
  ```

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  npm run typecheck
  npm test -- --run src/core/__tests__/daemonCompatibility.test.ts src/daemon/__tests__/healthApi.test.ts
  npm run check:endpoint-matrix
  ```

  Expected: all commands pass.

  Commit:

  ```bash
  git add src/shared src/app src/daemon docs/reference/daemon-api.md
  git commit -m "feat: freeze daemon contract boundary"
  ```

## Task 2: Harden Canonical SQLite Ownership and Migration

**Files:**
- Modify: `src/daemon/db/sqlite.ts`
- Modify: `src/daemon/db/schema.ts`
- Modify: `src/daemon/legacyDataMigration.ts`
- Modify: `src/daemon/legacyJournalMigration.ts`
- Modify: `src/daemon/server.ts`
- Modify: `docs/architecture/data-paths.md`
- Test: `src/daemon/db/__tests__/sqliteRuntime.test.ts`
- Test: `src/daemon/__tests__/legacyDataMigration.test.ts`
- Test: `src/daemon/__tests__/canonicalOwnership.test.ts`

- [ ] **Step 1: Write tests for the launch storage invariants**

  Cover these cases:

  ```text
  openMastheadDatabase enables WAL, foreign_keys, busy_timeout, and FTS5.
  database identity survives close/reopen.
  legacy NDJSON migration imports only missing raw records.
  legacy NDJSON is not used for new product writes.
  legacy SQLite migration refuses same-path and target-exists cases.
  canonical ownership rejects a second writable daemon for the same data directory.
  ```

  Run:

  ```bash
  npm test -- --run src/daemon/db/__tests__/sqliteRuntime.test.ts src/daemon/__tests__/legacyDataMigration.test.ts src/daemon/__tests__/canonicalOwnership.test.ts
  ```

  Expected before implementation: tests fail only where the invariant is not yet implemented.

- [ ] **Step 2: Make SQLite maintenance explicit**

  Add exported helpers in `src/daemon/db/sqlite.ts`:

  ```text
  openMastheadDatabase(path)
  checkpointMastheadDatabase(db, mode)
  optimizeMastheadDatabase(db)
  quickCheckMastheadDatabase(db)
  ```

  Required behavior:

  ```text
  checkpoint uses PRAGMA wal_checkpoint(PASSIVE) by default.
  optimize uses PRAGMA optimize.
  quickCheck uses PRAGMA quick_check and throws unless result is ok.
  helpers do not close the caller-owned database.
  ```

- [ ] **Step 3: Upgrade legacy migration reporting**

  Extend migration result records so `legacy_migrations.details_json` captures:

  ```text
  migration key
  source paths considered
  copied/imported/skipped counts
  target database ID
  completed timestamp
  reason
  ```

  Keep legacy NDJSON as migration/compatibility input only.

- [ ] **Step 4: Run maintenance at safe lifecycle points**

  In daemon startup and shutdown paths, run:

  ```text
  quickCheck after migrations
  optimize after startup migration/import indexing
  passive WAL checkpoint on clean daemon close
  ```

  Do not run destructive repair or broad vacuum automatically.

- [ ] **Step 5: Update data-path docs**

  `docs/architecture/data-paths.md` must state:

  ```text
  MASTHEAD_DATA_DIR owns the active runtime.
  masthead.sqlite is canonical.
  legacy/events.ndjson is compatibility/migration input only.
  runtime/database.lock enforces one writable owner.
  backup/export must use Masthead's export path rather than copying open SQLite files.
  ```

- [ ] **Step 6: Verify and commit**

  Run:

  ```bash
  npm test -- --run src/daemon/db/__tests__/sqliteRuntime.test.ts src/daemon/__tests__/legacyDataMigration.test.ts src/daemon/__tests__/canonicalOwnership.test.ts
  npm run smoke:compatibility
  npm run smoke:import
  ```

  Expected: all commands pass.

  Commit:

  ```bash
  git add src/daemon docs/architecture/data-paths.md
  git commit -m "feat: harden canonical sqlite ownership"
  ```

## Task 3: Make Source Adapters and Import Jobs Deterministic

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/codex/discovery.ts`
- Modify: `src/adapters/codex/metadataImport.ts`
- Modify: `src/adapters/codex/transcriptParser.ts`
- Modify: `src/daemon/import/sourceStatusService.ts`
- Modify: `src/daemon/import/importCoordinator.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/adapters/codex/__tests__/discovery.test.ts`
- Test: `src/adapters/codex/__tests__/metadataImport.test.ts`
- Test: `src/adapters/codex/__tests__/transcriptParser.test.ts`
- Test: `src/daemon/import/__tests__/importCoordinator.test.ts`
- Test: `src/daemon/import/__tests__/progressiveImport.test.ts`
- Test: `src/daemon/db/__tests__/sourceStatusService.test.ts`

- [ ] **Step 1: Write tests for adapter state transitions**

  Cover Codex adapter states:

  ```text
  planned
  not_detected
  detected
  importable
  syncing
  degraded
  disabled
  connected
  ```

  Ensure diagnostics include `code`, `message`, `severity`, `observedAt`, and path/source context when available.

- [ ] **Step 2: Define the launch adapter registry contract**

  In `src/adapters/types.ts`, make the adapter status shape explicit enough for Sources, `doctor`, and API docs:

  ```text
  runtime
  name
  description
  state
  implementationState
  discoveredSessions
  importedSessions
  sourceLocations[]
  policies
  diagnostics[]
  ```

  Do not add broad future-adapter behavior. The launch-quality path is Codex-first.

- [ ] **Step 3: Make import jobs resume and cancel predictably**

  Required behavior:

  ```text
  queued jobs expose progress before work begins.
  running jobs update processed/current/total counts.
  cancellation transitions through cancelling to cancelled.
  repeated metadata import deduplicates already imported sessions.
  transcript import remains opt-in through source policy.
  failed import jobs record failureMessage and diagnostics.
  ```

- [ ] **Step 4: Update endpoint and smoke expectations**

  Update `scripts/masthead-import-smoke.js` and endpoint matrix expectations so the smoke path proves:

  ```text
  source discovery
  metadata import
  transcript approval
  transcript import
  deduped rerun
  import job status
  source diagnostics
  ```

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  npm test -- --run src/adapters/codex src/daemon/import src/daemon/db/__tests__/sourceStatusService.test.ts
  npm run smoke:import
  npm run check:endpoint-matrix
  ```

  Expected: all commands pass.

  Commit:

  ```bash
  git add src/adapters src/daemon/import src/daemon/server.ts scripts/masthead-import-smoke.js scripts/masthead-endpoint-matrix-smoke.js
  git commit -m "feat: make codex imports deterministic"
  ```

## Task 4: Complete the Session Compilation and Logbook Retrieval Contract

**Files:**
- Modify: `src/daemon/db/sessionRepository.ts`
- Modify: `src/daemon/db/searchRepository.ts`
- Modify: `src/daemon/db/sessionQueryRepository.ts`
- Modify: `src/daemon/db/dataLifecycleRepository.ts`
- Modify: `src/enrichment/sessionCompiler.ts`
- Modify: `src/enrichment/enrichmentCoordinator.ts`
- Modify: `src/ui/HistoryPanel.tsx`
- Test: `src/enrichment/__tests__/sessionCompiler.test.ts`
- Test: `src/enrichment/__tests__/enrichmentCoordinator.test.ts`
- Test: `src/daemon/db/__tests__/sessionQueryRepository.test.ts`
- Test: `src/daemon/db/__tests__/searchFilters.test.ts`
- Test: `src/daemon/db/__tests__/scopedRawDeletion.test.ts`

- [ ] **Step 1: Write tests for evidence-to-library compilation**

  Cover:

  ```text
  raw event remains source evidence.
  normalized session row preserves host/runtime/source session ID.
  message/tool records preserve bounded source references.
  search document includes title, objective, project, topics, tools, files, and snippet text.
  Logbook detail returns provenance and source confidence.
  blank search returns recent sessions without FTS MATCH '*'.
  pagination remains stable across repeated queries.
  ```

- [ ] **Step 2: Standardize source references**

  Ensure Logbook and MCP retrieval payloads carry source references with enough data for audit:

  ```text
  sourceId
  sourceKind
  sourcePath or sourceSessionId
  byteStart when known
  byteEnd when known
  recordId or eventId when known
  confidence
  ```

  Keep bounds optional where the source cannot supply byte positions.

- [ ] **Step 3: Make deletion complete and auditable**

  The data deletion path must remove or reset:

  ```text
  sessions
  session_sources
  turns
  messages
  raw_events
  session_search
  enrichments
  import jobs
  cursors
  MCP audit rows when selected by scope
  derived live projections
  review dispositions when selected by scope
  ```

  It must not touch Codex files, Git repos, project files, source harness data, or external services.

- [ ] **Step 4: Make Logbook load states explicit**

  Preserve the existing Masthead pattern around `LogbookLoadState`: canonical request failures must show visible error or degraded state, not silently fall back to local history.

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  npm test -- --run src/enrichment src/daemon/db/__tests__/sessionQueryRepository.test.ts src/daemon/db/__tests__/searchFilters.test.ts src/daemon/db/__tests__/scopedRawDeletion.test.ts
  npm run smoke:import
  npm run smoke:mcp
  ```

  Expected: all commands pass.

  Commit:

  ```bash
  git add src/enrichment src/daemon/db src/ui/HistoryPanel.tsx
  git commit -m "feat: complete session library contract"
  ```

## Task 5: Harden Read-Only MCP and Agent Access

**Files:**
- Modify: `src/mcp/protocol.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/sessionRetrieval.ts`
- Modify: `src/mcp/policy.ts`
- Modify: `src/daemon/mcpStatusService.ts`
- Modify: `src/ui/AgentAccessPanel.tsx`
- Modify: `scripts/masthead-mcp-smoke.js`
- Test: `src/mcp/__tests__/protocol.test.ts`
- Test: `src/mcp/__tests__/tools.test.ts`
- Test: `src/mcp/__tests__/retrieval.test.ts`
- Test: `src/mcp/__tests__/policy.test.ts`

- [ ] **Step 1: Write MCP launch-contract tests**

  Cover:

  ```text
  initialize returns masthead server identity.
  tools/list returns only read-only tools.
  tools/call rejects unknown tools.
  tool schemas reject additional properties.
  search/get/excerpt/list/history responses include source refs.
  bounded maxBytes is enforced.
  every successful call writes an audit row.
  no tool name contains write/delete/clear/import/install/uninstall/approve/run/execute.
  ```

- [ ] **Step 2: Keep launch scope read-only**

  Confirm the only launch tools are:

  ```text
  get_masthead_coverage
  get_project_history
  get_session
  get_session_excerpt
  list_project_sessions
  search_sessions
  ```

  If a future write-capable tool exists locally, move it behind non-launch experimental code and keep it out of `tools/list`.

- [ ] **Step 3: Make Agent Access status come from the daemon**

  `AgentAccessPanel` must render:

  ```text
  MCP ready state
  active database path
  read-only mode
  tool count
  query count
  last query time
  global access flag
  exclusions
  source policies
  audit rows
  ```

  It must not copy or display a launch config when the daemon says the config is invalid.

- [ ] **Step 4: Expand MCP smoke**

  `scripts/masthead-mcp-smoke.js` must prove:

  ```text
  initialize
  tools/list
  search_sessions
  get_session
  get_session_excerpt
  list_project_sessions
  get_project_history
  get_masthead_coverage
  audit row count increased
  response bounds held
  ```

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  npm test -- --run src/mcp
  npm run smoke:mcp
  npm run doctor
  ```

  Expected: all commands pass when a compatible daemon is running for `doctor`.

  Commit:

  ```bash
  git add src/mcp src/daemon/mcpStatusService.ts src/ui/AgentAccessPanel.tsx scripts/masthead-mcp-smoke.js
  git commit -m "feat: harden read-only mcp launch path"
  ```

## Task 6: Make Settings Reflect Real Runtime State

**Files:**
- Modify: `src/daemon/settingsService.ts`
- Modify: `src/ui/OperationsPanel.tsx`
- Modify: `src/app/surfaces/SettingsSurface.tsx`
- Modify: `src/ui/settings/HookSettings.tsx`
- Modify: `src/ui/settings/EnrichmentSettings.tsx`
- Modify: `src/ui/settings/PrivacySettings.tsx`
- Modify: `src/ui/settings/StorageSettings.tsx`
- Modify: `src/ui/settings/DangerZone.tsx`
- Modify: `src-tauri/src/system_actions.rs`
- Modify: `src-tauri/src/connector.rs`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`
- Test: `src/ui/settings/__tests__/SettingsOperationalStates.test.tsx`
- Test: `src/daemon/__tests__/settingsService.test.ts`
- Test: `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1: Confirm the current Settings wiring**

  Run:

  ```bash
  rg -n "SettingsSurface|OperationsPanel|HookSettings|StorageSettings|DangerZone" src/ui src/app
  ```

  Expected: Settings is routed through `src/app/surfaces/SettingsSurface.tsx`, `src/ui/OperationsPanel.tsx`, and the components under `src/ui/settings/`. Do not create a parallel settings surface.

- [ ] **Step 2: Write tests for runtime settings state**

  Cover that the settings endpoint returns:

  ```text
  resolved data directory
  database path
  database ID
  protocol/API version
  schema version
  hook install state
  adapter/source state summary
  retention policy summary
  privacy/enrichment toggles
  deletion preview identity
  ```

- [ ] **Step 3: Wire Settings UI to daemon state**

  The Settings surface must show actual daemon values for:

  ```text
  data directory
  database path
  database ID
  runtime mode
  daemon API version
  schema version
  Codex hook status
  source adapter status
  local-first/privacy state
  delete/export/danger-zone identity
  ```

  No placeholder values, fabricated config snippets, or UI-local guesses.

- [ ] **Step 4: Verify Tauri folder/open actions**

  Ensure Tauri actions that open folders or expose paths are narrow and scoped. Settings may open Masthead-owned paths, but it must not mutate source harness data or project repos.

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  npm run typecheck
  npm test -- --run src/daemon/__tests__/settingsService.test.ts src/ui/settings
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: all commands pass.

  Commit:

  ```bash
  git add src/daemon/settingsService.ts src/ui/OperationsPanel.tsx src/app/surfaces/SettingsSurface.tsx src/ui/settings src-tauri/src
  git commit -m "feat: make settings runtime-backed"
  ```

## Task 7: Make `doctor` the Release Diagnostic Spine

**Files:**
- Modify: `scripts/masthead-doctor.js`
- Modify: `package.json`
- Modify: `docs/release-gates.md`
- Modify: `docs/acceptance/product-release-gate.md`

- [ ] **Step 1: Define doctor output as a stable contract**

  `npm run doctor:json` must return:

  ```text
  ok
  checkedAt
  baseUrl
  checks[].id
  checks[].label
  checks[].status
  checks[].message
  checks[].details
  ```

  Status values:

  ```text
  ok
  warn
  fail
  ```

- [ ] **Step 2: Add checks for the full promised product loop**

  Doctor should validate:

  ```text
  Node runtime
  daemon build
  SQLite WAL and FTS5
  protocol identity and required capabilities
  database identity and migration state
  product endpoint availability
  source discovery and Codex adapter status
  import endpoint availability
  Logbook summary/search availability
  MCP status/tools/catalog
  MCP initialize/tools/list/tools/call when practical
  Settings endpoint readability
  hook config status
  destructive operation preview safety
  ```

  Keep checks read-only by default. Use an explicit environment variable for any check that sends a hook test event or mutates fixture-only data.

- [ ] **Step 3: Make release-gate docs point to doctor**

  Update docs so the release closeout flow is:

  ```bash
  npm run verify
  cargo test --manifest-path src-tauri/Cargo.toml
  npm run doctor
  npm run dogfood:fixture
  npm run dogfood:live
  ```

  `dogfood:live` may require local real Codex data and should be documented as a human acceptance step, not a CI blocker.

- [ ] **Step 4: Verify and commit**

  Run:

  ```bash
  npm run doctor:json
  npm run verify
  ```

  Expected: `doctor:json` returns valid JSON; `npm run verify` passes.

  Commit:

  ```bash
  git add scripts/masthead-doctor.js package.json docs/release-gates.md docs/acceptance/product-release-gate.md
  git commit -m "feat: promote doctor to release diagnostic"
  ```

## Task 8: Reorganize Launch Documentation

**Files:**
- Modify: `README.md`
- Modify: `prd.md`
- Modify: `docs/release-gates.md`
- Modify: `docs/architecture/data-paths.md`
- Create: `docs/tutorials/first-run-codex-import.md`
- Create: `docs/how-to/import-codex-history.md`
- Create: `docs/how-to/reset-local-data.md`
- Create: `docs/reference/daemon-api.md`
- Create: `docs/reference/mcp-tools.md`
- Create: `docs/reference/configuration.md`
- Create: `docs/explanation/session-graph.md`

- [ ] **Step 1: Rewrite README as the launch entrypoint**

  README must answer:

  ```text
  What Masthead is.
  What is stable today.
  What is experimental.
  How to install dependencies.
  How to run the dev launcher.
  How to run verify/doctor.
  How the data path works.
  How MCP is read-only.
  Where contributors should start.
  ```

  Keep product language aligned with `prd.md`: local-first, harness-neutral session data layer and session manager.

- [ ] **Step 2: Create the docs structure**

  Use this structure:

  ```text
  docs/tutorials/first-run-codex-import.md
  docs/how-to/import-codex-history.md
  docs/how-to/reset-local-data.md
  docs/reference/daemon-api.md
  docs/reference/mcp-tools.md
  docs/reference/configuration.md
  docs/explanation/session-graph.md
  ```

  Each page must be short and executable. Avoid dumping the PRD into docs.

- [ ] **Step 3: Preserve launch scope language**

  Docs must say:

  ```text
  Codex is the first supported adapter.
  Core model remains adapter-neutral.
  MCP is read-only for launch.
  Local SQLite is canonical.
  Remote enrichment is optional and scoped.
  Live Now is a view over collected session data, not the product category.
  ```

- [ ] **Step 4: Verify docs against product contract**

  Run:

  ```bash
  npm run check:product-contract
  rg -n "observability-first|control tower|analytics dashboard|task manager" README.md prd.md design.md docs
  ```

  Expected: product contract passes; `rg` finds no forbidden product framing except explicit negative statements.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md prd.md docs
  git commit -m "docs: organize launch documentation"
  ```

## Task 9: Add Repository Health Files

**Files:**
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `CODEOWNERS`
- Create: `CHANGELOG.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Choose and add the license**

  Pick the intended license before editing. If Tyler has not chosen one, stop this task and ask. Do not silently invent a legal posture.

- [ ] **Step 2: Add contribution docs**

  `CONTRIBUTING.md` must include:

  ```text
  install: npm install
  dev: npm run dev
  verification: npm run verify
  Rust verification: cargo test --manifest-path src-tauri/Cargo.toml
  product language boundary
  local data/privacy warning for test fixtures
  branch/PR expectations
  ```

- [ ] **Step 3: Add support and security posture**

  `SECURITY.md` must state supported versions and a private reporting path. If no private reporting email exists, use a GitHub Security Advisory instruction instead of inventing an email.

  `SUPPORT.md` must say what belongs in issues, discussions, and local diagnostics.

- [ ] **Step 4: Add issue and PR templates**

  Bug report template fields:

  ```text
  Masthead version
  OS
  Node version
  install mode
  expected behavior
  actual behavior
  doctor output
  logs attached
  local data sensitivity confirmation
  ```

  PR template checklist:

  ```text
  product contract considered
  tests run
  docs updated when behavior changed
  no dev citations
  no write-capable MCP tools added
  release-gate impact noted
  ```

- [ ] **Step 5: Add changelog**

  `CHANGELOG.md` starts at current `package.json` version and groups changes under:

  ```text
  Added
  Changed
  Fixed
  Security
  ```

- [ ] **Step 6: Verify and commit**

  Run:

  ```bash
  npm run check:product-contract
  npm run verify:no-citations
  ```

  Expected: both commands pass.

  Commit:

  ```bash
  git add LICENSE CONTRIBUTING.md SECURITY.md SUPPORT.md CODE_OF_CONDUCT.md CODEOWNERS CHANGELOG.md .github
  git commit -m "docs: add repository health files"
  ```

## Task 10: Harden CI, Security, and Release Workflows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/security.yml`
- Create: `.github/workflows/release-smoke.yml`
- Modify: `docs/release-gates.md`

- [ ] **Step 1: Pin the supported Node version in all workflows**

  Ensure every workflow uses the same Node version as `package.json`:

  ```text
  24.15.0
  ```

- [ ] **Step 2: Split fast verification from optional release smoke**

  Keep `.github/workflows/ci.yml` focused on:

  ```text
  npm ci
  npm run verify
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Put packaging or longer release checks in `release-smoke.yml`.

- [ ] **Step 3: Add dependency and code scanning configuration**

  Add:

  ```text
  .github/dependabot.yml for npm and GitHub Actions updates
  .github/workflows/security.yml for CodeQL or equivalent code scanning
  ```

  If CodeQL does not support one part of the stack cleanly, document the limitation in `docs/release-gates.md` rather than pretending coverage exists.

- [ ] **Step 4: Decide action pinning policy**

  Either pin third-party actions to full commit SHAs or document the current version-tag policy and a follow-up issue. Do not mix policies silently.

- [ ] **Step 5: Verify workflow syntax**

  Run:

  ```bash
  rg -n "node-version: 24.15.0" .github/workflows
  npm run verify
  ```

  Expected: workflows consistently reference Node 24.15.0; `npm run verify` passes locally.

- [ ] **Step 6: Commit**

  ```bash
  git add .github docs/release-gates.md
  git commit -m "ci: harden launch verification workflows"
  ```

## Task 11: Run Product Acceptance and Capture Evidence

**Files:**
- Modify: `docs/acceptance/product-release-gate.md`
- Create: `docs/acceptance/launch-core-evidence.md`

- [ ] **Step 1: Automated acceptance**

  Run:

  ```bash
  npm run verify
  cargo test --manifest-path src-tauri/Cargo.toml
  npm run doctor:json
  npm run dogfood:fixture
  ```

  Expected: all commands pass. Save summarized output in `docs/acceptance/launch-core-evidence.md`.

- [ ] **Step 2: Local app acceptance**

  Start:

  ```bash
  npm run dev
  ```

  In the in-app Browser, inspect:

  ```text
  desktop width
  tablet width
  narrow mobile width
  ```

  Verify:

  ```text
  Now shows live data or a correct empty/degraded state.
  Logbook can search imported sessions.
  Sources shows Codex adapter state and import jobs.
  Agent Access shows MCP status/tools/audit.
  Settings shows real daemon and database identity.
  No surface says No live connection when a compatible daemon is healthy.
  ```

- [ ] **Step 3: Human release sign-off**

  On a clean data directory:

  ```text
  install dependencies
  launch Masthead
  import real Codex history
  search for a known past session
  retrieve it through an external MCP client
  confirm audit row was written
  verify Settings against filesystem state
  export diagnostics
  preview local data deletion
  wipe Masthead-local data
  confirm source Codex files and project repos remain untouched
  ```

- [ ] **Step 4: Update the release gate checklist**

  Mark each item in `docs/acceptance/product-release-gate.md` with:

  ```text
  command or manual check used
  date
  result
  evidence link
  ```

- [ ] **Step 5: Final verification and commit**

  Run:

  ```bash
  npm run verify
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

  Expected: both commands pass after evidence docs are updated.

  Commit:

  ```bash
  git add docs/acceptance
  git commit -m "docs: capture launch core acceptance evidence"
  ```

## Optimizer Review

Rubric used:

```text
Goal clarity and launch scope: 15
Completeness across product subsystems: 20
Sequencing and dependencies: 15
Repo-specific specificity: 20
Verification strength: 15
Risk control and non-goals: 10
Developer handoff quality: 5
```

Score trajectory:

```text
Initial pasted plan: 61/100
Organized rewrite: 82/100
Optimized plan: 91/100
```

Substantive optimizer changes:

- Split the narrative into independently shippable implementation packs with exact repo files and verification commands.
- Reframed launch readiness around the current Masthead contract instead of a generic public-repo checklist.
- Moved future-facing items, such as broad adapter support and advanced security posture, behind explicit launch-scope boundaries.
- Added an acceptance evidence task so the plan ends with proof, not just implementation.

## Open Decision

Repository health work needs Tyler's license choice before `LICENSE` can be created. Do not pick a license without explicit approval.
