# Sources Import Library Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a harness-first, visible, resumable Sources import flow that imports local coding-harness session history into Masthead's canonical session graph without opaque multi-hour jobs.

**Architecture:** Keep Masthead's existing adapter-neutral graph and import coordinator, but add a durable import ledger around it: parent jobs, manifests, child work units, grouped failures, heartbeat state, and completion reports. The UI becomes a simplified modal based on the session dossier modal language, with harness-first choices, age-window selection, visible progress, child-unit status, and proof of what landed in Logbook, dossiers, enrichment, and MCP.

**Tech Stack:** TypeScript, React, Vite, Vitest through `npm test`, Electron daemon APIs, SQLite migrations and repositories, existing Masthead adapters, existing `AppButton`, `StatusBadge`, Sources CSS, and session dossier modal styling patterns.

---

## Scope Decisions From Grill Session

1. Source setup starts with metadata import. Transcript import is a separate consented stage.
2. Every import job has a hard visibility contract: stage, current path, counts, rate, heartbeat, grouped failures, cancel, retry, stalled state, and completion report.
3. Transcript import uses a parent job per coding harness/import operation with visible child work units per transcript file or source session.
4. Transcript import builds a manifest before parsing so counts are visible before long-running work starts.
5. Import manifests and child-unit state persist in SQLite.
6. Bad files do not poison the whole import. Parent jobs can finish as `succeeded_with_issues`.
7. Completion reports show what Masthead gained: sessions, transcripts, skipped records, grouped failures, coverage, and next actions.
8. Canonical session identity is `host + runtime + source session ID`; metadata, transcripts, and live hook catch-up merge into one canonical session.
9. Transcript import defaults to changed files plus the last 30 days. Full archive import is a deliberate long-running action.
10. The default first slice has previewed counts and an expandable cap.
11. Enrichment is a separate non-blocking stage, defaulting to local deterministic enrichment.
12. Transcript approval and primary setup are by coding harness/runtime, not by local storage path. Paths remain diagnostics and provenance.
13. The UI should say "Import Codex sessions from the last 30 days", not ask the user to understand `~/.codex/sessions`.

## Existing Code To Reuse

- Adapter registry and harness catalog: `src/adapters/registry.ts`, `src/adapters/harnessCatalog.ts`, `src/adapters/capabilities.ts`
- Codex discovery and parsing: `src/adapters/codex/discovery.ts`, `src/adapters/codex/adapter.ts`, `src/adapters/codex/transcriptParser.ts`, `src/adapters/codex/metadataImport.ts`
- Generic adapter kits: `src/adapters/generic/jsonlAdapterKit.ts`, `src/adapters/generic/sqliteAdapterKit.ts`
- Existing active adapters: `src/adapters/hermes/*`, `src/adapters/cursor/*`, `src/adapters/antigravity/*`, `src/adapters/opencode/*`, `src/adapters/claudeCode/*`, `src/adapters/aider/*`, `src/adapters/openclaw/*`, `src/adapters/pi/*`
- Source scan and setup: `src/daemon/sources/sourceScanService.ts`, `src/daemon/sources/sourceSetupService.ts`, `src/daemon/sources/sourceConnectService.ts`, `src/daemon/sources/sourcePreflight.ts`
- Import queue: `src/daemon/import/importCoordinator.ts`, `src/daemon/import/importWorker.ts`, `src/daemon/db/importJobRepository.ts`
- Canonical graph ingestion: `src/daemon/db/sessionRepository.ts`, `src/daemon/db/sessionSourceRepository.ts`
- Logbook and dossier dependencies: `src/daemon/db/logbookSummaryRepository.ts`, `src/daemon/db/sessionDossierRepository.ts`, `src/daemon/db/sessionTranscriptRepository.ts`, `src/enrichment/sessionCompiler.ts`, `src/enrichment/sessionFacts.ts`
- Sources UI: `src/ui/SourcesPanel.tsx`, `src/ui/sources/SourcesOnboardingModal.tsx`, `src/ui/sources/SourcesConnectedDashboard.tsx`, `src/ui/sources/ImportJobsTable.tsx`, `src/styles/sources.css`
- Modal styling reference: `src/ui/session-dossier/SessionDossier.tsx`, `src/styles/session-dossier.css`
- Acceptance docs: `docs/reference/sources.md`, `docs/how-to/import-codex-history.md`, `docs/tutorials/first-run-codex-import.md`, `docs/acceptance/sources-onboarding-evidence.md`

## Local Dogfood Data To Verify Against

A shallow candidate-file count on this machine, without reading transcript contents, found:

- Codex: 233 candidate local history files.
- Hermes: 1,582 candidate local history files.
- OMP / Oh My Pi: 50 candidate local history files.
- Cursor: 46 candidate local history files.
- Antigravity: 228 candidate local history files.
- Pi: 0 candidate files in the checked default locations.

These counts are not product truth. They are a dogfood signal that the import flow must handle hundreds or thousands of child units, visible progress, partial failures, and adapters with schema uncertainty.

## Implementation Quality Gates

- Shared modules must not import daemon modules. Types shared by UI, daemon client, and daemon repositories belong in `src/shared/sourceImport.ts`; daemon repositories import those shared types.
- The first shippable slice must include real Codex child-unit execution, not only modal and progress UI. A visible queue without ledger-backed work units would repeat the old trust failure with nicer styling.
- Import completion reports must be derived from persisted import/session impact data. Do not hard-code created or updated session counts.
- The manifest preview must be available before starting a long-running transcript job. The UI cannot ask Tyler to approve an import age without showing how much work that means.
- Migration work must preserve existing `import_jobs` rows and mark any interrupted active jobs clearly. No migration may silently drop queued, running, or failed import history.
- Harness-first UI is product language; local paths are advanced diagnostics and provenance only.

## File Structure

### New Files

- `src/shared/sourceImport.ts`
  - Shared DTOs for import scope, manifest summary, child work units, failure groups, job heartbeat, and completion report.
- `src/daemon/db/migrations/007_import_ledger.sql`
  - Adds durable import manifests, child work units, grouped failures, runtime policies, and new import job visibility columns.
- `src/daemon/db/importLedgerRepository.ts`
  - SQLite repository for manifests, work units, grouped failures, heartbeat updates, and completion reports.
- `src/daemon/db/importSessionImpactRepository.ts`
  - Records which canonical sessions each import created, updated, or enriched so completion reports can prove what changed.
- `src/daemon/import/importManifestService.ts`
  - Builds metadata and transcript manifests from adapter discovery, cursors, exclusions, consent, and age-window scope.
- `src/daemon/import/importWorkUnitRunner.ts`
  - Runs one child work unit at a time, writes progress and heartbeat, records failure groups, and calls canonical ingestion.
- `src/daemon/import/importCompletionReport.ts`
  - Computes proof reports from the import ledger and canonical graph.
- `src/daemon/import/runtimePolicyRepository.ts`
  - Runtime-level transcript and enrichment policy repository for coding harness consent.
- `src/ui/sources/SourcesImportModal.tsx`
  - New simplified harness-first import modal based on session dossier modal visual language.
- `src/ui/sources/ImportProgressPanel.tsx`
  - Running import progress, heartbeat, stalled state, child-unit summary, and grouped failures.
- `src/ui/sources/ImportCompletionReport.tsx`
  - Completion report UI for what landed in Masthead.
- `src/ui/sources/HarnessImportCard.tsx`
  - Harness-first card for Codex, Hermes, Cursor, Antigravity, OMP, and other catalog entries.
- `src/daemon/import/__tests__/importLedgerRepository.test.ts`
- `src/daemon/import/__tests__/importSessionImpactRepository.test.ts`
- `src/daemon/import/__tests__/importManifestService.test.ts`
- `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`
- `src/daemon/import/__tests__/importCompletionReport.test.ts`
- `src/ui/sources/__tests__/SourcesImportModal.test.tsx`
- `src/ui/sources/__tests__/ImportProgressPanel.test.tsx`
- `src/ui/sources/__tests__/ImportCompletionReport.test.tsx`

### Modified Files

- `src/shared/sourcesSetup.ts`
  - Add harness-first setup DTO fields and import scope fields.
- `src/daemon/db/importJobRepository.ts`
  - Add `succeeded_with_issues`, heartbeat, stage, aggregate child-unit counts, scope, and summary fields.
- `src/daemon/import/importCoordinator.ts`
  - Add heartbeat API, stalled derivation support, and parent-job partial-success finalization.
- `src/daemon/import/sourceStatusService.ts`
  - Report harness-level status, coverage, transcript consent, manifest counts, and completion summaries.
- `src/daemon/sources/sourceSetupService.ts`
  - Build harness-first setup state and keep source paths under advanced diagnostics.
- `src/daemon/sources/sourceConnectService.ts`
  - Shift from selected source locations to selected runtimes/import scopes while preserving source-level execution.
- `src/daemon/server.ts`
  - Wire new APIs, runtime consent, manifest preview, ledger-backed import execution, completion reports, and enrichment job visibility.
- `src/app/daemonClient.ts`
  - Add client methods and DTOs for manifest preview, harness import runs, import detail, work-unit pagination, and completion reports.
- `src/ui/SourcesPanel.tsx`
  - Open the new modal and use harness-first setup state.
- `src/ui/sources/SourcesConnectedDashboard.tsx`
  - Use coding-harness language and hide folders by default.
- `src/ui/sources/ImportJobsTable.tsx`
  - Show stage, heartbeat, rate, child unit counts, `succeeded_with_issues`, stalled derived state, and completion report action.
- `src/ui/sources/SourceAdapterDetailModal.tsx`
  - Keep source paths, schema probes, and failures as advanced diagnostics.
- `src/styles/sources.css`
  - Add simplified import modal, stepper, scope preview, progress, child-unit table, and completion report styles using existing palette and button/card language.
- `docs/reference/sources.md`
  - Update Sources reference with harness-first flow, import ledger, partial success, and completion report semantics.
- `docs/how-to/import-codex-history.md`
  - Update CLI/API examples for metadata first, transcript recent, and full archive.
- `docs/acceptance/sources-onboarding-evidence.md`
  - Add release evidence checklist for visible import progress.

---

## Task 1: Shared Import DTOs

**Files:**
- Create: `src/shared/sourceImport.ts`
- Modify: `src/shared/sourcesSetup.ts`
- Test: type coverage through downstream tests in later tasks

- [ ] **Step 1: Create shared source import DTOs**

Add `src/shared/sourceImport.ts`:

```ts
import type { RuntimeKind } from "../adapters/types";

export type ImportJobKind = "metadata" | "transcript" | "enrichment";
export type ImportJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "succeeded_with_issues"
  | "failed"
  | "cancelled"
  | "cancelling";

export type ImportScopeMode = "metadata_all" | "transcript_recent" | "transcript_full" | "enrichment_missing";

export type ImportScopeDto = {
  mode: ImportScopeMode;
  days?: number;
  includeChangedSinceCursor: boolean;
  unitLimit?: number;
};

export type ImportStage =
  | "queued"
  | "manifest"
  | "metadata"
  | "transcript"
  | "normalization"
  | "enrichment"
  | "completion";

export type ImportVisibilityState =
  | ImportJobStatus
  | "stalled";

export type ImportWorkUnitStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "succeeded_with_issues"
  | "failed"
  | "skipped"
  | "cancelled";

export type ImportFailureKind =
  | "unreadable"
  | "locked"
  | "malformed"
  | "schema_drift"
  | "normalization"
  | "excluded"
  | "unknown";

export type ImportManifestSummaryDto = {
  manifestId: string;
  importJobId: string;
  runtime: RuntimeKind;
  sourceId?: string;
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  generatedAt: string;
  totalUnits: number;
  includedUnits: number;
  excludedUnits: number;
  totalBytes: number;
  estimatedRecords?: number;
};

export type ImportWorkUnitDto = {
  workUnitId: string;
  manifestId: string;
  importJobId: string;
  runtime: RuntimeKind;
  sourceId: string;
  unitKind: "metadata_source" | "transcript_file" | "source_session" | "enrichment_session";
  sourcePath?: string;
  sourceSessionId?: string;
  status: ImportWorkUnitStatus;
  statusReason?: string;
  fileSizeBytes?: number;
  modifiedAt?: string;
  estimatedRecords?: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  heartbeatAt?: string;
  startedAt?: string;
  finishedAt?: string;
  failureGroupId?: string;
};

export type ImportFailureGroupDto = {
  failureGroupId: string;
  importJobId: string;
  manifestId?: string;
  runtime: RuntimeKind;
  failureKind: ImportFailureKind;
  code: string;
  message: string;
  retryable: boolean;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  samplePaths: string[];
};

export type ImportCompletionReportDto = {
  importJobId: string;
  runtime: RuntimeKind;
  status: ImportVisibilityState;
  generatedAt: string;
  sessionsDiscovered: number;
  sessionsCreated: number;
  sessionsUpdated: number;
  transcriptsImported: number;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  logbookSearchableSessions: number;
  dossierReadySessions: number;
  enrichedSessions: number;
  mcpVisibleSessions: number;
  failedUnits: number;
  skippedUnits: number;
  nextActions: Array<"retry_failed_units" | "import_full_archive" | "approve_transcripts" | "run_enrichment" | "open_logbook">;
};
```

In `src/daemon/db/importJobRepository.ts`, replace local `ImportJobKind` and `ImportJobStatus` definitions with:

```ts
import type { ImportJobKind, ImportJobStatus } from "../../shared/sourceImport.ts";
export type { ImportJobKind, ImportJobStatus };
```

- [ ] **Step 2: Extend Sources setup request types**

In `src/shared/sourcesSetup.ts`, add imports and extend `SourcesSetupRunRequest`:

```ts
import type { ImportCompletionReportDto, ImportManifestSummaryDto, ImportScopeDto } from "./sourceImport";
```

Change `SourcesSetupRunRequest` to include harness-first fields:

```ts
export type SourcesSetupRunRequest = {
  runtimes?: string[];
  sourceIds?: string[];
  importMetadata?: boolean;
  importTranscripts?: boolean;
  queueEnrichment?: boolean;
  transcriptApproved?: boolean;
  enrichmentMode?: "local" | "remote" | "skip";
  transcriptApprovals?: Array<{ sourceId: string; runtime: string; approved: boolean }>;
  importScope?: ImportScopeDto;
  runtimeApprovals?: Array<{ runtime: string; approved: boolean }>;
};
```

Extend `SourcesSetupDto`:

```ts
export type SourcesSetupDto = {
  setupId: string;
  updatedAt: string;
  status: SetupStatus;
  connectedSources: ConnectedSourceDto[];
  coverage?: {
    sessions: number;
    metadataSessions?: number;
    transcriptSessions?: number;
    enrichedSessions?: number;
    missingTranscripts?: number;
    missingEnrichment?: number;
    failedImports?: number;
    unrecognizedSources?: number;
    enriched?: number;
    failures?: number;
    queued?: number;
    transcripts?: number;
  };
  enrichment?: {
    mode: "local" | "remote" | "skip";
    provider: "deterministic" | "openai" | "disabled";
    model?: string;
    current: number;
    missing: number;
    failed: number;
  };
  latestScan?: SourcesOnboardingScanDto;
  latestManifest?: ImportManifestSummaryDto;
  latestCompletionReport?: ImportCompletionReportDto;
  nextAction?: "connect_sources" | "approve_transcripts" | "build_library" | "sync" | "repair_missing_data" | "open_logbook" | "none";
  scan?: SourcesOnboardingScanDto;
  advanced: SourcesAdvancedDto;
};
```

- [ ] **Step 3: Run type check**

Run:

```bash
npm test -- --run src/app/__tests__/daemonClient.test.ts
```

Expected: compile failures are acceptable at this stage only if they identify missing DTO consumers that later tasks add. The repo uses Vitest through `npm test`; do not use Jest-only flags such as `--runInBand`.

- [ ] **Step 4: Commit**

```bash
git add src/shared/sourceImport.ts src/shared/sourcesSetup.ts src/daemon/db/importJobRepository.ts
git commit -m "feat: define source import DTOs"
```

---

## Task 2: Durable Import Ledger Migration And Repository

**Files:**
- Create: `src/daemon/db/migrations/007_import_ledger.sql`
- Create: `src/daemon/db/importLedgerRepository.ts`
- Create: `src/daemon/db/importSessionImpactRepository.ts`
- Modify: `src/daemon/db/importJobRepository.ts`
- Test: `src/daemon/import/__tests__/importLedgerRepository.test.ts`
- Test: `src/daemon/import/__tests__/importSessionImpactRepository.test.ts`

- [ ] **Step 1: Write repository tests first**

