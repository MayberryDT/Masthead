# Sources Smooth Truthful Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Sources tab open smoothly and make degraded adapter states truthful by reducing initial payload/render work, separating current failures from historical import-job noise, and preserving the existing `Degraded` adapter state label for adapters with current issues.

**Architecture:** Keep Sources as the existing adapter/settings row surface with import jobs and detail modals. First remove the known performance bottlenecks: unbounded import history, duplicate inventory refreshes, and large always-rendered lists. Then fix status aggregation so current adapter health is based on latest relevant import results and grouped current diagnostics, not stale historical failures. Keep strict schema recognition and transcript approval gates intact.

**Tech Stack:** TypeScript, React, Vite, Vitest, happy-dom, daemon HTTP routes in `src/daemon/server.ts`, SQLite repositories in `src/daemon/db`, status aggregation in `src/daemon/import/sourceStatusService.ts`, API client in `src/app/daemonClient.ts`, Sources UI under `src/ui/sources`.

---

## Non-Negotiables

- Do not implement a new adapter state or visible label for detected-but-unimportable sources. Keep `state: "degraded"` and the visible `Degraded` badge when current diagnostics exist.
- Do not fake successful imports for unrecognized Cursor, Claude Code, Antigravity, OpenCode, Aider, OpenClaw, Hermes, or Pi schemas.
- Do not loosen transcript approval rules.
- Do not mutate or clean the user's local database as part of the fix.
- Do not redesign the Sources tab. Keep the current card/modal direction.
- Use the Codex in-app Browser plugin with the `iab` backend for browser verification.

## Baseline Evidence

Preserve these numbers as the before-state for verification:

- `/adapters`: about `0.15s`, about `1.0 MB`.
- `/sources`: about `0.25s`, about `0.89 MB`.
- `/imports`: about `0.23s`, about `1.13 MB`, 2,345 rows.
- Browser Sources click-to-visible: about `7.77s`.
- Render after settling: 10 adapter cards, 2,345 import rows, about 891 buttons, about 307,750 body text chars.
- `adapter_diagnostics` table is empty in the local DB; current issue display is synthesized from `import_jobs.failure_count`.
- Codex latest imports are successful; its displayed issues come from stale abandoned/cancelled historical jobs.
- Non-Codex degraded states are mostly strict schema diagnostics, especially repeated JSONL/schema failures for Hermes and Antigravity.

## Definition Of Done

- [ ] Sources click-to-visible is under `1s` on the same local dataset.
- [ ] Initial `/imports` payload is bounded to a small page, target under `150 KB` for `limit=50`.
- [ ] Initial Sources render does not create thousands of import rows or hundreds of action buttons.
- [ ] Clicking Sources does not trigger a duplicate inventory reload if fresh data is already loaded.
- [ ] Codex no longer shows stale abandoned-job issues after newer successful jobs for the same source/kind.
- [ ] Adapters with current strict diagnostics still show `Degraded`.
- [ ] Non-Codex adapters expose blocking diagnostic codes/messages without claiming successful transcript imports.
- [ ] Full import history remains reachable through pagination or load-more.
- [ ] Focused tests, typecheck, and build pass.

## Phase 0: Lock The Current Behavior With Tests

- [ ] Add failing or characterization tests before implementation.
- [ ] In `src/daemon/db/__tests__/sourceStatusService.test.ts`, add cases for:
  - stale failed job followed by newer successful job for same `source_id + import_kind`,
  - latest failed job remains a current issue,
  - multiple import kinds are evaluated independently,
  - strict preflight diagnostics keep adapter state `degraded`.
- [ ] In `src/daemon/db/__tests__/importJobRepository.test.ts` or a new repository test file, add tests for paged import-job listing before changing the repository implementation.
- [ ] In `src/ui/sources/__tests__/ImportJobsTable.test.tsx`, add tests that render only supplied page rows and expose pagination callbacks.
- [ ] In an App-level test if existing harness support is practical, add a test that a fresh Sources inventory is not refetched immediately on tab entry. If App harnessing is too heavy, extract and test a pure freshness helper in the implementation phase.

Verify expected failures:

```bash
npm test -- --run src/daemon/db/__tests__/sourceStatusService.test.ts
npm test -- --run src/daemon/db/__tests__/importJobRepository.test.ts
npm test -- --run src/ui/sources/__tests__/ImportJobsTable.test.tsx
```

## Phase 1: Fix The Initial Sources Lag

### 1.1 Add Bounded Import Job Pagination

- [ ] Update `src/daemon/db/importJobRepository.ts`.
- [ ] Keep `listImportJobs(db)` available only as an explicit unlimited call if existing internal code still needs it.
- [ ] Add `listImportJobPage(db, options)`:

```ts
export type ImportJobListStatus = ImportJobStatus | "active";

export interface ListImportJobsOptions {
  limit?: number;
  offset?: number;
  adapterId?: RuntimeKind;
  sourceId?: string;
  status?: ImportJobListStatus;
}

export interface ImportJobPage {
  jobs: ImportJobDto[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] Implement `status: "active"` as `queued`, `running`, or `cancelling`.
- [ ] Join `ingest_sources` only when filtering by `adapterId`; otherwise keep the query on `import_jobs`.
- [ ] Order by `updated_at DESC, import_job_id DESC`.
- [ ] Clamp `limit` in the route layer, not the repository layer.
- [ ] Add tests for newest-first ordering, offset paging, adapter/source/status filters, and total count.

Verify:

```bash
npm test -- --run src/daemon/db/__tests__/importJobRepository.test.ts
```

### 1.2 Change `GET /imports` To Return A Page

- [ ] Update `src/daemon/server.ts` route `GET /imports`.
- [ ] Parse `limit`, `offset`, `adapterId`, `sourceId`, and `status`.
- [ ] Defaults:
  - `limit=50`
  - `offset=0`
  - `max limit=200`
- [ ] Return a page object:

```ts
{
  imports: ImportJobDto[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] Keep the property name `imports` to minimize call-site churn.
- [ ] Return `400` for invalid negative offsets, invalid limits, unknown status values, or invalid adapter ids.
- [ ] Update `src/app/daemonClient.ts`:
  - introduce `ImportJobPageDto`,
  - preserve the existing `signal` option while adding query options,
  - update `listImports(baseUrl, options?)` from `Promise<ImportJob[]>` to `Promise<ImportJobPageDto>`,
  - include a temporary normalizer for the old `{ imports: ImportJobDto[] }` shape only if tests reveal another connector path still serves it.
- [ ] Use this client option shape:

```ts
type ListImportsOptions = {
  signal?: AbortSignal;
  limit?: number;
  offset?: number;
  adapterId?: string;
  sourceId?: string;
  status?: ImportJobStatus | "active";
};
```

- [ ] Add API client/route tests if there is an existing server route harness. If not, cover route parsing through the smallest available daemon route test.

Verify:

```bash
npm test -- --run src/daemon
npm run typecheck
```

### 1.3 Render Only The Current Import Page

- [ ] Update `src/app/App.tsx` Sources inventory state so imports are stored as a page:

```ts
type ImportJobsState = {
  jobs: ImportJobDto[];
  total: number;
  limit: number;
  offset: number;
  loading: boolean;
};
```

- [ ] Update the initial Sources load to call `listImports(activeProjectionUrl, { limit: 50, offset: 0 })`.
- [ ] Fetch active jobs separately with `status: "active"` if active jobs need to stay pinned above history:

```ts
const [historyPage, activePage] = await Promise.all([
  listImports(activeProjectionUrl, { limit: 50, offset: 0 }),
  listImports(activeProjectionUrl, { limit: 50, offset: 0, status: "active" })
]);
```

- [ ] Merge active jobs by `importJobId` above history rows without increasing the displayed history page size.
- [ ] Update `src/ui/sources/ImportJobsTable.tsx` props to accept page metadata and pagination callbacks.
- [ ] Add a simple `Load more` or previous/next control using existing Sources button styles.
- [ ] Keep empty, loading, failed, cancel, and retry states intact.
- [ ] Add tests proving only supplied rows render and pagination invokes the passed callback.

Verify:

```bash
npm test -- --run src/ui/sources/__tests__/ImportJobsTable.test.tsx
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
npm run typecheck
```

### 1.4 Remove Duplicate Fetch On Tab Entry

- [ ] Update the Sources inventory refresh logic in `src/app/App.tsx`.
- [ ] Add a freshness timestamp for successful inventory loads.
- [ ] Skip automatic tab-entry refresh when the inventory is younger than `10_000ms`.
- [ ] Explicit user refresh must always bypass the freshness guard.
- [ ] Do not suppress polling or progress refresh for active import jobs.
- [ ] Prefer a pure helper for testability:

```ts
export function shouldRefreshSourceInventory(input: {
  activeSurface: string;
  now: number;
  lastLoadedAt?: number;
  force?: boolean;
  ttlMs?: number;
}): boolean;
```

- [ ] Add tests for fresh, stale, non-Sources, and forced refresh cases.

Verify:

```bash
npm test -- --run src/app
npm run typecheck
```

## Phase 2: Make Degraded States Truthful

### 2.1 Compute Current Import Health From Latest Terminal Jobs

- [ ] Update `src/daemon/import/sourceStatusService.ts`.
- [ ] Replace the current `importCounts` query that sums all historical rows:

```sql
SELECT COALESCE(SUM(imported_count), 0), COALESCE(SUM(queued_count), 0), COALESCE(SUM(failure_count), 0)
FROM import_jobs
WHERE source_id = ?
```

- [ ] Add a helper that evaluates the latest job for each `source_id + import_kind`.
- [ ] Use latest terminal jobs (`succeeded`, `failed`, `cancelled`) for current health.
- [ ] Treat `queued`, `running`, and `cancelling` as active progress, not as proof that previous failure is fixed.
- [ ] If a newer successful terminal job exists for the same `source_id + import_kind`, stale failed/cancelled rows for that same key no longer contribute to `failureCount`.
- [ ] Keep a latest failed terminal job as a current failure.
- [ ] Preserve cumulative `importedRecords` only if it is used as a lifetime metric. If it is displayed as current run output, compute it from latest terminal jobs as well and update labels/tests accordingly.
- [ ] Add source-status tests for stale failure suppression and current failure preservation.

Suggested helper:

```ts
type SourceImportHealth = {
  importedRecords: number;
  queuedRecords: number;
  failureCount: number;
  currentFailureMessages: string[];
  lastSyncAt?: string;
};
```

Verify:

```bash
npm test -- --run src/daemon/db/__tests__/sourceStatusService.test.ts
npm test -- --run src/daemon/sources/__tests__/sourceDiscoveryService.test.ts
```

### 2.2 Group Current Diagnostics Without Hiding Severity

- [ ] Keep `AdapterStatusDto.state` unchanged:

```ts
state: "connected" | "degraded" | "disabled" | "not_detected" | "planned";
```

- [ ] Preserve the rule: current import failures or current strict diagnostics produce `degraded`.
- [ ] Extend the existing `SourceDiagnostic`/`AdapterDiagnostic` DTO shape with optional aggregation fields instead of creating a separate UI-only type:

```ts
type DiagnosticSummaryFields = {
  count: number;
  sampleSourceIds?: string[];
};
```

- [ ] Keep existing diagnostics valid when `count` is absent.
- [ ] Group repeated diagnostics by `runtime + code + message + severity`.
- [ ] Use `observedAt` as the newest timestamp in the group.
- [ ] Use `count` to preserve the real underlying volume.
- [ ] Cap `sampleSourceIds` at a small number such as `5`.
- [ ] Make the generic `adapter_import_failures` diagnostic use the current latest-job `failureCount`, not lifetime failure rows.
- [ ] For repeated Hermes/Antigravity schema failures, show one grouped diagnostic per code/message while preserving count.
- [ ] Add tests showing:
  - repeated `jsonl_invalid_line` diagnostics collapse to one row with `count`,
  - current failure count still marks adapter degraded,
  - stale historical failure does not create `adapter_import_failures`.

Verify:

```bash
npm test -- --run src/daemon/import/__tests__/multiAdapterImport.test.ts
npm test -- --run src/daemon/db/__tests__/sourceStatusService.test.ts
```

### 2.3 Explain Non-Codex Blocks Without Claiming Success

- [ ] In adapter detail data, preserve exact blocking diagnostic codes/messages for:
  - unsupported SQLite schema,
  - unrecognized JSONL line schema,
  - missing configured local source path,
  - adapter import not implemented,
  - transcript approval required.
- [ ] Keep non-Codex strict diagnostics as degraded.
- [ ] Do not convert diagnostic-only rows into sessions.
- [ ] Add or update tests for each current generic adapter path that assert diagnostic output and no successful transcript import.
- [ ] Verify Codex remains the only adapter with successful session import on the local dataset unless another adapter genuinely has recognized schema support.

Verify:

```bash
npm test -- --run src/daemon/import/__tests__/multiAdapterImport.test.ts
npm test -- --run src/daemon/sources/__tests__/sourceDiscoveryService.test.ts
```

## Phase 3: Make Large Adapter Details Lazy

### 3.1 Split Summary From Source Location Details

- [ ] Keep `GET /adapters` backward-compatible until the UI is migrated.
- [ ] Add a query option to `GET /adapters`:

```text
GET /adapters?includeLocations=false
```

- [ ] When `includeLocations=false`, return adapter summaries with:
  - counts,
  - policies,
  - state,
  - grouped diagnostics,
  - `sourceLocations: []` for compatibility.
- [ ] Add a detail route for paged source locations:

```text
GET /adapters/:runtime/sources?limit=100&offset=0
```

- [ ] Return:

```ts
{
  sources: SourceStatusDto[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] Validate `runtime`, `limit`, and `offset` in the route.
- [ ] Reuse `getSourceStatuses(db)` and filter by runtime; optimize with a repository query only if the filtered approach remains too large after Phase 1.
- [ ] Add route tests or source-service tests for summary and detail behavior.

Verify:

```bash
npm test -- --run src/daemon/sources/__tests__/sourceDiscoveryService.test.ts
npm run typecheck
```

### 3.2 Load Adapter Details On Modal Open

- [ ] Update `src/app/daemonClient.ts`:
  - add `listAdapters(baseUrl, { includeLocations?: boolean })`,
  - add `listAdapterSources(baseUrl, runtime, { limit, offset })`.
- [ ] Update `src/app/App.tsx` initial Sources inventory to call `listAdapters(..., { includeLocations: false })`.
- [ ] Update `src/ui/sources/SourceAdapterDetailModal.tsx` to request source locations only when opened.
- [ ] Add modal-local loading, empty, error, and pagination states.
- [ ] Render at most the current source-location page in the modal.
- [ ] Keep source exclude actions working on loaded rows.
- [ ] Add tests proving the modal does not need source locations on initial Sources render and loads them only when opened.

Verify:

```bash
npm test -- --run src/ui/sources
npm run typecheck
```

## Phase 4: Browser And Endpoint Verification

- [ ] Start the app with the standard launcher:

```bash
npm run dev
```

- [ ] Use the in-app Browser plugin with `iab` backend to open `http://127.0.0.1:5173`.
- [ ] Measure Sources tab click-to-visible with the same script used during diagnosis.
- [ ] Confirm the first Sources render has:
  - no thousands-row import table,
  - no hundreds of buttons,
  - bounded body text,
  - no duplicate `/adapters`, `/sources`, `/imports` request burst on tab click.
- [ ] Measure endpoint timings/payloads:

```bash
curl -s -w '%{time_total} %{size_download}\n' -o /tmp/masthead-adapters.json 'http://127.0.0.1:17373/adapters?includeLocations=false'
curl -s -w '%{time_total} %{size_download}\n' -o /tmp/masthead-sources.json http://127.0.0.1:17373/sources
curl -s -w '%{time_total} %{size_download}\n' -o /tmp/masthead-imports.json 'http://127.0.0.1:17373/imports?limit=50'
```

- [ ] Confirm user-visible truthfulness:
  - Codex issue count excludes stale abandoned/cancelled historical jobs when newer successful jobs exist.
  - Current strict Hermes/Antigravity/OpenCode/Cursor diagnostics still show as `Degraded`.
  - Diagnostic messages include real codes/messages and grouped counts.
  - Full import history and full source-location lists remain reachable through explicit pagination.

## Full Verification

- [ ] Run focused daemon tests:

```bash
npm test -- --run src/daemon/db/__tests__/importJobRepository.test.ts
npm test -- --run src/daemon/db/__tests__/sourceStatusService.test.ts
npm test -- --run src/daemon/import/__tests__/multiAdapterImport.test.ts
npm test -- --run src/daemon/sources/__tests__/sourceDiscoveryService.test.ts
```

- [ ] Run focused UI tests:

```bash
npm test -- --run src/ui/sources
npm test -- --run src/ui/__tests__/sourcesPanel.test.tsx
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

- [ ] Run build:

```bash
npm run build
```

- [ ] Run endpoint matrix because route shapes changed:

```bash
npm run check:endpoint-matrix
```

## Rollback Plan

- [ ] If paged `/imports` causes compatibility trouble, keep the new repository helper but temporarily make `listImports()` normalize both paged and legacy responses.
- [ ] If adapter summary/detail split causes UI regressions, keep `includeLocations=true` as a temporary client fallback while preserving paged imports and latest-job health.
- [ ] If diagnostic grouping obscures a needed detail, keep grouped summaries in the adapter row and expose raw samples only inside the detail modal.

## Commit Plan

- [ ] Commit 1: import-job pagination repository, route, API client, and tests.
- [ ] Commit 2: Sources UI paged import jobs and duplicate refresh guard.
- [ ] Commit 3: latest-job adapter health and grouped diagnostics.
- [ ] Commit 4: adapter summary/detail lazy loading and browser performance verification.

## Execution Notes

- Implement Phase 1 before Phase 2 so Sources becomes responsive even before status truthfulness is fully corrected.
- Implement Phase 2 before Phase 3 if the user prioritizes degraded-state correctness over modal payload trimming.
- Do not skip Phase 0 tests. The high-risk bugs are stale-history accounting and accidental claims that unsupported adapters imported successfully.