Create `src/daemon/import/__tests__/importLedgerRepository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import {
  createImportManifest,
  createImportWorkUnit,
  getImportManifestSummary,
  listImportWorkUnits,
  recordImportFailureGroup,
  updateImportWorkUnit
} from "../../db/importLedgerRepository.ts";

describe("import ledger repository", () => {
  let dir: string;
  let db: MastheadDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "masthead-import-ledger-"));
    db = openMastheadDatabase(join(dir, "masthead.sqlite"));
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO import_jobs (
        import_job_id, source_id, import_kind, status, updated_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run("import-1", "codex-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("persists a manifest and child work unit progress", () => {
    const manifest = createImportManifest(db, {
      generatedAt: "2026-07-01T00:01:00.000Z",
      importJobId: "import-1",
      importKind: "transcript",
      runtime: "codex",
      scope: { includeChangedSinceCursor: true, days: 30, mode: "transcript_recent", unitLimit: 500 },
      sourceId: "codex-sessions",
      totalBytes: 120,
      totalUnits: 1,
      includedUnits: 1,
      excludedUnits: 0
    });

    createImportWorkUnit(db, {
      estimatedRecords: 4,
      fileSizeBytes: 120,
      importJobId: "import-1",
      manifestId: manifest.manifestId,
      modifiedAt: "2026-07-01T00:00:30.000Z",
      runtime: "codex",
      sourceId: "codex-sessions",
      sourcePath: "/tmp/.codex/sessions/thread.jsonl",
      status: "queued",
      unitKind: "transcript_file"
    });

    const units = listImportWorkUnits(db, { importJobId: "import-1" });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      processedRecords: 0,
      sourcePath: "/tmp/.codex/sessions/thread.jsonl",
      status: "queued"
    });

    updateImportWorkUnit(db, units[0].workUnitId, {
      heartbeatAt: "2026-07-01T00:01:10.000Z",
      importedRecords: 3,
      processedRecords: 3,
      status: "running"
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      heartbeatAt: "2026-07-01T00:01:10.000Z",
      importedRecords: 3,
      processedRecords: 3,
      status: "running"
    });
    expect(getImportManifestSummary(db, manifest.manifestId)).toMatchObject({
      includedUnits: 1,
      totalUnits: 1
    });
  });

  test("groups import failures with sample paths", () => {
    const group = recordImportFailureGroup(db, {
      code: "malformed_json",
      failureKind: "malformed",
      importJobId: "import-1",
      message: "Codex transcript contained malformed JSON.",
      observedAt: "2026-07-01T00:02:00.000Z",
      retryable: false,
      runtime: "codex",
      samplePath: "/tmp/.codex/sessions/bad.jsonl"
    });

    const updated = recordImportFailureGroup(db, {
      code: "malformed_json",
      failureKind: "malformed",
      importJobId: "import-1",
      message: "Codex transcript contained malformed JSON.",
      observedAt: "2026-07-01T00:03:00.000Z",
      retryable: false,
      runtime: "codex",
      samplePath: "/tmp/.codex/sessions/also-bad.jsonl"
    });

    expect(updated.failureGroupId).toBe(group.failureGroupId);
    expect(updated.count).toBe(2);
    expect(updated.samplePaths).toContain("/tmp/.codex/sessions/bad.jsonl");
    expect(updated.samplePaths).toContain("/tmp/.codex/sessions/also-bad.jsonl");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importLedgerRepository.test.ts
```

Expected: FAIL because `importLedgerRepository.ts` and migration `007_import_ledger.sql` do not exist.

- [ ] **Step 3: Add the migration**

Create `src/daemon/db/migrations/007_import_ledger.sql`:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS import_jobs_next (
  import_job_id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'succeeded_with_issues', 'failed', 'cancelled', 'cancelling')),
  stage TEXT NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'manifest', 'metadata', 'transcript', 'normalization', 'enrichment', 'completion')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  total_work_units INTEGER NOT NULL DEFAULT 0,
  completed_work_units INTEGER NOT NULL DEFAULT 0,
  failed_work_units INTEGER NOT NULL DEFAULT 0,
  skipped_work_units INTEGER NOT NULL DEFAULT 0,
  current_path TEXT,
  heartbeat_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  failure_message TEXT,
  scope_json TEXT,
  completion_report_json TEXT
);

INSERT INTO import_jobs_next (
  import_job_id,
  source_id,
  import_kind,
  status,
  stage,
  discovered_count,
  processed_count,
  imported_count,
  queued_count,
  failure_count,
  current_path,
  started_at,
  finished_at,
  updated_at,
  failure_message
)
SELECT
  import_job_id,
  source_id,
  import_kind,
  status,
  'queued',
  discovered_count,
  processed_count,
  imported_count,
  queued_count,
  failure_count,
  current_path,
  started_at,
  finished_at,
  updated_at,
  failure_message
FROM import_jobs;

DROP TABLE import_jobs;
ALTER TABLE import_jobs_next RENAME TO import_jobs;

CREATE INDEX IF NOT EXISTS import_jobs_source_idx ON import_jobs(source_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS runtime_policies (
  runtime_policy_id TEXT PRIMARY KEY NOT NULL,
  runtime_kind TEXT NOT NULL,
  policy_kind TEXT NOT NULL CHECK (policy_kind IN ('transcript_import', 'mcp_access', 'enrichment')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  decided_at TEXT NOT NULL,
  reason TEXT,
  UNIQUE (runtime_kind, policy_kind)
);

CREATE TABLE IF NOT EXISTS import_manifests (
  manifest_id TEXT PRIMARY KEY NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  runtime_kind TEXT NOT NULL,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('metadata', 'transcript', 'enrichment')),
  scope_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  total_units INTEGER NOT NULL DEFAULT 0,
  included_units INTEGER NOT NULL DEFAULT 0,
  excluded_units INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  estimated_records INTEGER
);

CREATE INDEX IF NOT EXISTS import_manifests_job_idx ON import_manifests(import_job_id);

CREATE TABLE IF NOT EXISTS import_work_units (
  work_unit_id TEXT PRIMARY KEY NOT NULL,
  manifest_id TEXT NOT NULL REFERENCES import_manifests(manifest_id) ON DELETE CASCADE,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES ingest_sources(source_id) ON DELETE CASCADE,
  runtime_kind TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('metadata_source', 'transcript_file', 'source_session', 'enrichment_session')),
  source_path TEXT,
  source_session_id TEXT,
  cursor_before_json TEXT,
  cursor_after_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'succeeded_with_issues', 'failed', 'skipped', 'cancelled')),
  status_reason TEXT,
  file_size_bytes INTEGER,
  modified_at TEXT,
  estimated_records INTEGER,
  processed_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  skipped_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  failure_group_id TEXT,
  summary_json TEXT,
  UNIQUE (manifest_id, unit_kind, source_path, source_session_id)
);

CREATE INDEX IF NOT EXISTS import_work_units_job_idx ON import_work_units(import_job_id, status, heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS import_work_units_manifest_idx ON import_work_units(manifest_id, status);

CREATE TABLE IF NOT EXISTS import_failure_groups (
  failure_group_id TEXT PRIMARY KEY NOT NULL,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  manifest_id TEXT REFERENCES import_manifests(manifest_id) ON DELETE CASCADE,
  runtime_kind TEXT NOT NULL,
  failure_kind TEXT NOT NULL CHECK (failure_kind IN ('unreadable', 'locked', 'malformed', 'schema_drift', 'normalization', 'excluded', 'unknown')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
  count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sample_paths_json TEXT NOT NULL,
  UNIQUE (import_job_id, failure_kind, code, message)
);

CREATE INDEX IF NOT EXISTS import_failure_groups_job_idx ON import_failure_groups(import_job_id, failure_kind);

CREATE TABLE IF NOT EXISTS import_session_impacts (
  import_job_id TEXT NOT NULL REFERENCES import_jobs(import_job_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  runtime_kind TEXT NOT NULL,
  source_id TEXT REFERENCES ingest_sources(source_id) ON DELETE SET NULL,
  impact_kind TEXT NOT NULL CHECK (impact_kind IN ('created', 'updated', 'transcript_added', 'enriched')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (import_job_id, session_id, impact_kind)
);

CREATE INDEX IF NOT EXISTS import_session_impacts_job_idx ON import_session_impacts(import_job_id, runtime_kind, impact_kind);
```

- [ ] **Step 4: Implement the repository**

Create `src/daemon/db/importLedgerRepository.ts`:

```ts
import { stableRecordId } from "../identity.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type {
  ImportFailureGroupDto,
  ImportFailureKind,
  ImportManifestSummaryDto,
  ImportScopeDto,
  ImportWorkUnitDto,
  ImportWorkUnitStatus
} from "../../shared/sourceImport.ts";
import type { ImportJobKind } from "./importJobRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type SqlValue = string | number | null;

export type CreateImportManifestInput = {
  importJobId: string;
  sourceId?: string;
  runtime: RuntimeKind;
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  generatedAt: string;
  totalUnits: number;
  includedUnits: number;
  excludedUnits: number;
  totalBytes: number;
  estimatedRecords?: number;
};

export type CreateImportWorkUnitInput = {
  manifestId: string;
  importJobId: string;
  sourceId: string;
  runtime: RuntimeKind;
  unitKind: ImportWorkUnitDto["unitKind"];
  sourcePath?: string;
  sourceSessionId?: string;
  status: ImportWorkUnitStatus;
  statusReason?: string;
  fileSizeBytes?: number;
  modifiedAt?: string;
  estimatedRecords?: number;
  cursorBefore?: unknown;
};

export type UpdateImportWorkUnitInput = Partial<Pick<
  ImportWorkUnitDto,
  | "status"
  | "statusReason"
  | "processedRecords"
  | "importedRecords"
  | "skippedRecords"
  | "failedRecords"
  | "heartbeatAt"
  | "startedAt"
  | "finishedAt"
  | "failureGroupId"
>> & {
  cursorAfter?: unknown;
  summary?: unknown;
};

export type ListImportWorkUnitsOptions = {
  importJobId?: string;
  manifestId?: string;
  status?: ImportWorkUnitStatus;
  limit?: number;
  offset?: number;
};

export function createImportManifest(db: MastheadDatabase, input: CreateImportManifestInput): ImportManifestSummaryDto {
  const manifestId = stableRecordId("import_manifest", [
    input.importJobId,
    input.runtime,
    input.importKind,
    input.generatedAt
  ]);
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id,
      import_job_id,
      source_id,
      runtime_kind,
      import_kind,
      scope_json,
      generated_at,
      total_units,
      included_units,
      excluded_units,
      total_bytes,
      estimated_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(manifest_id) DO UPDATE SET
      total_units = excluded.total_units,
      included_units = excluded.included_units,
      excluded_units = excluded.excluded_units,
      total_bytes = excluded.total_bytes,
      estimated_records = excluded.estimated_records`
  ).run(
    manifestId,
    input.importJobId,
    input.sourceId ?? null,
    input.runtime,
    input.importKind,
    JSON.stringify(input.scope),
    input.generatedAt,
    input.totalUnits,
    input.includedUnits,
    input.excludedUnits,
    input.totalBytes,
    input.estimatedRecords ?? null
  );
  return getImportManifestSummary(db, manifestId) as ImportManifestSummaryDto;
}

export function getImportManifestSummary(db: MastheadDatabase, manifestId: string): ImportManifestSummaryDto | undefined {
  const row = db.prepare("SELECT * FROM import_manifests WHERE manifest_id = ?").get(manifestId) as Record<string, unknown> | undefined;
  return row ? manifestFromRow(row) : undefined;
}

export function createImportWorkUnit(db: MastheadDatabase, input: CreateImportWorkUnitInput): ImportWorkUnitDto {
  const workUnitId = stableRecordId("import_work_unit", [
    input.manifestId,
    input.unitKind,
    input.sourcePath ?? "",
    input.sourceSessionId ?? ""
  ]);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id,
      manifest_id,
      import_job_id,
      source_id,
      runtime_kind,
      unit_kind,
      source_path,
      source_session_id,
      cursor_before_json,
      status,
      status_reason,
      file_size_bytes,
      modified_at,
      estimated_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(manifest_id, unit_kind, source_path, source_session_id) DO UPDATE SET
      status = excluded.status,
      status_reason = excluded.status_reason,
      file_size_bytes = excluded.file_size_bytes,
      modified_at = excluded.modified_at,
      estimated_records = excluded.estimated_records`
  ).run(
    workUnitId,
    input.manifestId,
    input.importJobId,
    input.sourceId,
    input.runtime,
    input.unitKind,
    input.sourcePath ?? null,
    input.sourceSessionId ?? null,
    input.cursorBefore === undefined ? null : JSON.stringify(input.cursorBefore),
    input.status,
    input.statusReason ?? null,
    input.fileSizeBytes ?? null,
    input.modifiedAt ?? null,
    input.estimatedRecords ?? null
  );
  const created = getImportWorkUnit(db, workUnitId);
  if (!created) throw new Error(`Import work unit not found after create: ${workUnitId}`);
  return created;
}

export function getImportWorkUnit(db: MastheadDatabase, workUnitId: string): ImportWorkUnitDto | undefined {
  const row = db.prepare("SELECT * FROM import_work_units WHERE work_unit_id = ?").get(workUnitId) as Record<string, unknown> | undefined;
  return row ? workUnitFromRow(row) : undefined;
}

export function updateImportWorkUnit(db: MastheadDatabase, workUnitId: string, input: UpdateImportWorkUnitInput): ImportWorkUnitDto {
  const current = db.prepare("SELECT * FROM import_work_units WHERE work_unit_id = ?").get(workUnitId) as Record<string, unknown> | undefined;
  if (!current) throw new Error(`Import work unit not found: ${workUnitId}`);
  db.prepare(
    `UPDATE import_work_units
    SET status = ?,
      status_reason = ?,
      processed_records = ?,
      imported_records = ?,
      skipped_records = ?,
      failed_records = ?,
      heartbeat_at = ?,
      started_at = ?,
      finished_at = ?,
      failure_group_id = ?,
      cursor_after_json = ?,
      summary_json = ?
    WHERE work_unit_id = ?`
  ).run(
    input.status ?? current.status,
    input.statusReason ?? current.status_reason ?? null,
    input.processedRecords ?? current.processed_records,
    input.importedRecords ?? current.imported_records,
    input.skippedRecords ?? current.skipped_records,
    input.failedRecords ?? current.failed_records,
    input.heartbeatAt ?? current.heartbeat_at ?? null,
    input.startedAt ?? current.started_at ?? null,
    input.finishedAt ?? current.finished_at ?? null,
    input.failureGroupId ?? current.failure_group_id ?? null,
    input.cursorAfter === undefined ? current.cursor_after_json ?? null : JSON.stringify(input.cursorAfter),
    input.summary === undefined ? current.summary_json ?? null : JSON.stringify(input.summary),
    workUnitId
  );
  const updated = getImportWorkUnit(db, workUnitId);
  if (!updated) throw new Error(`Import work unit not found after update: ${workUnitId}`);
  return updated;
}

export function listImportWorkUnits(db: MastheadDatabase, options: ListImportWorkUnitsOptions = {}): ImportWorkUnitDto[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (options.importJobId) {
    where.push("import_job_id = ?");
    params.push(options.importJobId);
  }
  if (options.manifestId) {
    where.push("manifest_id = ?");
    params.push(options.manifestId);
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = options.limit ?? 250;
  const offset = options.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM import_work_units ${whereSql} ORDER BY started_at IS NULL, started_at, source_path LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows.map(workUnitFromRow);
}

export function recordImportFailureGroup(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    manifestId?: string;
    runtime: RuntimeKind;
    failureKind: ImportFailureKind;
    code: string;
    message: string;
    retryable: boolean;
    observedAt: string;
    samplePath?: string;
  }
): ImportFailureGroupDto {
  const existing = db
    .prepare(
      `SELECT *
      FROM import_failure_groups
      WHERE import_job_id = ?
        AND failure_kind = ?
        AND code = ?
        AND message = ?`
    )
    .get(input.importJobId, input.failureKind, input.code, input.message) as Record<string, unknown> | undefined;
  if (existing) {
    const samples = uniqueJsonStrings(existing.sample_paths_json, input.samplePath);
    db.prepare(
      `UPDATE import_failure_groups
      SET count = count + 1,
        last_seen_at = ?,
        sample_paths_json = ?
      WHERE failure_group_id = ?`
    ).run(input.observedAt, JSON.stringify(samples.slice(0, 8)), existing.failure_group_id);
    return failureGroupFromRow(
      db.prepare("SELECT * FROM import_failure_groups WHERE failure_group_id = ?").get(existing.failure_group_id) as Record<string, unknown>
    );
  }
  const failureGroupId = stableRecordId("import_failure_group", [
    input.importJobId,
    input.failureKind,
    input.code,
    input.message
  ]);
  db.prepare(
    `INSERT INTO import_failure_groups (
      failure_group_id,
      import_job_id,
      manifest_id,
      runtime_kind,
      failure_kind,
      code,
      message,
      retryable,
      count,
      first_seen_at,
      last_seen_at,
      sample_paths_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    failureGroupId,
    input.importJobId,
    input.manifestId ?? null,
    input.runtime,
    input.failureKind,
    input.code,
    input.message,
    input.retryable ? 1 : 0,
    1,
    input.observedAt,
    input.observedAt,
    JSON.stringify(input.samplePath ? [input.samplePath] : [])
  );
  return failureGroupFromRow(
    db.prepare("SELECT * FROM import_failure_groups WHERE failure_group_id = ?").get(failureGroupId) as Record<string, unknown>
  );
}

export function listImportFailureGroups(db: MastheadDatabase, importJobId: string): ImportFailureGroupDto[] {
  const rows = db
    .prepare("SELECT * FROM import_failure_groups WHERE import_job_id = ? ORDER BY count DESC, last_seen_at DESC")
    .all(importJobId) as Record<string, unknown>[];
  return rows.map(failureGroupFromRow);
}

function manifestFromRow(row: Record<string, unknown>): ImportManifestSummaryDto {
  return {
    estimatedRecords: optionalNumber(row.estimated_records),
    excludedUnits: numberValue(row.excluded_units),
    generatedAt: stringValue(row.generated_at),
    importJobId: stringValue(row.import_job_id),
    importKind: stringValue(row.import_kind) as ImportJobKind,
    includedUnits: numberValue(row.included_units),
    manifestId: stringValue(row.manifest_id),
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    scope: JSON.parse(stringValue(row.scope_json)) as ImportScopeDto,
    sourceId: optionalString(row.source_id),
    totalBytes: numberValue(row.total_bytes),
    totalUnits: numberValue(row.total_units)
  };
}

function workUnitFromRow(row: Record<string, unknown>): ImportWorkUnitDto {
  return {
    estimatedRecords: optionalNumber(row.estimated_records),
    failedRecords: numberValue(row.failed_records),
    failureGroupId: optionalString(row.failure_group_id),
    fileSizeBytes: optionalNumber(row.file_size_bytes),
    finishedAt: optionalString(row.finished_at),
    heartbeatAt: optionalString(row.heartbeat_at),
    importedRecords: numberValue(row.imported_records),
    importJobId: stringValue(row.import_job_id),
    manifestId: stringValue(row.manifest_id),
    modifiedAt: optionalString(row.modified_at),
    processedRecords: numberValue(row.processed_records),
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    skippedRecords: numberValue(row.skipped_records),
    sourceId: stringValue(row.source_id),
    sourcePath: optionalString(row.source_path),
    sourceSessionId: optionalString(row.source_session_id),
    startedAt: optionalString(row.started_at),
    status: stringValue(row.status) as ImportWorkUnitStatus,
    statusReason: optionalString(row.status_reason),
    unitKind: stringValue(row.unit_kind) as ImportWorkUnitDto["unitKind"],
    workUnitId: stringValue(row.work_unit_id)
  };
}

function failureGroupFromRow(row: Record<string, unknown>): ImportFailureGroupDto {
  return {
    code: stringValue(row.code),
    count: numberValue(row.count),
    failureGroupId: stringValue(row.failure_group_id),
    failureKind: stringValue(row.failure_kind) as ImportFailureKind,
    firstSeenAt: stringValue(row.first_seen_at),
    importJobId: stringValue(row.import_job_id),
    lastSeenAt: stringValue(row.last_seen_at),
    manifestId: optionalString(row.manifest_id),
    message: stringValue(row.message),
    retryable: numberValue(row.retryable) === 1,
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    samplePaths: JSON.parse(stringValue(row.sample_paths_json)) as string[]
  };
}

function uniqueJsonStrings(value: unknown, next: string | undefined): string[] {
  const current = typeof value === "string" ? (JSON.parse(value) as string[]) : [];
  return next ? [...new Set([...current, next])] : current;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : numberValue(value);
}
```

- [ ] **Step 5: Add session impact repository**

Create `src/daemon/db/importSessionImpactRepository.ts`:

```ts
import type { RuntimeKind } from "../../adapters/types.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type ImportSessionImpactKind = "created" | "updated" | "transcript_added" | "enriched";

export type ImportSessionImpactSummary = {
  sessionsCreated: number;
  sessionsUpdated: number;
  transcriptsAdded: number;
  sessionsEnriched: number;
};

export function recordImportSessionImpact(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    sessionId: string;
    runtime: RuntimeKind;
    impactKind: ImportSessionImpactKind;
    observedAt: string;
    sourceId?: string;
    recordCount?: number;
  }
): void {
  db.prepare(
    `INSERT INTO import_session_impacts (
      import_job_id,
      session_id,
      runtime_kind,
      source_id,
      impact_kind,
      first_seen_at,
      last_seen_at,
      record_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_job_id, session_id, impact_kind) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      record_count = import_session_impacts.record_count + excluded.record_count`
  ).run(
    input.importJobId,
    input.sessionId,
    input.runtime,
    input.sourceId ?? null,
    input.impactKind,
    input.observedAt,
    input.observedAt,
    input.recordCount ?? 1
  );
}

export function summarizeImportSessionImpacts(db: MastheadDatabase, importJobId: string): ImportSessionImpactSummary {
  const rows = db
    .prepare(
      `SELECT impact_kind AS impactKind, COUNT(DISTINCT session_id) AS sessions
      FROM import_session_impacts
      WHERE import_job_id = ?
      GROUP BY impact_kind`
    )
    .all(importJobId) as Array<{ impactKind: ImportSessionImpactKind; sessions: number }>;
  const count = (kind: ImportSessionImpactKind): number => rows.find((row) => row.impactKind === kind)?.sessions ?? 0;
  return {
    sessionsCreated: count("created"),
    sessionsEnriched: count("enriched"),
    sessionsUpdated: count("updated"),
    transcriptsAdded: count("transcript_added")
  };
}
```

- [ ] **Step 6: Add session impact tests**

Create `src/daemon/import/__tests__/importSessionImpactRepository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { recordImportSessionImpact, summarizeImportSessionImpacts } from "../../db/importSessionImpactRepository.ts";

describe("import session impact repository", () => {
  let dir: string;
  let db: MastheadDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "masthead-import-impact-"));
    db = openMastheadDatabase(join(dir, "masthead.sqlite"));
    db.prepare(`INSERT INTO ingest_sources (source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run("import-1", "codex-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)`)
      .run("host:test", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
      .run("runtime:codex:test", "codex", "test", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO sessions (session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("session:1", "host:test", "runtime:codex:test", "s1", "unknown", "2026-07-01T00:00:00.000Z", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("summarizes created, updated, transcript, and enrichment impacts", () => {
    recordImportSessionImpact(db, { importJobId: "import-1", impactKind: "created", observedAt: "2026-07-01T00:01:00.000Z", runtime: "codex", sessionId: "session:1", sourceId: "codex-sessions" });
    recordImportSessionImpact(db, { importJobId: "import-1", impactKind: "transcript_added", observedAt: "2026-07-01T00:02:00.000Z", recordCount: 4, runtime: "codex", sessionId: "session:1", sourceId: "codex-sessions" });
    recordImportSessionImpact(db, { importJobId: "import-1", impactKind: "enriched", observedAt: "2026-07-01T00:03:00.000Z", runtime: "codex", sessionId: "session:1", sourceId: "codex-sessions" });

    expect(summarizeImportSessionImpacts(db, "import-1")).toEqual({
      sessionsCreated: 1,
      sessionsEnriched: 1,
      sessionsUpdated: 0,
      transcriptsAdded: 1
    });
  });
});
```

- [ ] **Step 7: Extend import job repository DTO and mapper**

In `src/daemon/db/importJobRepository.ts`, import and re-export the shared job types:

```ts
import type { ImportJobKind, ImportJobStatus } from "../../shared/sourceImport.ts";
export type { ImportJobKind, ImportJobStatus };
```

Add fields to `ImportJobDto`:

```ts
  stage?: string;
  heartbeatAt?: string;
  totalWorkUnits?: number;
  completedWorkUnits?: number;
  failedWorkUnits?: number;
  skippedWorkUnits?: number;
  scope?: unknown;
  completionReport?: unknown;
```

Add columns to `ImportJobRow`:

```ts
  stage: string | null;
  heartbeat_at: string | null;
  total_work_units: number;
  completed_work_units: number;
  failed_work_units: number;
  skipped_work_units: number;
  scope_json: string | null;
  completion_report_json: string | null;
```

Add update fields to `updateImportJob`:

```ts
    stage?: string;
    heartbeatAt?: string | null;
    totalWorkUnits?: number;
    completedWorkUnits?: number;
    failedWorkUnits?: number;
    skippedWorkUnits?: number;
    scopeJson?: string | null;
    completionReportJson?: string | null;
```

Update the SQL to set the new fields and extend `importJobFromRow`:

```ts
    stage: row.stage ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    totalWorkUnits: row.total_work_units,
    completedWorkUnits: row.completed_work_units,
    failedWorkUnits: row.failed_work_units,
    skippedWorkUnits: row.skipped_work_units,
    scope: row.scope_json ? JSON.parse(row.scope_json) : undefined,
    completionReport: row.completion_report_json ? JSON.parse(row.completion_report_json) : undefined,
```

- [ ] **Step 8: Run repository tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importLedgerRepository.test.ts src/daemon/import/__tests__/importSessionImpactRepository.test.ts src/daemon/db/__tests__/importJobRepository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/db/migrations/007_import_ledger.sql src/daemon/db/importLedgerRepository.ts src/daemon/db/importSessionImpactRepository.ts src/daemon/db/importJobRepository.ts src/daemon/import/__tests__/importLedgerRepository.test.ts src/daemon/import/__tests__/importSessionImpactRepository.test.ts
git commit -m "feat: add durable import ledger"
```

---

## Task 3: Runtime-Level Coding Harness Policies

**Files:**
- Create: `src/daemon/import/runtimePolicyRepository.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/import/sourceStatusService.ts`
- Test: `src/daemon/import/__tests__/runtimePolicyRepository.test.ts`

- [ ] **Step 1: Write runtime policy tests**

Create `src/daemon/import/__tests__/runtimePolicyRepository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { getRuntimePolicy, setRuntimePolicy } from "../runtimePolicyRepository.ts";

describe("runtime policy repository", () => {
  let dir: string;
  let db: MastheadDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "masthead-runtime-policy-"));
    db = openMastheadDatabase(join(dir, "masthead.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("stores transcript approval by coding harness runtime", () => {
    expect(getRuntimePolicy(db, "codex", "transcript_import")).toBe(false);
    setRuntimePolicy(db, {
      decidedAt: "2026-07-01T00:00:00.000Z",
      enabled: true,
      policyKind: "transcript_import",
      reason: "Approved Codex transcript import.",
      runtime: "codex"
    });
    expect(getRuntimePolicy(db, "codex", "transcript_import")).toBe(true);
    expect(getRuntimePolicy(db, "hermes", "transcript_import")).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/runtimePolicyRepository.test.ts
```

Expected: FAIL because `runtimePolicyRepository.ts` does not exist.

- [ ] **Step 3: Implement runtime policy repository**

Create `src/daemon/import/runtimePolicyRepository.ts`:

```ts
import { stableRecordId } from "../identity.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type RuntimePolicyKind = "transcript_import" | "mcp_access" | "enrichment";

export function setRuntimePolicy(
  db: MastheadDatabase,
  input: {
    runtime: RuntimeKind;
    policyKind: RuntimePolicyKind;
    enabled: boolean;
    decidedAt: string;
    reason?: string;
  }
): void {
  const id = stableRecordId("runtime_policy", [input.runtime, input.policyKind]);
  db.prepare(
    `INSERT INTO runtime_policies (
      runtime_policy_id,
      runtime_kind,
      policy_kind,
      enabled,
      decided_at,
      reason
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(runtime_kind, policy_kind) DO UPDATE SET
      enabled = excluded.enabled,
      decided_at = excluded.decided_at,
      reason = excluded.reason`
  ).run(id, input.runtime, input.policyKind, input.enabled ? 1 : 0, input.decidedAt, input.reason ?? null);
}

export function getRuntimePolicy(db: MastheadDatabase, runtime: RuntimeKind, policyKind: RuntimePolicyKind, defaultValue = false): boolean {
  const row = db
    .prepare(
      `SELECT enabled
      FROM runtime_policies
      WHERE runtime_kind = ?
        AND policy_kind = ?
      LIMIT 1`
    )
    .get(runtime, policyKind) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : defaultValue;
}
```

- [ ] **Step 4: Replace global transcript approval checks**

In `src/daemon/server.ts`, replace global approval helpers with runtime-aware helpers:

```ts
  function transcriptImportApprovedForRuntime(runtime: RuntimeKind): boolean {
    return getRuntimePolicy(database, runtime, "transcript_import");
  }

  function approveTranscriptImportsForRuntime(runtime: RuntimeKind): void {
    setRuntimePolicy(database, {
      decidedAt: new Date().toISOString(),
      enabled: true,
      policyKind: "transcript_import",
      reason: `Transcript import approved for ${runtime}.`,
      runtime
    });
  }
```

Update call sites:

```ts
if (importTranscripts && body.transcriptApproved === true) {
  for (const runtime of runtimes) approveTranscriptImportsForRuntime(runtime);
}
```

and:

```ts
if (body.kind === "transcript" && !transcriptImportApprovedForRuntime(source.runtime)) {
  sendJson(request, response, config.allowedOrigins, 409, {
    ok: false,
    error: `Transcript import requires approval for ${source.runtime}.`
  });
  return;
}
```

For adapter actions:

```ts
if (action === "approve-transcripts") {
  approveTranscriptImportsForRuntime(runtime);
  sendJson(request, response, config.allowedOrigins, 202, { ok: true });
  return;
}
```

- [ ] **Step 5: Surface runtime policy state in adapter statuses**

In `src/daemon/import/sourceStatusService.ts`, import the repository:

```ts
import { getRuntimePolicy } from "./runtimePolicyRepository.ts";
```

Set adapter policy state:

```ts
transcriptImport: getRuntimePolicy(db, adapter.runtime, "transcript_import"),
enrichment: getRuntimePolicy(db, adapter.runtime, "enrichment", sourceLocations.some((source) => source.enrichmentEnabled)),
mcpAccess: getRuntimePolicy(db, adapter.runtime, "mcp_access", sourceLocations.some((source) => source.mcpEnabled))
```

- [ ] **Step 6: Run policy tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/runtimePolicyRepository.test.ts src/daemon/sources/__tests__/sourceSetupService.test.ts
```

Expected: PASS after updating setup tests to expect harness-level transcript state.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/import/runtimePolicyRepository.ts src/daemon/server.ts src/daemon/import/sourceStatusService.ts src/daemon/import/__tests__/runtimePolicyRepository.test.ts src/daemon/sources/__tests__/sourceSetupService.test.ts
git commit -m "feat: store transcript consent by coding harness"
```

---

## Task 4: Manifest Builder For Metadata And Transcript Scopes

**Files:**
- Create: `src/daemon/import/importManifestService.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/import/__tests__/importManifestService.test.ts`

- [ ] **Step 1: Write manifest service tests**

Create `src/daemon/import/__tests__/importManifestService.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveredSource, IngestCursor } from "../../../adapters/types.ts";
import { buildImportManifestPlan } from "../importManifestService.ts";

describe("import manifest service", () => {
  test("builds metadata-all units for recognized sources", async () => {
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path: "/tmp/session_index.jsonl",
      runtime: "codex",
      schemaVersion: "codex-local-jsonl",
      sourceId: "codex-session-index",
      sourceKind: "jsonl"
    };

    const plan = await buildImportManifestPlan({
      cursors: new Map(),
      importKind: "metadata",
      now: "2026-07-01T00:00:00.000Z",
      scope: { includeChangedSinceCursor: true, mode: "metadata_all" },
      sources: [source],
      sourceIsExcluded: () => false
    });

    expect(plan.units).toEqual([
      expect.objectContaining({
        sourceId: "codex-session-index",
        status: "queued",
        unitKind: "metadata_source"
      })
    ]);
    expect(plan.summary).toMatchObject({
      includedUnits: 1,
      totalUnits: 1
    });
  });

  test("builds a 30-day transcript slice plus changed files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "masthead-manifest-"));
    try {
      const oldFile = join(dir, "old.jsonl");
      const recentFile = join(dir, "recent.jsonl");
      const changedFile = join(dir, "changed.jsonl");
      writeFileSync(oldFile, "{\"type\":\"session_meta\"}\n");
      writeFileSync(recentFile, "{\"type\":\"session_meta\"}\n");
      writeFileSync(changedFile, "{\"type\":\"session_meta\"}\n");
      await utimes(oldFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));
      await utimes(recentFile, new Date("2026-06-25T00:00:00.000Z"), new Date("2026-06-25T00:00:00.000Z"));
      await utimes(changedFile, new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-01T00:00:00.000Z"));
      await mkdir(join(dir, "nested"));

      const source: DiscoveredSource = {
        confidence: "authoritative",
        path: dir,
        runtime: "codex",
        schemaVersion: "codex-local-jsonl",
        sourceId: "codex-sessions",
        sourceKind: "jsonl"
      };
      const cursors = new Map<string, IngestCursor>();
      cursors.set(`${source.sourceId}:changed.jsonl`, {
        byteOffset: 0,
        contentFingerprint: "1:1",
        cursorId: "cursor-1",
        sourceId: `${source.sourceId}:changed.jsonl`,
        sourcePath: changedFile
      });

      const plan = await buildImportManifestPlan({
        cursors,
        importKind: "transcript",
        now: "2026-07-01T00:00:00.000Z",
        scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        sources: [source],
        sourceIsExcluded: () => false
      });

      expect(plan.units.map((unit) => unit.sourcePath).sort()).toEqual([changedFile, recentFile].sort());
      expect(plan.summary).toMatchObject({
        includedUnits: 2,
        totalUnits: 3
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("marks excluded transcript units as skipped without counting them as failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "masthead-manifest-excluded-"));
    try {
      const file = join(dir, "private.jsonl");
      writeFileSync(file, "{\"type\":\"session_meta\"}\n");
      const source: DiscoveredSource = {
        confidence: "authoritative",
        path: dir,
        runtime: "codex",
        schemaVersion: "codex-local-jsonl",
        sourceId: "codex-sessions",
        sourceKind: "jsonl"
      };

      const plan = await buildImportManifestPlan({
        cursors: new Map(),
        importKind: "transcript",
        now: "2026-07-01T00:00:00.000Z",
        scope: { includeChangedSinceCursor: true, mode: "transcript_full" },
        sources: [source],
        sourceIsExcluded: (path) => path.includes("private")
      });

      expect(plan.units[0]).toMatchObject({
        status: "skipped",
        statusReason: "Excluded by source policy."
      });
      expect(plan.summary.excludedUnits).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importManifestService.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement manifest service**

Create `src/daemon/import/importManifestService.ts`:

```ts
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { DiscoveredSource, IngestCursor } from "../../adapters/types.ts";
import type { ImportJobKind } from "../db/importJobRepository.ts";
import type { CreateImportManifestInput, CreateImportWorkUnitInput } from "../db/importLedgerRepository.ts";
import type { ImportScopeDto } from "../../shared/sourceImport.ts";

export type ImportManifestPlan = {
  summary: Omit<CreateImportManifestInput, "generatedAt" | "importJobId">;
  units: Array<Omit<CreateImportWorkUnitInput, "importJobId" | "manifestId">>;
};

export async function buildImportManifestPlan(input: {
  sources: DiscoveredSource[];
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  now: string;
  cursors: Map<string, IngestCursor>;
  sourceIsExcluded: (path: string) => boolean;
}): Promise<ImportManifestPlan> {
  const units: ImportManifestPlan["units"] = [];
  for (const source of input.sources) {
    if (!source.path) continue;
    if (input.importKind === "metadata") {
      const info = await safeStat(source.path);
      units.push({
        fileSizeBytes: info?.size,
        modifiedAt: info?.mtime.toISOString(),
        runtime: source.runtime,
        sourceId: source.sourceId,
        sourcePath: source.path,
        status: input.sourceIsExcluded(source.path) ? "skipped" : "queued",
        statusReason: input.sourceIsExcluded(source.path) ? "Excluded by source policy." : undefined,
        unitKind: "metadata_source"
      });
      continue;
    }
    if (input.importKind === "transcript") {
      const transcriptFiles = await transcriptFilesForSource(source);
      for (const file of transcriptFiles) {
        const info = await safeStat(file.path);
        const cursor = input.cursors.get(file.sourceId) ?? input.cursors.get(file.path);
        const excluded = input.sourceIsExcluded(file.path);
        const includedByScope = shouldIncludeTranscriptUnit({
          cursor,
          modifiedAt: info?.mtime.toISOString(),
          now: input.now,
          scope: input.scope
        });
        units.push({
          cursorBefore: cursor,
          fileSizeBytes: info?.size,
          modifiedAt: info?.mtime.toISOString(),
          runtime: source.runtime,
          sourceId: file.sourceId,
          sourcePath: file.path,
          status: excluded ? "skipped" : includedByScope ? "queued" : "skipped",
          statusReason: excluded ? "Excluded by source policy." : includedByScope ? undefined : "Outside selected import age window.",
          unitKind: "transcript_file"
        });
      }
    }
  }

  const cappedUnits = applyUnitLimit(units, input.scope.unitLimit);
  const includedUnits = cappedUnits.filter((unit) => unit.status !== "skipped").length;
  const excludedUnits = cappedUnits.filter((unit) => unit.status === "skipped").length;
  return {
    summary: {
      estimatedRecords: undefined,
      excludedUnits,
      importKind: input.importKind,
      includedUnits,
      runtime: input.sources[0]?.runtime ?? "codex",
      scope: input.scope,
      sourceId: input.sources.length === 1 ? input.sources[0]?.sourceId : undefined,
      totalBytes: cappedUnits.reduce((total, unit) => total + (unit.fileSizeBytes ?? 0), 0),
      totalUnits: cappedUnits.length
    },
    units: cappedUnits
  };
}

function applyUnitLimit(units: ImportManifestPlan["units"], limit: number | undefined): ImportManifestPlan["units"] {
  if (!limit || limit <= 0) return units;
  const queued = units.filter((unit) => unit.status !== "skipped").slice(0, limit);
  const queuedKeys = new Set(queued.map(unitKey));
  return units.map((unit) => {
    if (unit.status === "skipped" || queuedKeys.has(unitKey(unit))) return unit;
    return { ...unit, status: "skipped", statusReason: "Outside selected first-run cap." };
  });
}

function unitKey(unit: ImportManifestPlan["units"][number]): string {
  return `${unit.sourceId}\0${unit.sourcePath ?? ""}\0${unit.sourceSessionId ?? ""}`;
}

async function transcriptFilesForSource(source: DiscoveredSource): Promise<Array<{ path: string; sourceId: string }>> {
  if (!source.path) return [];
  const info = await stat(source.path);
  if (!info.isDirectory()) return [{ path: source.path, sourceId: source.sourceId }];
  const files = await jsonlFiles(source.path);
  return files.map((path) => ({
    path,
    sourceId: `${source.sourceId}:${relative(source.path as string, path).replaceAll("\\", "/")}`
  }));
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files.toSorted();
}

function shouldIncludeTranscriptUnit(input: {
  cursor?: IngestCursor;
  modifiedAt?: string;
  now: string;
  scope: ImportScopeDto;
}): boolean {
  if (input.scope.mode === "transcript_full") return true;
  if (input.scope.mode !== "transcript_recent") return false;
  if (input.scope.includeChangedSinceCursor && input.cursor && input.modifiedAt && input.cursor.modifiedAt !== input.modifiedAt) return true;
  const days = input.scope.days ?? 30;
  if (!input.modifiedAt) return true;
  const cutoff = new Date(input.now).getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(input.modifiedAt).getTime() >= cutoff;
}

async function safeStat(path: string): Promise<{ size: number; mtime: Date } | undefined> {
  try {
    const info = await stat(path);
    return { mtime: info.mtime, size: info.size };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Persist manifest plans inside jobs**

In `src/daemon/server.ts`, add a helper near existing import helpers:

```ts
async function createManifestForJob(input: {
  importJobId: string;
  importKind: ImportJobKind;
  sources: DiscoveredSource[];
  scope: ImportScopeDto;
}): Promise<ImportManifestSummaryDto> {
  const cursors = new Map<string, IngestCursor>();
  for (const source of input.sources) {
    for (const cursor of readCursorsForSource(database, source.sourceId)) {
      cursors.set(cursor.sourcePath ?? cursor.sourceId, cursor);
      cursors.set(cursor.sourceId, cursor);
    }
  }
  const plan = await buildImportManifestPlan({
    cursors,
    importKind: input.importKind,
    now: new Date().toISOString(),
    scope: input.scope,
    sourceIsExcluded: (path) => sourceIsExcluded(database, path),
    sources: input.sources
  });
  const manifest = createImportManifest(database, {
    ...plan.summary,
    generatedAt: new Date().toISOString(),
    importJobId: input.importJobId
  });
  for (const unit of plan.units) {
    createImportWorkUnit(database, {
      ...unit,
      importJobId: input.importJobId,
      manifestId: manifest.manifestId
    });
  }
  updateImportJob(database, input.importJobId, {
    heartbeatAt: new Date().toISOString(),
    scopeJson: JSON.stringify(input.scope),
    stage: "manifest",
    totalWorkUnits: plan.summary.totalUnits,
    updatedAt: new Date().toISOString()
  });
  return manifest;
}
```

If `readCursorsForSource` does not exist yet, add it to the cursor repository or local server helpers by querying `ingest_cursors`.

- [ ] **Step 5: Add a manifest preview endpoint that does not create a job**

In `src/daemon/server.ts`, add a preview route before the setup run route:

```ts
if (request.method === "POST" && url.pathname === "/sources/import/preview") {
  try {
    const body = objectRecord(await optionalJsonBody(request));
    const scan = latestScan ?? (await scanSourcesAndPersist());
    const runtimes = setupRuntimesFromBody(body, scan);
    const scope = importScopeFromBody(body.importScope);
    const previews = [];
    for (const runtime of runtimes) {
      const runtimeSources = scan.adapters.find((adapter) => adapter.runtime === runtime)?.sources ?? [];
      if (runtimeSources.length === 0) continue;
      const plan = await buildImportManifestPlan({
        cursors: readCursorsForRuntime(database, runtime),
        importKind: scope.mode === "metadata_all" ? "metadata" : "transcript",
        now: new Date().toISOString(),
        scope,
        sourceIsExcluded: (path) => sourceIsExcluded(database, path),
        sources: runtimeSources
      });
      previews.push({ runtime, summary: plan.summary });
    }
    sendJson(request, response, config.allowedOrigins, 200, { ok: true, previews });
  } catch (error) {
    sendJson(request, response, config.allowedOrigins, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return;
}
```

Add helpers:

```ts
function importScopeFromBody(value: unknown): ImportScopeDto {
  const record = objectRecord(value);
  const mode = typeof record.mode === "string" ? record.mode : "transcript_recent";
  if (mode !== "metadata_all" && mode !== "transcript_recent" && mode !== "transcript_full" && mode !== "enrichment_missing") {
    throw new Error(`Unsupported import scope: ${mode}`);
  }
  return {
    days: typeof record.days === "number" ? record.days : mode === "transcript_recent" ? 30 : undefined,
    includeChangedSinceCursor: record.includeChangedSinceCursor !== false,
    mode,
    unitLimit: typeof record.unitLimit === "number" ? record.unitLimit : mode === "transcript_recent" ? 500 : undefined
  };
}

function readCursorsForRuntime(db: MastheadDatabase, runtime: RuntimeKind): Map<string, IngestCursor> {
  const rows = db
    .prepare(
      `SELECT ingest_cursors.*
      FROM ingest_cursors
      JOIN ingest_sources ON ingest_sources.source_id = ingest_cursors.source_id
      WHERE ingest_sources.adapter = ?`
    )
    .all(runtime) as Array<{
      cursor_id: string;
      source_id: string;
      source_path: string | null;
      byte_offset: number;
      modified_at: string | null;
      content_fingerprint: string | null;
    }>;
  const cursors = new Map<string, IngestCursor>();
  for (const row of rows) {
    const cursor = {
      byteOffset: row.byte_offset,
      contentFingerprint: row.content_fingerprint ?? undefined,
      cursorId: row.cursor_id,
      modifiedAt: row.modified_at ?? undefined,
      sourceId: row.source_id,
      sourcePath: row.source_path ?? undefined
    } satisfies IngestCursor;
    cursors.set(row.source_id, cursor);
    if (row.source_path) cursors.set(row.source_path, cursor);
  }
  return cursors;
}
```

This endpoint must not insert into `import_jobs`, `import_manifests`, or `import_work_units`. It exists only to let the modal preview scope before a long-running job starts.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importManifestService.test.ts src/core/__tests__/ingestServer.test.ts
```

Expected: PASS after updating server tests for manifest-backed imports.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/import/importManifestService.ts src/daemon/server.ts src/daemon/import/__tests__/importManifestService.test.ts
git commit -m "feat: build import manifests before parsing"
```

---

## Task 5: Parent Job Visibility, Heartbeat, Stalled State, And Partial Success

**Files:**
- Modify: `src/daemon/import/importCoordinator.ts`
- Modify: `src/daemon/db/importJobRepository.ts`
- Test: `src/daemon/import/__tests__/importCoordinator.test.ts`

- [ ] **Step 1: Add tests for heartbeat and partial success**

In `src/daemon/import/__tests__/importCoordinator.test.ts`, add:

```ts
test("updates heartbeat and stage while a job runs", async () => {
  const job = queueImportJob(
    db,
    { importKind: "metadata", sourceId: "codex-session-index", now: () => "2026-07-01T00:00:00.000Z" },
    async (controls) => {
      controls.updateProgress({
        currentPath: "/tmp/session_index.jsonl",
        heartbeatAt: "2026-07-01T00:00:05.000Z",
        stage: "metadata",
        processedCount: 1,
        importedCount: 1
      });
      return {
        discoveredCount: 1,
        failureCount: 0,
        importedCount: 1,
        processedCount: 1,
        queuedCount: 0
      };
    }
  );

  await waitForJob(job.importJobId);
  expect(getImportJob(db, job.importJobId)).toMatchObject({
    currentPath: undefined,
    heartbeatAt: "2026-07-01T00:00:05.000Z",
    importedCount: 1,
    stage: "completion",
    status: "succeeded"
  });
});

test("marks parent job succeeded_with_issues when work imported useful records and failures occurred", async () => {
  const job = queueImportJob(
    db,
    { importKind: "transcript", sourceId: "codex-sessions", now: () => "2026-07-01T00:00:00.000Z" },
    async () => ({
      discoveredCount: 10,
      failureCount: 2,
      importedCount: 8,
      processedCount: 10,
      queuedCount: 0
    })
  );

  await waitForJob(job.importJobId);
  expect(getImportJob(db, job.importJobId)?.status).toBe("succeeded_with_issues");
});
```

- [ ] **Step 2: Run failing coordinator tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importCoordinator.test.ts
```

Expected: FAIL because `stage` and `heartbeatAt` are not in progress updates and partial-success finalization does not exist.

- [ ] **Step 3: Extend import progress updates**

In `src/daemon/import/importCoordinator.ts`, extend `ImportProgressUpdate`:

```ts
export type ImportProgressUpdate = Partial<ImportWorkResult> & {
  currentPath?: string | null;
  failureMessage?: string | null;
  heartbeatAt?: string | null;
  stage?: string;
  totalWorkUnits?: number;
  completedWorkUnits?: number;
  failedWorkUnits?: number;
  skippedWorkUnits?: number;
};
```

In `updateProgress`, pass those fields through:

```ts
return updateImportJob(db, importJobId, {
  ...update,
  heartbeatAt: update.heartbeatAt ?? now(),
  updatedAt: now()
});
```

- [ ] **Step 4: Finalize partial success**

In `runQueuedImportJob`, replace final status:

```ts
status: "succeeded",
```

with:

```ts
status: result.failureCount > 0 && result.importedCount > 0 ? "succeeded_with_issues" : "succeeded",
stage: "completion",
heartbeatAt: now(),
```

Keep pure failure behavior unchanged when the worker throws or imports no useful records and reports failures.

- [ ] **Step 5: Add stalled derivation helper**

Add to `src/daemon/import/importCoordinator.ts`:

```ts
export function deriveImportVisibilityState(
  job: { status: string; heartbeatAt?: string; updatedAt: string },
  now = Date.now(),
  stalledAfterMs = 30_000
): string {
  if (job.status !== "running") return job.status;
  const heartbeat = new Date(job.heartbeatAt ?? job.updatedAt).getTime();
  if (!Number.isFinite(heartbeat)) return job.status;
  return now - heartbeat > stalledAfterMs ? "stalled" : job.status;
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importCoordinator.test.ts src/daemon/db/__tests__/importJobRepository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/import/importCoordinator.ts src/daemon/db/importJobRepository.ts src/daemon/import/__tests__/importCoordinator.test.ts
git commit -m "feat: expose import heartbeat and partial success"
```

---

## Task 6: Work Unit Runner For Transcript Import

**Files:**
- Create: `src/daemon/import/importWorkUnitRunner.ts`
- Modify: `src/daemon/db/sessionRepository.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`

- [ ] **Step 1: Write work-unit runner tests**

Create `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterRecord, DiscoveredSource } from "../../../adapters/types.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { createImportManifest, createImportWorkUnit, listImportFailureGroups, listImportWorkUnits } from "../../db/importLedgerRepository.ts";
import { runImportWorkUnit } from "../importWorkUnitRunner.ts";

describe("import work unit runner", () => {
  let dir: string;
  let db: MastheadDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "masthead-work-unit-"));
    db = openMastheadDatabase(join(dir, "masthead.sqlite"));
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("codex-sessions:thread.jsonl", "codex", "jsonl", join(dir, "thread.jsonl"), "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO import_jobs (
        import_job_id, source_id, import_kind, status, updated_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run("import-1", "codex-sessions:thread.jsonl", "transcript", "running", "2026-07-01T00:00:00.000Z");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("imports valid records and marks the unit succeeded", async () => {
    const sourcePath = join(dir, "thread.jsonl");
    writeFileSync(sourcePath, "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\"}}\n");
    const manifest = createImportManifest(db, {
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "import-1",
      importKind: "transcript",
      includedUnits: 1,
      runtime: "codex",
      scope: { includeChangedSinceCursor: true, mode: "transcript_recent", days: 30 },
      sourceId: "codex-sessions:thread.jsonl",
      totalBytes: 1,
      totalUnits: 1,
      excludedUnits: 0
    });
    const unit = createImportWorkUnit(db, {
      importJobId: "import-1",
      manifestId: manifest.manifestId,
      runtime: "codex",
      sourceId: "codex-sessions:thread.jsonl",
      sourcePath,
      status: "queued",
      unitKind: "transcript_file"
    });

    const records: AdapterRecord[] = [
      {
        diagnostics: [],
        normalized: {
          confidence: "authoritative",
          kind: "session",
          sourceRef: { sourceKind: "jsonl", sourcePath },
          value: { observedAt: "2026-07-01T00:00:00.000Z", sessionId: "s1" }
        },
        observedAt: "2026-07-01T00:00:00.000Z",
        payload: { id: "s1" },
        payloadHash: "hash",
        source: {
          confidence: "authoritative",
          path: sourcePath,
          runtime: "codex",
          schemaVersion: "codex-transcript-jsonl",
          sourceId: "codex-sessions:thread.jsonl",
          sourceKind: "jsonl"
        },
        sourceRecordKey: `${sourcePath}:1`
      }
    ];

    await runImportWorkUnit({
      adapterBackfill: async function* () {
        yield* records;
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unit.workUnitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      importedRecords: 1,
      processedRecords: 1,
      status: "succeeded"
    });
  });

  test("groups diagnostic records and marks the unit succeeded_with_issues", async () => {
    const sourcePath = join(dir, "bad.jsonl");
    const manifest = createImportManifest(db, {
      generatedAt: "2026-07-01T00:00:00.000Z",
      importJobId: "import-1",
      importKind: "transcript",
      includedUnits: 1,
      runtime: "codex",
      scope: { includeChangedSinceCursor: true, mode: "transcript_recent", days: 30 },
      sourceId: "codex-sessions:thread.jsonl",
      totalBytes: 1,
      totalUnits: 1,
      excludedUnits: 0
    });
    const unit = createImportWorkUnit(db, {
      importJobId: "import-1",
      manifestId: manifest.manifestId,
      runtime: "codex",
      sourceId: "codex-sessions:thread.jsonl",
      sourcePath,
      status: "queued",
      unitKind: "transcript_file"
    });

    await runImportWorkUnit({
      adapterBackfill: async function* (source: DiscoveredSource) {
        yield {
          diagnostics: [{ code: "malformed_json", message: "Malformed JSON.", observedAt: "2026-07-01T00:00:00.000Z", severity: "error" }],
          normalized: {
            confidence: "heuristic",
            kind: "event",
            sourceRef: { sourceKind: "jsonl", sourcePath: source.path },
            value: {}
          },
          observedAt: "2026-07-01T00:00:00.000Z",
          payload: {},
          payloadHash: "bad",
          source,
          sourceRecordKey: `${source.path}:1`
        };
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unit.workUnitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      failedRecords: 1,
      status: "failed"
    });
    expect(listImportFailureGroups(db, "import-1")).toEqual([
      expect.objectContaining({
        code: "malformed_json",
        count: 1,
        failureKind: "malformed"
      })
    ]);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importWorkUnitRunner.test.ts
```

Expected: FAIL because `importWorkUnitRunner.ts` does not exist.

- [ ] **Step 3: Extend canonical ingestion result with created/updated impact**

In `src/daemon/db/sessionRepository.ts`, extend `AdapterIngestionResult`:

```ts
export type AdapterIngestionResult = {
  sessionId?: string;
  created?: boolean;
};
```

Inside `ingestAdapterRecord`, after the canonical session ID is known and before commit, query whether the session existed before the upsert. Return:

```ts
return { created: sessionId ? !sessionExistedBefore : undefined, sessionId };
```

The implementation should keep the existing transaction boundary and should not add a second upsert path. The purpose is only to let import reports distinguish sessions created by this import from sessions updated by this import.

- [ ] **Step 4: Implement work-unit runner**

Create `src/daemon/import/importWorkUnitRunner.ts`:

```ts
import type { AdapterRecord, DiscoveredSource, RuntimeKind } from "../../adapters/types.ts";
import { ingestAdapterRecord } from "../db/sessionRepository.ts";
import { indexCanonicalSessionSearch } from "../db/sessionQueryRepository.ts";
import { recordImportSessionImpact } from "../db/importSessionImpactRepository.ts";
import {
  getImportWorkUnit,
  recordImportFailureGroup,
  updateImportWorkUnit
} from "../db/importLedgerRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export async function runImportWorkUnit(input: {
  db: MastheadDatabase;
  workUnitId: string;
  runtimeKind: RuntimeKind;
  hostId: string;
  hostname?: string;
  now?: () => string;
  adapterBackfill: (source: DiscoveredSource) => AsyncIterable<AdapterRecord>;
  onSessionImported?: (sessionId: string) => void;
}): Promise<{ imported: number; failed: number; processed: number; sessionIds: string[] }> {
  const now = input.now ?? (() => new Date().toISOString());
  const unit = getImportWorkUnit(input.db, input.workUnitId);
  if (!unit) throw new Error(`Import work unit not found: ${input.workUnitId}`);
  if (unit.status === "skipped" || unit.status === "cancelled") return { failed: 0, imported: 0, processed: 0, sessionIds: [] };

  updateImportWorkUnit(input.db, unit.workUnitId, {
    heartbeatAt: now(),
    startedAt: unit.startedAt ?? now(),
    status: "running"
  });

  let processed = 0;
  let imported = 0;
  let failed = 0;
  const sessionIds = new Set<string>();
  const source: DiscoveredSource = {
    confidence: "authoritative",
    path: unit.sourcePath,
    runtime: unit.runtime,
    schemaVersion: unit.unitKind === "transcript_file" && unit.runtime === "codex" ? "codex-transcript-jsonl" : undefined,
    sourceId: unit.sourceId,
    sourceKind: "jsonl"
  };

  try {
    for await (const record of input.adapterBackfill(source)) {
      processed += 1;
      if (record.diagnostics.length > 0) {
        failed += 1;
        const diagnostic = record.diagnostics[0];
        const failureGroup = recordImportFailureGroup(input.db, {
          code: diagnostic.code,
          failureKind: failureKindForDiagnostic(diagnostic.code),
          importJobId: unit.importJobId,
          manifestId: unit.manifestId,
          message: diagnostic.message,
          observedAt: diagnostic.observedAt || now(),
          retryable: diagnostic.code.includes("locked") || diagnostic.code.includes("busy"),
          runtime: unit.runtime,
          samplePath: unit.sourcePath
        });
        updateImportWorkUnit(input.db, unit.workUnitId, {
          failedRecords: failed,
          failureGroupId: failureGroup.failureGroupId,
          heartbeatAt: now(),
          processedRecords: processed,
          status: "running"
        });
        continue;
      }
      const result = ingestAdapterRecord(input.db, record, {
        hostId: input.hostId,
        hostname: input.hostname,
        runtimeKind: input.runtimeKind
      });
      if (result.sessionId) {
        imported += 1;
        sessionIds.add(result.sessionId);
        indexCanonicalSessionSearch(input.db, result.sessionId);
        recordImportSessionImpact(input.db, {
          importJobId: unit.importJobId,
          impactKind: unit.unitKind === "enrichment_session"
            ? "enriched"
            : unit.unitKind === "transcript_file"
              ? "transcript_added"
              : result.created
                ? "created"
                : "updated",
          observedAt: now(),
          recordCount: 1,
          runtime: unit.runtime,
          sessionId: result.sessionId,
          sourceId: unit.sourceId
        });
        input.onSessionImported?.(result.sessionId);
      }
      updateImportWorkUnit(input.db, unit.workUnitId, {
        heartbeatAt: now(),
        importedRecords: imported,
        processedRecords: processed,
        status: "running"
      });
    }
    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: failed,
      finishedAt: now(),
      heartbeatAt: now(),
      importedRecords: imported,
      processedRecords: processed,
      status: failed > 0 ? (imported > 0 ? "succeeded_with_issues" : "failed") : "succeeded"
    });
    return { failed, imported, processed, sessionIds: [...sessionIds] };
  } catch (error) {
    const group = recordImportFailureGroup(input.db, {
      code: error instanceof Error ? error.name : "unknown_error",
      failureKind: "unknown",
      importJobId: unit.importJobId,
      manifestId: unit.manifestId,
      message: error instanceof Error ? error.message : String(error),
      observedAt: now(),
      retryable: true,
      runtime: unit.runtime,
      samplePath: unit.sourcePath
    });
    updateImportWorkUnit(input.db, unit.workUnitId, {
      failedRecords: Math.max(1, failed),
      failureGroupId: group.failureGroupId,
      finishedAt: now(),
      heartbeatAt: now(),
      status: "failed",
      statusReason: error instanceof Error ? error.message : String(error)
    });
    return { failed: Math.max(1, failed), imported, processed, sessionIds: [...sessionIds] };
  }
}

function failureKindForDiagnostic(code: string): "unreadable" | "locked" | "malformed" | "schema_drift" | "normalization" | "unknown" {
  if (code.includes("permission") || code.includes("missing") || code.includes("unreadable")) return "unreadable";
  if (code.includes("locked") || code.includes("busy")) return "locked";
  if (code.includes("malformed") || code.includes("json")) return "malformed";
  if (code.includes("schema")) return "schema_drift";
  if (code.includes("normalization")) return "normalization";
  return "unknown";
}
```

- [ ] **Step 5: Wire server transcript worker to use child units**

In `src/daemon/server.ts`, change transcript import flow so the parent job:

1. Calls `createManifestForJob`.
2. Lists queued child units for that manifest.
3. Runs each child unit through `runImportWorkUnit`.
4. Updates parent aggregate progress after each child.
5. Returns `ImportWorkResult` with imported, failed, skipped, and processed totals.

Use this parent worker shape:

```ts
async function importTranscriptSourcesWithLedger(
  sources: DiscoveredSource[],
  scope: ImportScopeDto,
  controls: ImportJobControls
): Promise<ImportWorkResult> {
  const manifest = await createManifestForJob({
    importJobId: controls.importJobId,
    importKind: "transcript",
    scope,
    sources
  });
  const result = emptyImportResult();
  const units = listImportWorkUnits(database, { manifestId: manifest.manifestId, limit: 100_000 });
  for (const unit of units) {
    controls.throwIfCancelled();
    if (unit.status === "skipped") {
      result.queuedCount += 1;
      continue;
    }
    controls.updateProgress({
      currentPath: unit.sourcePath ?? unit.sourceSessionId ?? unit.workUnitId,
      heartbeatAt: new Date().toISOString(),
      stage: "transcript",
      totalWorkUnits: units.length
    });
    const adapter = adapterForRuntime(unit.runtime);
    if (!adapter) throw new Error(`No adapter for runtime ${unit.runtime}`);
    const unitResult = await runImportWorkUnit({
      adapterBackfill: (source) => adapter.backfill(source),
      db: database,
      hostId: `host:${config.host}`,
      hostname: config.host,
      now: () => new Date().toISOString(),
      onSessionImported: (sessionId) => queueSessionEnrichment(sessionId),
      runtimeKind: unit.runtime,
      workUnitId: unit.workUnitId
    });
    result.discoveredCount += unit.estimatedRecords ?? unitResult.processed;
    result.processedCount += unitResult.processed;
    result.importedCount += unitResult.imported;
    result.failureCount += unitResult.failed;
    controls.updateProgress({
      completedWorkUnits: listImportWorkUnits(database, { manifestId: manifest.manifestId, status: "succeeded", limit: 100_000 }).length,
      failedWorkUnits: listImportWorkUnits(database, { manifestId: manifest.manifestId, status: "failed", limit: 100_000 }).length,
      heartbeatAt: new Date().toISOString(),
      importedCount: result.importedCount,
      processedCount: result.processedCount,
      failureCount: result.failureCount,
      stage: "transcript"
    });
  }
  return result;
}
```

- [ ] **Step 6: Run transcript import tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/core/__tests__/ingestServer.test.ts
```

Expected: PASS after updating old assertions from one opaque transcript job to ledger-backed child-unit progress.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/import/importWorkUnitRunner.ts src/daemon/db/sessionRepository.ts src/daemon/server.ts src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/core/__tests__/ingestServer.test.ts
git commit -m "feat: run transcript imports as visible work units"
```

---

## Task 7: Completion Reports

**Files:**
- Create: `src/daemon/import/importCompletionReport.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/import/__tests__/importCompletionReport.test.ts`

- [ ] **Step 1: Write completion report tests**

Create `src/daemon/import/__tests__/importCompletionReport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { buildImportCompletionReport } from "../importCompletionReport.ts";

describe("import completion report", () => {
  let dir: string;
  let db: MastheadDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "masthead-completion-report-"));
    db = openMastheadDatabase(join(dir, "masthead.sqlite"));
    db.prepare(`INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)`)
      .run("host:test", "test", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
      .run("runtime:codex:test", "codex", "test", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session:1", "host:test", "runtime:codex:test", "s1", "unknown", "2026-07-01T00:00:00.000Z", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    db.prepare(`INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("message:1", "session:1", "user", "hello", "hash", "2026-07-01T00:00:00.000Z", "{}", "authoritative");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("reports imported sessions and next actions", () => {
    const report = buildImportCompletionReport(db, {
      failedUnits: 2,
      generatedAt: "2026-07-01T00:10:00.000Z",
      importJobId: "import-1",
      recordsFailed: 2,
      recordsImported: 8,
      recordsSkipped: 1,
      runtime: "codex",
      skippedUnits: 1,
      status: "succeeded_with_issues",
      transcriptsImported: 1
    });

    expect(report).toMatchObject({
      failedUnits: 2,
      logbookSearchableSessions: 1,
      nextActions: expect.arrayContaining(["retry_failed_units", "run_enrichment", "open_logbook"]),
      recordsImported: 8,
      runtime: "codex",
      status: "succeeded_with_issues"
    });
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importCompletionReport.test.ts
```

Expected: FAIL because the report builder does not exist.

- [ ] **Step 3: Implement report builder**

Create `src/daemon/import/importCompletionReport.ts`:

```ts
import type { RuntimeKind } from "../../adapters/types.ts";
import type { ImportCompletionReportDto, ImportVisibilityState } from "../../shared/sourceImport.ts";
import { summarizeImportSessionImpacts } from "../db/importSessionImpactRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export function buildImportCompletionReport(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    runtime: RuntimeKind;
    status: ImportVisibilityState;
    generatedAt: string;
    transcriptsImported: number;
    recordsImported: number;
    recordsSkipped: number;
    recordsFailed: number;
    failedUnits: number;
    skippedUnits: number;
  }
): ImportCompletionReportDto {
  const impact = summarizeImportSessionImpacts(db, input.importJobId);
  const runtimeSessionStats = db
    .prepare(
      `SELECT COUNT(*) AS sessions
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE runtimes.runtime_kind = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(input.runtime) as { sessions: number };
  const transcriptReady = db
    .prepare(
      `SELECT COUNT(DISTINCT messages.session_id) AS sessions
      FROM messages
      JOIN sessions ON sessions.session_id = messages.session_id
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE runtimes.runtime_kind = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(input.runtime) as { sessions: number };
  const enriched = db
    .prepare(
      `SELECT COUNT(DISTINCT session_enrichments.session_id) AS sessions
      FROM session_enrichments
      JOIN sessions ON sessions.session_id = session_enrichments.session_id
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE runtimes.runtime_kind = ?
        AND session_enrichments.status = 'current'
        AND sessions.deleted_at IS NULL`
    )
    .get(input.runtime) as { sessions: number };
  const mcpVisible = db
    .prepare(
      `SELECT COUNT(*) AS sessions
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE runtimes.runtime_kind = ?
        AND sessions.deleted_at IS NULL
        AND sessions.excluded_from_mcp_at IS NULL`
    )
    .get(input.runtime) as { sessions: number };

  const nextActions: ImportCompletionReportDto["nextActions"] = [];
  if (input.failedUnits > 0) nextActions.push("retry_failed_units");
  if (input.status === "succeeded" || input.status === "succeeded_with_issues") nextActions.push("open_logbook");
  if (enriched.sessions < runtimeSessionStats.sessions) nextActions.push("run_enrichment");
  if (input.status === "succeeded" || input.status === "succeeded_with_issues") nextActions.push("import_full_archive");

  return {
    dossierReadySessions: transcriptReady.sessions,
    enrichedSessions: enriched.sessions,
    failedUnits: input.failedUnits,
    generatedAt: input.generatedAt,
    importJobId: input.importJobId,
    logbookSearchableSessions: runtimeSessionStats.sessions,
    mcpVisibleSessions: mcpVisible.sessions,
    nextActions: [...new Set(nextActions)],
    recordsFailed: input.recordsFailed,
    recordsImported: input.recordsImported,
    recordsSkipped: input.recordsSkipped,
    runtime: input.runtime,
    sessionsCreated: impact.sessionsCreated,
    sessionsDiscovered: runtimeSessionStats.sessions,
    sessionsUpdated: impact.sessionsUpdated,
    skippedUnits: input.skippedUnits,
    status: input.status,
    transcriptsImported: Math.max(input.transcriptsImported, impact.transcriptsAdded)
  };
}
```

- [ ] **Step 4: Persist completion reports when jobs finish**

In `src/daemon/server.ts`, after a ledger-backed import worker finishes, call:

```ts
const report = buildImportCompletionReport(database, {
  failedUnits: listImportWorkUnits(database, { importJobId: controls.importJobId, status: "failed", limit: 100_000 }).length,
  generatedAt: new Date().toISOString(),
  importJobId: controls.importJobId,
  recordsFailed: result.failureCount,
  recordsImported: result.importedCount,
  recordsSkipped: result.queuedCount,
  runtime: sources[0]?.runtime ?? "codex",
  skippedUnits: listImportWorkUnits(database, { importJobId: controls.importJobId, status: "skipped", limit: 100_000 }).length,
  status: result.failureCount > 0 && result.importedCount > 0 ? "succeeded_with_issues" : "succeeded",
  transcriptsImported: result.importedCount
});
updateImportJob(database, controls.importJobId, {
  completionReportJson: JSON.stringify(report),
  updatedAt: new Date().toISOString()
});
```

- [ ] **Step 5: Add GET endpoint**

In `src/daemon/server.ts`, add:

```ts
const importReportMatch = url.pathname.match(/^\/imports\/([^/]+)\/report$/);
if (request.method === "GET" && importReportMatch?.[1]) {
  const job = getImportJob(database, importReportMatch[1]);
  if (!job) {
    sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "import not found" });
    return;
  }
  sendJson(request, response, config.allowedOrigins, 200, {
    ok: true,
    report: job.completionReport
  });
  return;
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/importCompletionReport.test.ts src/core/__tests__/ingestServer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/import/importCompletionReport.ts src/daemon/server.ts src/daemon/import/__tests__/importCompletionReport.test.ts
git commit -m "feat: report import completion evidence"
```

---

## Task 8: Harness-First Setup State And API

**Files:**
- Modify: `src/daemon/sources/sourceSetupService.ts`
- Modify: `src/daemon/sources/sourceConnectService.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Test: `src/daemon/sources/__tests__/sourceSetupService.test.ts`
- Test: `src/app/__tests__/daemonClient.test.ts`

- [ ] **Step 1: Add setup state tests for harness-first flow**

In `src/daemon/sources/__tests__/sourceSetupService.test.ts`, add:

```ts
test("builds harness-first setup state with source paths only in advanced diagnostics", () => {
  seedIngestSource(db, {
    adapter: "codex",
    confidence: "authoritative",
    sourceId: "codex-sessions",
    sourceKind: "jsonl",
    sourcePath: "/home/tyler/.codex/sessions"
  });

  const setup = buildSourcesSetupState(db, { now: "2026-07-01T00:00:00.000Z" });

  expect(setup.advanced.adapters.find((adapter) => adapter.runtime === "codex")).toMatchObject({
    runtime: "codex",
    sourceLocationCount: 1
  });
  expect(setup.connectedSources[0]).toMatchObject({
    runtime: "codex",
    transcriptImportEnabled: false
  });
  expect(setup.connectedSources[0].path).toBe("/home/tyler/.codex/sessions");
});
```

If `seedIngestSource` does not exist in the test file, add a small helper that inserts into `ingest_sources`.

- [ ] **Step 2: Extend daemon client tests**

In `src/app/__tests__/daemonClient.test.ts`, add assertions for manifest preview and import reports:

```ts
test("posts harness-first source setup run with import scope", async () => {
  mockFetchJson({ ok: true, jobs: [], queued: 0, skipped: [], setup: setupFixture });
  await runSourcesSetup("http://127.0.0.1:17373", {
    importMetadata: true,
    importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
    importTranscripts: true,
    runtimes: ["codex"],
    transcriptApproved: true
  });

  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:17373/sources/setup/run", expect.objectContaining({
    method: "POST"
  }));
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npm test -- --run src/daemon/sources/__tests__/sourceSetupService.test.ts src/app/__tests__/daemonClient.test.ts
```

Expected: FAIL until setup state and client methods are updated.

- [ ] **Step 4: Update setup service language and state**

In `src/daemon/sources/sourceSetupService.ts`:

1. Keep `connectedSources` for compatibility.
2. Treat runtime adapter rows as the primary setup surface.
3. Keep source paths in `advanced.sources` and adapter detail data.
4. Compute `nextAction` from harness state:

```ts
const nextAction =
  connectedSourcesWithJobs.length === 0
    ? "connect_sources"
    : connectedSourcesWithJobs.some((source) => !source.transcriptImportEnabled)
      ? "approve_transcripts"
      : connectedSourcesWithJobs.some((source) => source.status === "importing")
        ? "none"
        : connectedSourcesWithJobs.some((source) => source.needsAttention?.includes("enrichment"))
          ? "build_library"
          : "open_logbook";
```

- [ ] **Step 5: Update source connect service to accept runtimes and scope**

In `src/daemon/sources/sourceConnectService.ts`, keep the selected-runtime API but treat source iteration as implementation detail:

```ts
export type ConnectSourcesRequest = {
  runtimes: RuntimeKind[];
  importMetadata: boolean;
  importTranscripts: boolean;
  queueEnrichment: boolean;
  transcriptApproved?: boolean;
  importScope?: ImportScopeDto;
};
```

Queue one parent job per runtime/import kind, not one visible job per source path:

```ts
for (const runtime of selected) {
  const runtimeSources = scan.adapters.find((adapter) => adapter.runtime === runtime)?.sources ?? [];
  if (runtimeSources.length === 0) {
    skipped.push({ runtime, reason: "No recognized local history was detected for this coding harness." });
    continue;
  }
  const parentSource = runtimeSources[0];
  if (request.importMetadata) {
    jobs.push(queueImportJob(db, { importKind: "metadata", sourceId: parentSource.sourceId }, (controls) => runImport("metadata", runtime, controls)));
  }
  if (request.importTranscripts) {
    jobs.push(queueImportJob(db, { importKind: "transcript", sourceId: parentSource.sourceId }, (controls) => runImport("transcript", runtime, controls)));
  }
}
```

Change the callback signature to runtime-aware:

```ts
runImport: (kind: ImportJobKind, runtime: RuntimeKind, controls: ImportJobControls) => Promise<ImportWorkResult>
```

- [ ] **Step 6: Update daemon client**

In `src/app/daemonClient.ts`, export client methods:

```ts
export async function previewSourcesImport(
  baseUrl: string,
  input: SourcesSetupRunRequest
): Promise<Array<{ runtime: string; summary: ImportManifestSummaryDto }>> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/import/preview";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(input),
    headers: jsonHeaders,
    method: "POST"
  });
  if (!response.ok) throw new Error(`sources import preview request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; previews: Array<{ runtime: string; summary: ImportManifestSummaryDto }> };
  return body.previews;
}

export async function getImportReport(baseUrl: string, importJobId: string): Promise<ImportCompletionReportDto | undefined> {
  const url = new URL(baseUrl);
  url.pathname = `/imports/${encodeURIComponent(importJobId)}/report`;
  const response = await fetch(url.toString(), { headers: jsonHeaders });
  if (!response.ok) throw new Error(`import report request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; report?: ImportCompletionReportDto };
  return body.report;
}
```

Add work-unit pagination later in Task 10 with the UI progress panel.

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- --run src/daemon/sources/__tests__/sourceConnectService.test.ts src/daemon/sources/__tests__/sourceSetupService.test.ts src/app/__tests__/daemonClient.test.ts
```

Expected: PASS after updating tests to expect runtime-level jobs.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/sources/sourceSetupService.ts src/daemon/sources/sourceConnectService.ts src/daemon/server.ts src/app/daemonClient.ts src/daemon/sources/__tests__/sourceConnectService.test.ts src/daemon/sources/__tests__/sourceSetupService.test.ts src/app/__tests__/daemonClient.test.ts
git commit -m "feat: make source setup harness first"
```

---

## Task 9: Simplified Sources Import Modal

**Files:**
- Create: `src/ui/sources/SourcesImportModal.tsx`
- Create: `src/ui/sources/HarnessImportCard.tsx`
- Modify: `src/ui/SourcesPanel.tsx`
- Modify: `src/styles/sources.css`
- Test: `src/ui/sources/__tests__/SourcesImportModal.test.tsx`

- [ ] **Step 1: Write modal rendering tests**

Create `src/ui/sources/__tests__/SourcesImportModal.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AdapterStatus } from "../../../app/daemonClient";
import { SourcesImportModal } from "../SourcesImportModal";

const codexAdapter: AdapterStatus = {
  description: "Codex local hook, metadata, and transcript stores.",
  diagnostics: [],
  discoveredCount: 233,
  discoveredSessions: 233,
  failureCount: 0,
  importedCount: 0,
  importedSessions: 0,
  implementationState: "full",
  label: "Codex",
  maturity: "full",
  name: "Codex",
  policies: {
    enrichment: false,
    mcpAccess: true,
    metadataImport: true,
    transcriptImport: false
  },
  queuedRecords: 0,
  runtime: "codex",
  sourceLocationCount: 2,
  sourceLocations: [],
  state: "connected"
};

describe("SourcesImportModal", () => {
  test("renders harness-first copy without exposing folder choices in the primary flow", () => {
    const html = renderToStaticMarkup(
      <SourcesImportModal
        adapters={[codexAdapter]}
        busy={false}
        open
        onClose={() => undefined}
        onPreviewImport={() => []}
        onRunSetup={() => undefined}
      />
    );

    expect(html).toContain("Import session history");
    expect(html).toContain("Codex");
    expect(html).toContain("Last 30 days");
    expect(html).not.toContain("~/.codex/sessions");
  });
});
```

- [ ] **Step 2: Run failing UI test**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesImportModal.test.tsx
```

Expected: FAIL because the modal does not exist.

- [ ] **Step 3: Add harness card component**

Create `src/ui/sources/HarnessImportCard.tsx`:

```tsx
import type { AdapterStatus } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  adapter: AdapterStatus;
  checked: boolean;
  disabled?: boolean;
  onToggle: (runtime: string, checked: boolean) => void;
};

export function HarnessImportCard({ adapter, checked, disabled = false, onToggle }: Props) {
  const sessionCount = adapter.importedSessions || adapter.discoveredSessions || adapter.discoveredCount || 0;
  return (
    <label className="harness-import-card">
      <span className="harness-import-card-main">
        <span>
          <span className="mono-label">{adapter.runtime}</span>
          <strong>{adapter.label ?? adapter.name ?? adapter.runtime}</strong>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(adapter.runtime, event.currentTarget.checked)}
        />
      </span>
      <span className="harness-import-card-description">{adapter.description}</span>
      <span className="harness-import-card-footer">
        <StatusBadge tone={adapter.state === "connected" ? "active" : adapter.state === "degraded" ? "warning" : "neutral"}>
          {adapter.state.replaceAll("_", " ")}
        </StatusBadge>
        <span>{sessionCount} sessions detected</span>
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Add simplified modal**

Create `src/ui/sources/SourcesImportModal.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { AdapterStatus } from "../../app/daemonClient";
import type { SourcesSetupRunInput } from "../../shared/sourcesSetup";
import type { ImportManifestSummaryDto, ImportScopeDto } from "../../shared/sourceImport";
import { AppButton } from "../primitives/AppButton";
import { HarnessImportCard } from "./HarnessImportCard";

type Step = "harness" | "scope" | "consent" | "review" | "started";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  open: boolean;
  onClose: () => void;
  onPreviewImport: (input: SourcesSetupRunInput) => Promise<Array<{ runtime: string; summary: ImportManifestSummaryDto }>> | Array<{ runtime: string; summary: ImportManifestSummaryDto }>;
  onRunSetup: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
};

const defaultScope: ImportScopeDto = {
  days: 30,
  includeChangedSinceCursor: true,
  mode: "transcript_recent",
  unitLimit: 500
};

export function SourcesImportModal({ adapters, busy = false, onClose, onPreviewImport, onRunSetup, open }: Props) {
  const [step, setStep] = useState<Step>("harness");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(adapters.filter(canImport).map((adapter) => adapter.runtime).slice(0, 1)));
  const [scope, setScope] = useState<ImportScopeDto>(defaultScope);
  const [includeTranscripts, setIncludeTranscripts] = useState(true);
  const [preview, setPreview] = useState<Array<{ runtime: string; summary: ImportManifestSummaryDto }>>([]);
  const selectedRuntimes = Array.from(selected);
  const importableAdapters = useMemo(() => adapters.filter(canImport), [adapters]);

  if (!open) return null;

  const toggle = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const startImport = async () => {
    await onRunSetup({
      enrichmentMode: "local",
      importMetadata: true,
      importScope: scope,
      importTranscripts: includeTranscripts,
      queueEnrichment: true,
      runtimes: selectedRuntimes,
      transcriptApproved: includeTranscripts
    });
    setStep("started");
  };

  const loadPreview = async (nextScope = scope, nextIncludeTranscripts = includeTranscripts) => {
    const previews = await onPreviewImport({
      importMetadata: true,
      importScope: nextIncludeTranscripts ? nextScope : { includeChangedSinceCursor: true, mode: "metadata_all" },
      importTranscripts: nextIncludeTranscripts,
      runtimes: selectedRuntimes
    });
    setPreview(previews);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="session-detail-modal sources-import-modal" role="dialog" aria-modal="true" aria-label="Import session history">
        <header className="sources-import-header">
          <div>
            <p className="mono-label">Sources</p>
            <h2>Import session history</h2>
            <p>Choose a coding harness and how much local session history Masthead should normalize.</p>
          </div>
          <AppButton type="button" variant="icon" aria-label="Close import modal" onClick={onClose}>
            &times;
          </AppButton>
        </header>

        <div className="sources-import-stepper" aria-label="Import steps">
          {["Harness", "History", "Consent", "Review"].map((label, index) => (
            <span key={label} className={stepIndex(step) >= index ? "is-active" : undefined}>{label}</span>
          ))}
        </div>

        {step === "harness" ? (
          <div className="sources-import-body">
            <div className="harness-import-grid">
              {importableAdapters.map((adapter) => (
                <HarnessImportCard
                  adapter={adapter}
                  checked={selected.has(adapter.runtime)}
                  disabled={busy}
                  key={adapter.runtime}
                  onToggle={toggle}
                />
              ))}
            </div>
            <Footer back={onClose} next={() => setStep("scope")} nextDisabled={selectedRuntimes.length === 0 || busy} />
          </div>
        ) : null}

        {step === "scope" ? (
          <div className="sources-import-body">
            <div className="source-choice-list">
              <label className="source-choice">
                <input
                  type="radio"
                  name="source-import-scope"
                  checked={scope.mode === "transcript_recent"}
                  onChange={() => {
                    setIncludeTranscripts(true);
                    setScope(defaultScope);
                    void loadPreview(defaultScope, true);
                  }}
                />
                <span>
                  <strong>Last 30 days and changed sessions</strong>
                  <small>Recommended first import. Bounded, visible, and enough to make Logbook useful quickly.</small>
                </span>
              </label>
              <label className="source-choice">
                <input
                  type="radio"
                  name="source-import-scope"
                  checked={scope.mode === "transcript_full"}
                  onChange={() => {
                    const fullScope = { includeChangedSinceCursor: true, mode: "transcript_full" } satisfies ImportScopeDto;
                    setIncludeTranscripts(true);
                    setScope(fullScope);
                    void loadPreview(fullScope, true);
                  }}
                />
                <span>
                  <strong>Full local archive</strong>
                  <small>Long-running import. Masthead will show progress, failures, and retryable child units.</small>
                </span>
              </label>
              <label className="source-choice">
                <input
                  type="radio"
                  name="source-import-scope"
                  checked={!includeTranscripts}
                  onChange={() => {
                    setIncludeTranscripts(false);
                    void loadPreview(scope, false);
                  }}
                />
                <span>
                  <strong>Metadata only</strong>
                  <small>Creates Logbook session shells without importing prompt or transcript content.</small>
                </span>
              </label>
            </div>
            <ScopePreview previews={preview} />
            <Footer back={() => setStep("harness")} next={() => setStep("consent")} />
          </div>
        ) : null}

        {step === "consent" ? (
          <div className="sources-import-body">
            <section className="sources-import-consent">
              <h3>Transcript approval</h3>
              <p>Transcripts can include prompts, code, file paths, command output, and private data. Approval applies to the selected coding harnesses, not individual folders.</p>
              <dl>
                <div><dt>Harnesses</dt><dd>{selectedRuntimes.join(", ")}</dd></div>
                <div><dt>History</dt><dd>{includeTranscripts ? scopeLabel(scope) : "Metadata only"}</dd></div>
              </dl>
            </section>
            <Footer back={() => setStep("scope")} next={() => setStep("review")} />
          </div>
        ) : null}

        {step === "review" ? (
          <div className="sources-import-body">
            <section className="sources-import-review">
              <h3>Ready to import</h3>
              <p>Masthead will build a manifest, show the child work units, import metadata first, import approved transcripts, then queue local deterministic enrichment.</p>
              <ul>
                <li>Selected coding harnesses: {selectedRuntimes.join(", ")}</li>
                <li>Transcript scope: {includeTranscripts ? scopeLabel(scope) : "Not included"}</li>
                <li>Enrichment: local deterministic, non-blocking</li>
              </ul>
            </section>
            <Footer back={() => setStep("consent")} next={startImport} nextLabel="Start import" nextDisabled={busy} />
          </div>
        ) : null}

        {step === "started" ? (
          <div className="sources-import-body">
            <section className="sources-import-review">
              <h3>Import started</h3>
              <p>The import queue below will show progress, current path, heartbeat, child units, grouped failures, and completion reports.</p>
            </section>
            <div className="surface-actions">
              <AppButton type="button" variant="primary" onClick={onClose}>View queue</AppButton>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Footer({
  back,
  next,
  nextDisabled = false,
  nextLabel = "Continue"
}: {
  back: () => void;
  next: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <footer className="sources-import-footer">
      <AppButton type="button" onClick={back}>Back</AppButton>
      <AppButton type="button" variant="primary" onClick={next} disabled={nextDisabled}>{nextLabel}</AppButton>
    </footer>
  );
}

function ScopePreview({ previews }: { previews: Array<{ runtime: string; summary: ImportManifestSummaryDto }> }) {
  if (previews.length === 0) {
    return <p className="sources-import-preview-empty">Preview counts appear after choosing a history scope.</p>;
  }
  return (
    <dl className="sources-import-preview" aria-label="Import preview">
      {previews.map((preview) => (
        <div key={preview.runtime}>
          <dt>{preview.runtime}</dt>
          <dd>{preview.summary.includedUnits} included / {preview.summary.totalUnits} units · {formatBytes(preview.summary.totalBytes)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatBytes(value: number): string {
  if (value > 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value > 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function canImport(adapter: AdapterStatus): boolean {
  return adapter.implementationState !== "planned" && adapter.policies.metadataImport;
}

function stepIndex(step: Step): number {
  return { harness: 0, scope: 1, consent: 2, review: 3, started: 4 }[step];
}

function scopeLabel(scope: ImportScopeDto): string {
  if (scope.mode === "transcript_full") return "Full local archive";
  if (scope.mode === "transcript_recent") return `Last ${scope.days ?? 30} days and changed sessions`;
  return "Metadata";
}
```

- [ ] **Step 5: Wire SourcesPanel to use new modal**

In `src/ui/SourcesPanel.tsx`, replace `SourcesOnboardingModal` import with:

```ts
import { SourcesImportModal } from "./sources/SourcesImportModal";
```

Render:

```tsx
<SourcesImportModal
  adapters={adapterRows}
  busy={busy}
  onClose={() => setOnboardingOpen(false)}
  onRunSetup={props.onRunSetup}
  open={onboardingOpen}
/>
```

Keep `SourcesOnboardingModal` in the repo until all older tests are updated, but stop using it from the main Sources panel.

- [ ] **Step 6: Add CSS using existing Masthead language**

Append to `src/styles/sources.css`:

```css
.session-detail-modal.sources-import-modal {
  width: min(860px, calc(100vw - 36px));
  max-height: min(760px, calc(100vh - 36px));
  overflow: hidden;
  border: 2px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--body);
}

.sources-import-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  border-bottom: 1px solid var(--line);
  background: var(--toolbar-bg);
  padding: 18px;
}

.sources-import-header h2 {
  margin: 3px 0 0;
  color: var(--ink);
  font-size: 24px;
  line-height: 1.1;
}

.sources-import-header p:not(.mono-label) {
  max-width: 660px;
  margin: 8px 0 0;
  color: var(--body);
}

.sources-import-stepper {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
  background: rgba(3, 16, 25, 0.24);
}

.sources-import-stepper span {
  min-width: 0;
  border-right: 1px solid rgba(194, 221, 241, 0.11);
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 10px 12px;
}

.sources-import-stepper span.is-active {
  color: var(--ink);
  background: rgba(46, 167, 255, 0.1);
}

.sources-import-body {
  display: grid;
  gap: 14px;
  max-height: calc(100vh - 210px);
  overflow-y: auto;
  padding: 16px;
}

.harness-import-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 10px;
}

.harness-import-card {
  display: grid;
  gap: 10px;
  min-height: 154px;
  border: 1px solid rgba(92, 153, 187, 0.17);
  border-left: 3px solid var(--blue);
  border-radius: 5px;
  background: #081d2b;
  cursor: pointer;
  padding: 14px;
}

.harness-import-card-main,
.harness-import-card-footer {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.harness-import-card strong {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: var(--ink);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.harness-import-card-description,
.harness-import-card-footer span:last-child,
.sources-import-consent p,
.sources-import-review p {
  color: var(--mute);
}

.sources-import-consent,
.sources-import-review {
  border: 1px solid rgba(92, 153, 187, 0.17);
  border-radius: 5px;
  background: rgba(3, 16, 25, 0.42);
  padding: 14px;
}

.sources-import-consent h3,
.sources-import-review h3 {
  margin: 0 0 8px;
  color: var(--ink);
  font-size: 15px;
}

.sources-import-consent dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0 0;
}

.sources-import-consent dt {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.sources-import-consent dd {
  margin: 3px 0 0;
  color: var(--ink);
}

.sources-import-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/__tests__/sourcesPanel.test.tsx
```

Expected: PASS after updating old text assertions from "Set up sources" where necessary to "Import session history".

- [ ] **Step 8: Commit**

```bash
git add src/ui/sources/SourcesImportModal.tsx src/ui/sources/HarnessImportCard.tsx src/ui/SourcesPanel.tsx src/styles/sources.css src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/__tests__/sourcesPanel.test.tsx
git commit -m "feat: add harness first import modal"
```

---

## Task 10: Import Progress Panel, Work Units, And Completion Report UI

**Files:**
- Create: `src/ui/sources/ImportProgressPanel.tsx`
- Create: `src/ui/sources/ImportCompletionReport.tsx`
- Modify: `src/ui/sources/ImportJobsTable.tsx`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/styles/sources.css`
- Test: `src/ui/sources/__tests__/ImportProgressPanel.test.tsx`
- Test: `src/ui/sources/__tests__/ImportCompletionReport.test.tsx`

- [ ] **Step 1: Add daemon endpoint for child units**

In `src/daemon/server.ts`, add:

```ts
const importUnitsMatch = url.pathname.match(/^\/imports\/([^/]+)\/units$/);
if (request.method === "GET" && importUnitsMatch?.[1]) {
  const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, 1, 500);
  const offset = parseBoundedInteger(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const status = url.searchParams.get("status");
  if (!limit.ok || !offset.ok) {
    sendJson(request, response, config.allowedOrigins, 400, {
      error: "invalid_pagination",
      message: "limit must be 1-500 and offset must be a non-negative integer."
    });
    return;
  }
  const units = listImportWorkUnits(database, {
    importJobId: importUnitsMatch[1],
    limit: limit.value,
    offset: offset.value,
    status: isImportWorkUnitStatus(status) ? status : undefined
  });
  sendJson(request, response, config.allowedOrigins, 200, {
    ok: true,
    limit: limit.value,
    offset: offset.value,
    units
  });
  return;
}
```

Add `isImportWorkUnitStatus` helper:

```ts
function isImportWorkUnitStatus(value: string | null): value is ImportWorkUnitStatus {
  return value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "succeeded_with_issues" ||
    value === "failed" ||
    value === "skipped" ||
    value === "cancelled";
}
```

- [ ] **Step 2: Add daemon client methods**

In `src/app/daemonClient.ts`, add:

```ts
export async function listImportWorkUnits(
  baseUrl: string,
  importJobId: string,
  options: { limit?: number; offset?: number; status?: string } = {}
): Promise<{ units: ImportWorkUnitDto[]; limit: number; offset: number }> {
  const url = new URL(baseUrl);
  url.pathname = `/imports/${encodeURIComponent(importJobId)}/units`;
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.offset) url.searchParams.set("offset", String(options.offset));
  if (options.status) url.searchParams.set("status", options.status);
  const response = await fetch(url.toString(), { headers: jsonHeaders });
  if (!response.ok) throw new Error(`import work units request failed: ${response.status}`);
  return (await response.json()) as { units: ImportWorkUnitDto[]; limit: number; offset: number };
}
```

- [ ] **Step 3: Write progress panel test**

Create `src/ui/sources/__tests__/ImportProgressPanel.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ImportProgressPanel } from "../ImportProgressPanel";

describe("ImportProgressPanel", () => {
  test("shows heartbeat, rate, child units, and grouped failures", () => {
    const html = renderToStaticMarkup(
      <ImportProgressPanel
        failureGroups={[
          {
            code: "malformed_json",
            count: 3,
            failureGroupId: "fg-1",
            failureKind: "malformed",
            firstSeenAt: "2026-07-01T00:00:00.000Z",
            importJobId: "job-1",
            lastSeenAt: "2026-07-01T00:01:00.000Z",
            message: "Malformed JSON.",
            retryable: false,
            runtime: "codex",
            samplePaths: ["/tmp/bad.jsonl"]
          }
        ]}
        job={{
          discoveredCount: 10,
          failureCount: 3,
          importJobId: "job-1",
          importKind: "transcript",
          importedCount: 7,
          processedCount: 10,
          progressCurrent: 10,
          queuedCount: 0,
          sourceId: "codex-sessions",
          status: "succeeded_with_issues",
          updatedAt: "2026-07-01T00:02:00.000Z",
          heartbeatAt: "2026-07-01T00:01:55.000Z",
          stage: "transcript",
          totalWorkUnits: 10,
          completedWorkUnits: 7,
          failedWorkUnits: 3,
          skippedWorkUnits: 0
        }}
        units={[
          {
            failedRecords: 0,
            importedRecords: 5,
            importJobId: "job-1",
            manifestId: "manifest-1",
            processedRecords: 5,
            runtime: "codex",
            skippedRecords: 0,
            sourceId: "codex-sessions:a.jsonl",
            sourcePath: "/tmp/a.jsonl",
            status: "succeeded",
            unitKind: "transcript_file",
            workUnitId: "unit-1"
          }
        ]}
      />
    );

    expect(html).toContain("transcript");
    expect(html).toContain("7 / 10 units");
    expect(html).toContain("Malformed JSON.");
    expect(html).toContain("/tmp/a.jsonl");
  });
});
```

- [ ] **Step 4: Implement progress panel**

Create `src/ui/sources/ImportProgressPanel.tsx`:

```tsx
import type { ImportJob } from "../../app/daemonClient";
import type { ImportFailureGroupDto, ImportWorkUnitDto } from "../../shared/sourceImport";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  job: ImportJob;
  units: ImportWorkUnitDto[];
  failureGroups: ImportFailureGroupDto[];
  now?: number;
};

export function ImportProgressPanel({ failureGroups, job, now = Date.now(), units }: Props) {
  const state = deriveVisibility(job, now);
  const totalUnits = job.totalWorkUnits ?? units.length;
  const doneUnits = (job.completedWorkUnits ?? 0) + (job.failedWorkUnits ?? 0) + (job.skippedWorkUnits ?? 0);
  return (
    <section className="import-progress-panel" aria-label="Import progress">
      <header>
        <div>
          <p className="mono-label">{job.importKind}</p>
          <h3>{job.stage ?? job.importKind}</h3>
        </div>
        <StatusBadge tone={state === "stalled" || state === "failed" ? "danger" : state.includes("issue") ? "warning" : "info"}>
          {state.replaceAll("_", " ")}
        </StatusBadge>
      </header>
      <dl className="import-progress-metrics">
        <Metric label="Records" value={`${job.processedCount ?? 0} / ${job.discoveredCount || "unknown"}`} />
        <Metric label="Imported" value={String(job.importedCount ?? 0)} />
        <Metric label="Units" value={`${doneUnits} / ${totalUnits || "unknown"} units`} />
        <Metric label="Heartbeat" value={formatRelative(job.heartbeatAt ?? job.updatedAt, now)} />
      </dl>
      <div className="import-work-unit-list">
        {units.slice(0, 8).map((unit) => (
          <article className={`import-work-unit import-work-unit-${unit.status}`} key={unit.workUnitId}>
            <span>{unit.status.replaceAll("_", " ")}</span>
            <strong>{unit.sourceSessionId ?? unit.sourcePath ?? unit.workUnitId}</strong>
            <small>{unit.processedRecords} records · {unit.importedRecords} imported · {unit.failedRecords} failed</small>
          </article>
        ))}
      </div>
      {failureGroups.length > 0 ? (
        <div className="import-failure-groups">
          {failureGroups.map((group) => (
            <article key={group.failureGroupId}>
              <strong>{group.message}</strong>
              <span>{group.count} {group.failureKind} failures</span>
              {group.samplePaths[0] ? <small>{group.samplePaths[0]}</small> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function deriveVisibility(job: ImportJob, now: number): string {
  if (job.status !== "running") return job.status;
  const heartbeat = new Date(job.heartbeatAt ?? job.updatedAt).getTime();
  return Number.isFinite(heartbeat) && now - heartbeat > 30_000 ? "stalled" : job.status;
}

function formatRelative(value: string | undefined, now: number): string {
  if (!value) return "never";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
```

- [ ] **Step 5: Implement completion report component**

Create `src/ui/sources/ImportCompletionReport.tsx`:

```tsx
import type { ImportCompletionReportDto } from "../../shared/sourceImport";
import { AppButton } from "../primitives/AppButton";

type Props = {
  report: ImportCompletionReportDto;
  onOpenLogbook?: () => void;
  onRetryFailed?: () => void;
};

export function ImportCompletionReport({ onOpenLogbook, onRetryFailed, report }: Props) {
  return (
    <section className="import-completion-report" aria-label="Import completion report">
      <header>
        <p className="mono-label">{report.runtime}</p>
        <h3>Import completed</h3>
        <span>{report.status.replaceAll("_", " ")}</span>
      </header>
      <dl className="import-completion-grid">
        <Metric label="Sessions" value={report.sessionsDiscovered} />
        <Metric label="Transcripts" value={report.transcriptsImported} />
        <Metric label="Records" value={report.recordsImported} />
        <Metric label="Failures" value={report.recordsFailed} />
        <Metric label="Logbook" value={report.logbookSearchableSessions} />
        <Metric label="Dossiers" value={report.dossierReadySessions} />
        <Metric label="Enriched" value={report.enrichedSessions} />
        <Metric label="MCP visible" value={report.mcpVisibleSessions} />
      </dl>
      <div className="surface-actions">
        {report.nextActions.includes("retry_failed_units") ? <AppButton type="button" onClick={onRetryFailed}>Retry failed units</AppButton> : null}
        {report.nextActions.includes("open_logbook") ? <AppButton type="button" variant="primary" onClick={onOpenLogbook}>Open Logbook</AppButton> : null}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
```

- [ ] **Step 6: Wire progress into ImportJobsTable**

In `src/ui/sources/ImportJobsTable.tsx`, update columns:

```tsx
<th>Stage</th>
<th>Progress</th>
<th>Heartbeat</th>
<th>Current path</th>
<th>Status</th>
<th>Action</th>
```

Render stage and heartbeat:

```tsx
<td>{job.stage ?? job.importKind}</td>
<td>{formatProgress(job)}{job.totalWorkUnits ? ` · ${job.completedWorkUnits ?? 0} / ${job.totalWorkUnits} units` : ""}</td>
<td>{formatTime(job.heartbeatAt ?? job.updatedAt)}</td>
```

Add `succeeded_with_issues` tone:

```ts
if (status === "succeeded_with_issues") return "warning";
```

- [ ] **Step 7: Add CSS**

Append to `src/styles/sources.css`:

```css
.import-progress-panel,
.import-completion-report {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(92, 153, 187, 0.17);
  border-radius: 5px;
  background: rgba(3, 16, 25, 0.42);
  padding: 14px;
}

.import-progress-panel header,
.import-completion-report header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.import-progress-panel h3,
.import-completion-report h3 {
  margin: 3px 0 0;
  color: var(--ink);
  font-size: 15px;
}

.import-progress-metrics,
.import-completion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin: 0;
}

.import-progress-metrics div,
.import-completion-grid div,
.import-work-unit,
.import-failure-groups article {
  border: 1px solid rgba(194, 221, 241, 0.1);
  border-radius: 4px;
  background: rgba(6, 25, 37, 0.58);
  padding: 9px;
}

.import-progress-metrics dt,
.import-completion-grid dt,
.import-work-unit span {
  color: var(--mute);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.import-progress-metrics dd,
.import-completion-grid dd {
  margin: 4px 0 0;
  color: var(--ink);
  font-family: var(--font-technical);
  font-size: 15px;
}

.import-work-unit-list,
.import-failure-groups {
  display: grid;
  gap: 8px;
}

.import-work-unit strong,
.import-failure-groups strong {
  display: block;
  margin-top: 3px;
  overflow-wrap: anywhere;
  color: var(--ink);
}

.import-work-unit small,
.import-failure-groups small,
.import-failure-groups span {
  display: block;
  margin-top: 3px;
  color: var(--mute);
}

.import-work-unit-failed {
  border-color: rgba(255, 77, 77, 0.34);
}

.import-work-unit-succeeded_with_issues,
.import-work-unit-skipped {
  border-color: rgba(247, 201, 72, 0.32);
}
```

- [ ] **Step 8: Run UI tests**

Run:

```bash
npm test -- --run src/ui/sources/__tests__/ImportProgressPanel.test.tsx src/ui/sources/__tests__/ImportCompletionReport.test.tsx src/ui/sources/__tests__/ImportJobsTable.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/sources/ImportProgressPanel.tsx src/ui/sources/ImportCompletionReport.tsx src/ui/sources/ImportJobsTable.tsx src/app/daemonClient.ts src/daemon/server.ts src/styles/sources.css src/ui/sources/__tests__/ImportProgressPanel.test.tsx src/ui/sources/__tests__/ImportCompletionReport.test.tsx src/ui/sources/__tests__/ImportJobsTable.test.tsx
git commit -m "feat: show import progress and completion reports"
```

---

## Task 11: Non-Blocking Enrichment Jobs

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/import/importCompletionReport.ts`
- Test: `src/daemon/import/__tests__/backgroundImport.test.ts`

- [ ] **Step 1: Add test for non-blocking enrichment**

In `src/daemon/import/__tests__/backgroundImport.test.ts`, add:

```ts
test("transcript import can complete while enrichment remains queued", async () => {
  const importResult = await runTranscriptImportFixture({
    queueEnrichment: true,
    transcriptApproved: true
  });

  expect(importResult.job.status === "succeeded" || importResult.job.status === "succeeded_with_issues").toBe(true);
  expect(importResult.job.completionReport).toMatchObject({
    nextActions: expect.arrayContaining(["run_enrichment"])
  });
});
```

If `runTranscriptImportFixture` does not exist, use the existing background import fixture setup in the file and assert against `/imports`.

- [ ] **Step 2: Run failing or incomplete test**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/backgroundImport.test.ts
```

Expected: FAIL until completion report and enrichment queue semantics are aligned.

- [ ] **Step 3: Keep enrichment outside import status**

In `src/daemon/server.ts`, keep existing `queueSessionEnrichment(sessionId)` calls, but ensure transcript import result does not wait on `flushEnrichmentQueue`.

When creating completion reports, count enrichment as coverage only:

```ts
const nextActions = new Set<ImportCompletionReportDto["nextActions"][number]>();
if (enriched.sessions < runtimeSessionStats.sessions) nextActions.add("run_enrichment");
if (failedUnits > 0) nextActions.add("retry_failed_units");
if (scope.kind !== "all") nextActions.add("import_full_archive");
nextActions.add("open_logbook");
```

Do not mark import job `running` while enrichment is still running.

- [ ] **Step 4: Make visible enrichment jobs optional**

If Sources needs visible enrichment progress in this slice, queue an `enrichment` import job after transcript import:

```ts
if (request.queueEnrichment) {
  jobs.push(queueImportJob(database, { importKind: "enrichment", sourceId: parentSource.sourceId }, async () => {
    const result = emptyImportResult();
    const sessionIds = listSessionsMissingEnrichment(database, runtime);
    for (const sessionId of sessionIds) {
      await enrichment.ensureCurrent(sessionId);
      result.processedCount += 1;
      result.importedCount += 1;
    }
    return result;
  }));
}
```

Keep this job separate from transcript import.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- --run src/daemon/import/__tests__/backgroundImport.test.ts src/enrichment/__tests__/sessionCompiler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/server.ts src/daemon/import/importCompletionReport.ts src/daemon/import/__tests__/backgroundImport.test.ts
git commit -m "feat: keep enrichment separate from import completion"
```

---

## Task 12: Adapter Dogfood Verification For Codex, Hermes, Cursor, Antigravity, And OMP

**Files:**
- Modify: `src/adapters/hermes/*` if schema probe gaps are found
- Modify: `src/adapters/cursor/*` if schema probe gaps are found
- Modify: `src/adapters/antigravity/*` if schema probe gaps are found
- Modify: `src/adapters/harnessCatalog.ts` only if OMP support level changes based on verified schema
- Test: existing adapter tests plus new adapter-specific tests as needed

- [ ] **Step 1: Run bounded scan without importing content**

Run:

```bash
npm run dev
```

In another shell:

```bash
curl -s http://127.0.0.1:17373/sources/setup | jq '.advanced.adapters[] | {runtime,state,implementationState,discoveredSessions,sourceLocationCount,diagnostics}'
```

Expected: Codex, Hermes, Cursor, and Antigravity should appear according to local state. OMP may appear as detector-only unless its schema is recognized.

- [ ] **Step 2: Verify manifest preview for Codex**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="codex")'
```

Expected: Codex scan shows detected local history. It must not require Tyler to select `~/.codex/sessions`.

- [ ] **Step 3: Verify Hermes scan volume and schema state**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="hermes") | {runtime,state,summary,diagnostics}'
```

Expected: Hermes is either importable with recognized schema or degraded with clear schema diagnostics. It must not create fake transcript sessions if schema probing fails.

- [ ] **Step 4: Verify Cursor scan volume and schema state**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="cursor") | {runtime,state,summary,diagnostics}'
```

Expected: Cursor is either importable with recognized SQLite/workspace schema or degraded with clear diagnostics.

- [ ] **Step 5: Verify Antigravity scan volume and schema state**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="antigravity") | {runtime,state,summary,diagnostics}'
```

Expected: Antigravity is metadata-capable if current schema probes recognize it. If old local data is too old, Sources shows "schema not recognized" with repair/report details.

- [ ] **Step 6: Verify OMP detector-only behavior**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="omp") | {runtime,state,summary,diagnostics}'
```

Expected: OMP remains detector-only unless a local schema is verified and mapped. The UI must say detected, import blocked because schema is not recognized, instead of pretending import support exists.

- [ ] **Step 7: Add adapter tests only for verified schemas**

If a schema is verified for Hermes, Cursor, Antigravity, or OMP, add fixture tests matching existing adapter test style. Example for OMP only if schema is recognized:

```ts
test("imports OMP local transcript records when schema is recognized", async () => {
  const source = await writeOmpFixture(tempDir, [
    { session_id: "omp-1", role: "user", content: "hello", created_at: "2026-07-01T00:00:00.000Z" }
  ]);
  const records = [];
  for await (const record of ompAdapter.backfill(source)) records.push(record);
  expect(records).toEqual([
    expect.objectContaining({
      normalized: expect.objectContaining({
        kind: "message",
        value: expect.objectContaining({ sessionId: "omp-1" })
      })
    })
  ]);
});
```

- [ ] **Step 8: Run adapter test suite**

Run:

```bash
npm test -- --run src/adapters/__tests__/registry.test.ts src/adapters/__tests__/harnessCatalog.test.ts src/adapters/hermes src/adapters/cursor src/adapters/antigravity
```

If OMP is promoted from detector-only, also run:

```bash
npm test -- --run src/adapters/omp
```

Expected: PASS for recognized schemas. Detector-only harnesses must remain visible but not importable.

- [ ] **Step 9: Commit**

```bash
git add src/adapters src/daemon/sources docs/acceptance/sources-onboarding-evidence.md
git commit -m "test: verify local harness import adapters"
```

---

## Task 13: Documentation And Acceptance Evidence

**Files:**
- Modify: `docs/reference/sources.md`
- Modify: `docs/how-to/import-codex-history.md`
- Modify: `docs/tutorials/first-run-codex-import.md`
- Modify: `docs/acceptance/sources-onboarding-evidence.md`
- Modify: `docs/superpowers/evidence/sources-import-grillme.html` if final visual needs one more update

- [ ] **Step 1: Update Sources reference**

In `docs/reference/sources.md`, replace setup flow with:

```md
## Setup Flow

1. Scan this computer. Masthead checks known local coding-harness stores and configured overrides.
2. Choose coding harnesses such as Codex, Hermes, Cursor, or Antigravity.
3. Import metadata. This creates canonical session shells and makes Logbook useful quickly.
4. Approve transcript import for the selected coding harnesses.
5. Choose import age: changed sessions plus last 30 days, or full local archive.
6. Review the manifest preview. It shows child units, estimated size, skipped units, and exclusions.
7. Start transcript import. The queue shows stage, current path, heartbeat, child units, grouped failures, cancel, retry, and completion reports.
8. Enrichment runs separately and does not block import completion.
```

Add:

```md
## Import Outcomes

- `succeeded`: all included child units completed.
- `succeeded_with_issues`: useful records were imported and one or more child units failed or had skipped records.
- `failed`: the job could not safely proceed or imported no useful records.
- `stalled`: derived UI state when a running job has not sent a heartbeat for 30 seconds.
```

- [ ] **Step 2: Update Codex how-to**

In `docs/how-to/import-codex-history.md`, update transcript commands:

```bash
curl -X POST http://127.0.0.1:17373/adapters/codex/approve-transcripts
curl -X POST http://127.0.0.1:17373/sources/setup/run \
  -H 'content-type: application/json' \
  -d '{"runtimes":["codex"],"importMetadata":true,"importTranscripts":true,"transcriptApproved":true,"importScope":{"mode":"transcript_recent","days":30,"includeChangedSinceCursor":true,"unitLimit":500},"queueEnrichment":true}'
```

Add:

```bash
curl http://127.0.0.1:17373/imports
curl http://127.0.0.1:17373/imports/<importJobId>/units
curl http://127.0.0.1:17373/imports/<importJobId>/report
```

- [ ] **Step 3: Update acceptance evidence**

In `docs/acceptance/sources-onboarding-evidence.md`, add checklist:

```md
## Visible Import Acceptance

- [ ] The primary modal asks for coding harness and import age, not local storage paths.
- [ ] Metadata import creates Logbook session shells before transcript import.
- [ ] Transcript import requires coding-harness approval.
- [ ] The 30-day default shows manifest counts before parsing.
- [ ] Running jobs show current stage, current path, heartbeat, child-unit counts, and grouped failures.
- [ ] A child-unit failure does not hide successful imports.
- [ ] Parent jobs can finish as `succeeded_with_issues`.
- [ ] Completion report shows sessions, transcripts, records, failures, Logbook coverage, dossier coverage, enrichment coverage, and MCP coverage.
- [ ] Full archive import is an explicit long-running action.
- [ ] Source paths are visible in advanced diagnostics and repair views.
```

- [ ] **Step 4: Run docs search for forbidden product wording**

Run:

```bash
rg -n "monitoring console|supervision tower|analytics dashboard|select folder|local storage path" docs/reference/sources.md docs/how-to/import-codex-history.md docs/tutorials/first-run-codex-import.md docs/acceptance/sources-onboarding-evidence.md
```

Expected: No matches that describe the primary flow incorrectly. If `local storage path` appears only in advanced diagnostics context, keep it.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/sources.md docs/how-to/import-codex-history.md docs/tutorials/first-run-codex-import.md docs/acceptance/sources-onboarding-evidence.md docs/superpowers/evidence/sources-import-grillme.html
git commit -m "docs: document visible sources import flow"
```

---

## Task 14: End-To-End Verification

**Files:**
- No source edits unless tests expose issues from this plan.

- [ ] **Step 1: Run focused automated tests**

Run:

```bash
npm test -- --run src/daemon/import src/daemon/sources src/ui/sources src/core/__tests__/ingestServer.test.ts src/app/__tests__/daemonClient.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run verify:no-citations
```

Expected: PASS.

- [ ] **Step 3: Start Masthead**

Run:

```bash
npm run dev
```

Expected: launcher starts daemon and UI. If a primary connector is already running, the worktree bridge starts automatically.

- [ ] **Step 4: Inspect Sources in the in-app Browser**

Use the Codex in-app Browser plugin against the printed UI URL. Check desktop, tablet, and narrow mobile widths.

Expected:

- Sources opens with existing Masthead visual language.
- The import modal is visually based on session dossier modal materials but simpler.
- Buttons use `AppButton`.
- Harness cards use restrained Sources card styling.
- The primary flow asks for coding harness and import age.
- Source folders are not primary choices.
- Running jobs show stage, current path, heartbeat, work units, and grouped failures.
- Completion report answers what Masthead gained.
- Text fits in narrow mobile widths.

- [ ] **Step 5: Dogfood Codex recent import**

Run from UI or API:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/run \
  -H 'content-type: application/json' \
  -d '{"runtimes":["codex"],"importMetadata":true,"importTranscripts":true,"transcriptApproved":true,"importScope":{"mode":"transcript_recent","days":30,"includeChangedSinceCursor":true,"unitLimit":500},"queueEnrichment":true}' | jq
```

Then:

```bash
curl -s http://127.0.0.1:17373/imports | jq '.imports[0]'
```

Expected: job includes stage, heartbeat, scope, work-unit counts, and a terminal report after completion.

- [ ] **Step 6: Dogfood full archive preview without starting it**

Use the UI modal to choose `Full local archive`.

Expected: the modal labels it as long-running and does not start until explicit action.

- [ ] **Step 7: Verify real harness diagnostics**

Run:

```bash
curl -s -X POST http://127.0.0.1:17373/sources/setup/scan | jq '.scan.adapters[] | select(.runtime=="codex" or .runtime=="hermes" or .runtime=="cursor" or .runtime=="antigravity" or .runtime=="omp") | {runtime,state,summary,diagnostics}'
```

Expected:

- Codex is importable.
- Hermes, Cursor, and Antigravity either import or show precise diagnostics.
- OMP is detector-only unless schema was verified.
- No adapter creates fake successful sessions for unrecognized schemas.

- [ ] **Step 8: Verify Logbook and dossier outcomes**

Open Logbook and search for known recent Codex, Hermes, Cursor, or Antigravity sessions.

Expected:

- Metadata-only sessions show as shells with visible coverage limits.
- Transcript-imported sessions show richer dossier evidence.
- Enrichment coverage improves after the enrichment job.

- [ ] **Step 9: Commit final verification fixes**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize visible sources import flow"
```

If no fixes were required, do not create an empty commit.

---

## Recommended First Implementation Slice

Build these first, in order:

1. Task 1: Shared DTOs.
2. Task 2: Durable import ledger.
3. Task 4: Manifest builder.
4. Task 5: Parent job visibility.
5. Task 6: Codex transcript work-unit execution.
6. Task 7: Completion report proof from persisted impact rows.
7. Task 8: Harness-first server and client APIs, including manifest preview.
8. Task 9: Simplified modal shell with preview counts.
9. Task 10: Progress panel and completion report UI.

That slice proves the core trust fix: Tyler can start a Codex import, see the manifest before approving scope, watch real child units execute, and get a report grounded in persisted session impact rows. After that, add Task 12 broader harness verification for Hermes, Cursor, Antigravity, and OMP.

## Self-Review

- Spec coverage: The plan covers harness-first UI, metadata-first import, transcript consent, age-window selection, manifest preview, durable child units, heartbeat, stalled state, partial success, completion reports, enrichment separation, canonical dedupe, adapter verification, documentation, and browser verification.
- Placeholder scan: The plan contains concrete file paths, SQL, TypeScript snippets, commands, expected outcomes, and no placeholder implementation sections.
- Type consistency: Shared DTO names match later UI, daemon client, repository, and server usage: `ImportScopeDto`, `ImportManifestSummaryDto`, `ImportWorkUnitDto`, `ImportFailureGroupDto`, and `ImportCompletionReportDto`.
