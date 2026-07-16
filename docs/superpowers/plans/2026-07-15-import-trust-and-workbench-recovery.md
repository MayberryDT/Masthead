# Import Trust and Workbench Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recent history imports produce complete, correctly identified canonical sessions; keep parser failures out of Not Added; conservatively suppress only confirmed noise; and provide a safe, provenance-scoped repair path for the current test import.

**Architecture:** Add a transcript-unit seam where harness adapters plan and parse complete source units before canonical ingestion. Import scope, structural validity, and content quality become separate decisions: the importer owns range and parse health, Workbench owns conservative noise suppression, and the agent owns artifact judgment. A provenance-scoped repair module previews and rebuilds only sessions created by selected import jobs.

**Tech Stack:** TypeScript 5.9, Node.js 24, SQLite, React 19, Vitest, Electron/Vite.

## Global Constraints

- Do not rebuild, reinstall, restart, or otherwise change the production Masthead application unless Tyler separately authorizes it.
- Do not read, migrate, repair, or mutate the 6.6 GB production database during implementation or verification.
- Use isolated temporary databases and sanitized real-format fixtures for every automated test and replay.
- Preserve Masthead's product hierarchy: canonical session database → Workbench → published-artifact Logbook → read-only MCP.
- Not Added may represent only a content decision made from a structurally complete import; schema drift, missing identity, partial parsing, and range deferral are import states.
- Optional runbook, ADR, and incident-timeline creation remains agent-chosen. Deterministic code may filter confirmed noise but must not decide which artifacts a session deserves.
- A fresh recent import must not include old units merely because no cursor exists.
- Automatic suppression must be reversible when the evidence revision changes; manual exclusion remains sticky.
- Every task follows red → green TDD and ends with a focused commit.

---

## File and Module Map

### New files

- `src/adapters/transcriptUnits.ts` — transcript-unit planning/parsing interfaces and shared invariants.
- `src/adapters/grok/transcriptUnit.ts` — Grok conversation-directory planner and parser.
- `src/adapters/hermes/transcriptUnit.ts` — Hermes JSON/JSONL/SQLite session parser and tool normalization.
- `src/adapters/__fixtures__/grok/019f42f6-8ada-7001-afff-c722e75faf45/chat_history.jsonl` — sanitized real-shape Grok conversation-directory fixture.
- `src/adapters/__fixtures__/hermes/session.jsonl` — sanitized real-shape Hermes tool-work fixture.
- `src/adapters/__tests__/grokAdapter.test.ts` — Grok identity and record-kind contract tests.
- `src/daemon/db/sessionImportHealthRepository.ts` — session parse-health persistence.
- `src/daemon/db/migrations/025_import_unit_scope.sql` — semantic timestamp, timestamp basis, and scope-reason fields.
- `src/daemon/db/migrations/026_session_import_health.sql` — session-level parse-health state.
- `src/daemon/db/migrations/027_workbench_suppression_provenance.sql` — reversible automatic-suppression metadata.
- `src/daemon/import/importScope.ts` — pure recent-range and incremental-refresh decisions.
- `src/daemon/import/importAnomalyDetector.ts` — deterministic import-shape anomaly checks.
- `src/daemon/import/importRepair.ts` — dry-run/apply repair plan scoped to import-job provenance.
- `src/daemon/import/__tests__/importAnomalyDetector.test.ts` — anomaly contract tests.
- `src/daemon/import/__tests__/importRepair.test.ts` — repair preview and isolated-apply tests.
- `src/cli/importRepair.ts` — CLI adapter for repair preview/apply.

### Existing files changed

- `src/adapters/types.ts` — expose transcript-unit planning/parsing on `SessionAdapter`.
- `src/adapters/generic/localAdapterFactory.ts` — generic file-unit fallback without record-ID session fallback.
- `src/adapters/grok/adapter.ts` — use the Grok transcript-unit implementation.
- `src/adapters/hermes/adapter.ts` — use the Hermes transcript-unit implementation.
- `src/adapters/__tests__/hermesAdapter.test.ts` — assert structured Hermes tool evidence and identity merging.
- `src/daemon/import/importManifestService.ts` — use planned semantic activity and correct recent-range behavior.
- `src/daemon/import/importWorkUnitRunner.ts` — parse/validate a complete unit before ingest and quality reconciliation.
- `src/daemon/import/importCompletionReport.ts` — report sessions, rejected records, repair counts, timestamp basis, and cap state.
- `src/daemon/db/importLedgerRepository.ts` — persist transcript-unit metadata and normalization result.
- `src/daemon/db/workbenchPipelineRepository.ts` — persist suppression category/source/evidence revision and reopen automatic decisions.
- `src/workbench/qualityPrecheck.ts` — replace raw conversation-count gating with conservative semantic evidence.
- `src/workbench/transcriptQualityReconciler.ts` — refuse quality decisions for incomplete imports and reopen stale automatic suppression.
- `src/shared/sourceImport.ts` — shared transcript-unit/import receipt DTOs.
- `src/shared/workbench.ts` — shared import-health and suppression DTOs.
- `src/daemon/server.ts` — wire adapter unit planning/parsing, import-health reads, repair routes, and enhanced reports.
- `src/app/daemonClient.ts` — typed reads for import repair/status and enhanced receipts.
- `src/ui/sources/ImportCompletionReport.tsx` — show trustworthy per-harness import outcomes.
- `src/ui/SidebarImportActivity.tsx` — distinguish completed, capped, and repair-required imports.
- `src/ui/workbench/WorkbenchPanel.tsx` — keep import repair separate from Not Added.
- `src/cli/mastheadctl.ts` — register `import repair preview|apply`.
- `openwiki/logbook-and-workbench.md` — document import-health versus content-quality ownership.
- `openwiki/data-and-integrations.md` — document transcript-unit and recent-range behavior.
- `docs/reference/daemon-api.md` — document enhanced import reports and repair endpoints.

---

### Task 1: Lock the Real Failure Shapes into Adapter Fixtures

**Files:**
- Create: `src/adapters/__fixtures__/grok/019f42f6-8ada-7001-afff-c722e75faf45/chat_history.jsonl`
- Create: `src/adapters/__fixtures__/hermes/session.jsonl`
- Create: `src/adapters/__tests__/grokAdapter.test.ts`
- Modify: `src/adapters/__tests__/hermesAdapter.test.ts`

**Interfaces:**
- Consumes: current `SessionAdapter.backfill(source, cursor)`.
- Produces: failing corpus tests that assert canonical session identity and normalized evidence kinds before implementation changes.

- [ ] **Step 1: Add the sanitized Grok fixture with record IDs only on reasoning rows**

```jsonl
{"type":"system","content":"You are a coding agent."}
{"type":"user","content":"Fix the import range bug."}
{"type":"reasoning","id":"rs_fixture_001","summary":"Inspect the recent-range predicate.","status":"completed"}
{"type":"assistant","content":"I found the cursor fallback bug.","tool_calls":[{"id":"call_fixture_001","name":"read_file","arguments":{"path":"src/daemon/import/importManifestService.ts"}}]}
{"type":"tool_result","tool_call_id":"call_fixture_001","content":"includeUnit returns true when no cursor exists"}
```

- [ ] **Step 2: Add the sanitized Hermes fixture with conversational and tool-role rows**

```jsonl
{"role":"session_meta","timestamp":"2026-07-10T10:00:00.000Z","model":"gpt-5"}
{"role":"user","timestamp":"2026-07-10T10:00:01.000Z","content":"Repair the parser."}
{"role":"assistant","timestamp":"2026-07-10T10:00:02.000Z","content":"I will inspect the adapter."}
{"role":"tool","timestamp":"2026-07-10T10:00:03.000Z","tool_call_id":"tool_fixture_001","name":"read_file","arguments":{"path":"src/adapters/hermes/adapter.ts"}}
{"role":"tool","timestamp":"2026-07-10T10:00:04.000Z","tool_call_id":"tool_fixture_001","content":"export const hermesAdapter = createLocalAdapter(options)","status":"success"}
{"role":"assistant","timestamp":"2026-07-10T10:00:05.000Z","content":"The tool evidence is now structured."}
```

- [ ] **Step 3: Write the failing Grok identity test**

Add local test helpers that collect an `AsyncIterable<AdapterRecord>` and extract `sessionId` from normalized values. Point `grokFixtureSource()` at the UUID-named fixture directory above; point `hermesFixtureSource()` at the Hermes fixture file. Keep these helpers in the test files rather than adding production exports solely for tests.

```ts
test("groups one Grok conversation file under the directory session id", async () => {
  const records = await collect(grokAdapter.backfill(grokFixtureSource()));
  const sessionIds = new Set(records.flatMap(normalizedSessionIds));

  expect(sessionIds).toEqual(new Set(["019f42f6-8ada-7001-afff-c722e75faf45"]));
  expect(records.filter((record) => record.normalized.kind === "message")).toHaveLength(3);
  expect(records.filter((record) => record.normalized.kind === "tool_call")).toHaveLength(1);
  expect(records.filter((record) => record.normalized.kind === "tool_result")).toHaveLength(1);
  expect(records.some((record) => normalizedSessionIds(record).includes("rs_fixture_001"))).toBe(false);
});
```

- [ ] **Step 4: Write the failing Hermes tool-evidence test**

```ts
test("normalizes Hermes tool-role rows as tool calls and results", async () => {
  const records = await collect(hermesAdapter.backfill(hermesFixtureSource()));

  expect(records.filter((record) => record.normalized.kind === "message")).toHaveLength(3);
  expect(records.filter((record) => record.normalized.kind === "tool_call")).toHaveLength(1);
  expect(records.filter((record) => record.normalized.kind === "tool_result")).toHaveLength(1);
  expect(new Set(records.flatMap(normalizedSessionIds))).toEqual(new Set(["20260710_100000_fixture"]));
});
```

- [ ] **Step 5: Run the tests and verify both fail on the diagnosed behavior**

Run:

```bash
npx vitest --run src/adapters/__tests__/grokAdapter.test.ts src/adapters/__tests__/hermesAdapter.test.ts
```

Expected: FAIL because Grok creates `rs_fixture_001` as a session and Hermes returns tool-role rows as messages.

- [ ] **Step 6: Commit the red corpus**

```bash
git add src/adapters/__fixtures__ src/adapters/__tests__/grokAdapter.test.ts src/adapters/__tests__/hermesAdapter.test.ts
git commit -m "test: capture real Grok and Hermes import failures"
```

---

### Task 2: Define the Transcript-Unit Seam

**Files:**
- Create: `src/adapters/transcriptUnits.ts`
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/generic/localAdapterFactory.ts`
- Test: `src/adapters/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `DiscoveredSource`, `IngestCursor`, `AdapterRecord`, and existing adapter discovery.
- Produces: `TranscriptUnitPlan`, `ParsedTranscriptUnit`, `SessionAdapter.planTranscriptUnits`, and `SessionAdapter.parseTranscriptUnit`.

- [ ] **Step 1: Write the failing registry contract test**

```ts
test("every transcript-import adapter exposes the transcript-unit interface", () => {
  for (const adapter of scanAdapters) {
    expect(adapter.planTranscriptUnits, adapter.runtime).toBeTypeOf("function");
    expect(adapter.parseTranscriptUnit, adapter.runtime).toBeTypeOf("function");
  }
});
```

- [ ] **Step 2: Run the registry test and verify it fails**

Run:

```bash
npx vitest --run src/adapters/__tests__/registry.test.ts
```

Expected: FAIL because the transcript-unit methods do not exist.

- [ ] **Step 3: Add the shared transcript-unit types**

```ts
import type { AdapterDiagnostic, AdapterRecord, DiscoveredSource, IngestCursor, RuntimeKind } from "./types.ts";

export type TranscriptTimestampBasis = "semantic" | "source_path" | "file_modified" | "unknown";
export type TranscriptUnitCompleteness = "complete" | "partial" | "unrecognized";

export type TranscriptUnitPlan = {
  runtime: RuntimeKind;
  source: DiscoveredSource;
  unitId: string;
  sourceSessionId?: string;
  semanticActivityAt?: string;
  timestampBasis: TranscriptTimestampBasis;
  fileSizeBytes?: number;
  modifiedAt?: string;
};

export type ParsedTranscriptUnit = {
  unit: TranscriptUnitPlan;
  completeness: TranscriptUnitCompleteness;
  records: AdapterRecord[];
  diagnostics: AdapterDiagnostic[];
  sourceSessionIds: string[];
  firstActivityAt?: string;
  lastActivityAt?: string;
};

export type TranscriptUnitAdapter = {
  planTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]>;
  parseTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit>;
};

export function parsedUnitIsFinalizable(unit: ParsedTranscriptUnit): boolean {
  return unit.completeness === "complete" && unit.sourceSessionIds.length > 0 && unit.records.length > 0;
}
```

- [ ] **Step 4: Extend `SessionAdapter` with the required interface**

```ts
export interface SessionAdapter extends TranscriptUnitAdapter {
  readonly runtime: RuntimeKind;
  discover(context: DiscoveryContext): Promise<DiscoveredSource[]>;
  inspect(source: DiscoveredSource): Promise<SourceInventory>;
  backfill(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord>;
  watch(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord>;
  openSource?(session: CanonicalSession): Promise<OpenSourceTarget | undefined>;
}
```

- [ ] **Step 5: Give generic local adapters a one-file unit implementation**

The generic implementation must derive `unitId` from the source path, use file modification time only as an explicit fallback, collect the existing backfill output, and set completeness to `partial` when any error diagnostic is present.

```ts
planTranscriptUnits: (source) => planLocalTranscriptFiles(source),
parseTranscriptUnit: async (unit, cursor) => {
  const records = await collectAdapterRecords(backfillLocalSource(unit.source, cursor, options));
  const diagnostics = records.flatMap((record) => record.diagnostics);
  const sourceSessionIds = distinctNormalizedSessionIds(records);
  return {
    unit,
    completeness: diagnostics.some((item) => item.severity === "error")
      ? "unrecognized"
      : diagnostics.length > 0
        ? "partial"
        : "complete",
    records,
    diagnostics,
    sourceSessionIds,
    firstActivityAt: minimumObservedAt(records),
    lastActivityAt: maximumObservedAt(records)
  };
}
```

- [ ] **Step 6: Run registry and existing adapter tests**

Run:

```bash
npx vitest --run src/adapters/__tests__/registry.test.ts src/adapters/__tests__/codexAdapter.test.ts src/adapters/__tests__/ompAdapter.test.ts src/adapters/__tests__/hermesAdapter.test.ts
```

Expected: PASS for the interface and no regression in existing adapter behavior. The red Grok/Hermes evidence-kind tests from Task 1 remain red.

- [ ] **Step 7: Commit the seam**

```bash
git add src/adapters/transcriptUnits.ts src/adapters/types.ts src/adapters/generic/localAdapterFactory.ts src/adapters/__tests__/registry.test.ts
git commit -m "refactor: add transcript unit adapter seam"
```

---

### Task 3: Make Recent Imports Respect the Requested Range

**Files:**
- Create: `src/daemon/import/importScope.ts`
- Modify: `src/daemon/import/importManifestService.ts`
- Modify: `src/shared/sourceImport.ts`
- Modify: `src/daemon/db/importLedgerRepository.ts`
- Create: `src/daemon/db/migrations/025_import_unit_scope.sql`
- Test: `src/daemon/import/__tests__/importManifestService.test.ts`
- Test: `src/daemon/import/__tests__/importLedgerRepository.test.ts`

**Interfaces:**
- Consumes: `TranscriptUnitPlan`, `ImportScopeDto`, optional existing cursor.
- Produces: `decideImportUnitScope(input): ImportUnitScopeDecision`, persisted semantic timestamp and timestamp basis.

- [ ] **Step 1: Write the failing fresh-import test**

```ts
test("fresh recent import excludes old files when no cursor exists", async () => {
  const plan = await buildImportManifestPlan({
    cursors: new Map(),
    generatedAt: "2026-07-15T00:00:00.000Z",
    importJobId: "recent-fresh",
    importKind: "transcript",
    runtime: "hermes",
    scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
    sources: [oldHermesSource]
  });

  expect(plan.summary.includedUnits).toBe(0);
  expect(plan.units[0]).toMatchObject({ status: "skipped", statusReason: "Outside selected import age." });
});
```

- [ ] **Step 2: Write the incremental-refresh test**

```ts
test("changed old source refreshes only when a prior cursor exists", () => {
  expect(decideImportUnitScope({ unit: oldChangedUnit, cursor: undefined, generatedAt, scope })).toEqual({
    include: false,
    reason: "outside_recent_range"
  });
  expect(decideImportUnitScope({ unit: oldChangedUnit, cursor: oldCursor, generatedAt, scope })).toEqual({
    include: true,
    reason: "changed_since_cursor"
  });
});
```

- [ ] **Step 3: Run the tests and verify the no-cursor case fails**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importManifestService.test.ts
```

Expected: FAIL because `includeUnit` currently returns true for an old unit without a cursor.

- [ ] **Step 4: Implement the pure scope decision**

```ts
export type ImportUnitScopeDecision = {
  include: boolean;
  reason: "full_archive" | "inside_recent_range" | "changed_since_cursor" | "outside_recent_range";
};

export function decideImportUnitScope(input: {
  unit: Pick<TranscriptUnitPlan, "modifiedAt" | "semanticActivityAt">;
  cursor?: IngestCursor;
  generatedAt: string;
  scope: ImportScopeDto;
}): ImportUnitScopeDecision {
  if (input.scope.mode === "metadata_all" || input.scope.mode === "transcript_full" || input.scope.mode === "enrichment_missing") {
    return { include: true, reason: "full_archive" };
  }
  const candidateAt = input.unit.semanticActivityAt ?? input.unit.modifiedAt;
  const cutoff = Date.parse(input.generatedAt) - (input.scope.days ?? 30) * 86_400_000;
  if (candidateAt && Date.parse(candidateAt) >= cutoff) return { include: true, reason: "inside_recent_range" };
  if (!input.scope.includeChangedSinceCursor || !input.cursor) return { include: false, reason: "outside_recent_range" };
  const changed = Boolean(
    input.unit.modifiedAt && input.cursor.modifiedAt && input.unit.modifiedAt !== input.cursor.modifiedAt
  );
  return changed
    ? { include: true, reason: "changed_since_cursor" }
    : { include: false, reason: "outside_recent_range" };
}
```

- [ ] **Step 5: Persist scope evidence on each work unit**

Migration additions:

```sql
ALTER TABLE import_work_units ADD COLUMN semantic_activity_at TEXT;
ALTER TABLE import_work_units ADD COLUMN timestamp_basis TEXT NOT NULL DEFAULT 'unknown'
  CHECK (timestamp_basis IN ('semantic', 'source_path', 'file_modified', 'unknown'));
ALTER TABLE import_work_units ADD COLUMN scope_reason TEXT;
```

Add `semanticActivityAt`, `timestampBasis`, and `scopeReason` to `ImportWorkUnitDto` and the repository row mapping.

- [ ] **Step 6: Keep the unit cap explicit in the manifest**

Add `cappedUnits` to `ImportManifestSummaryDto`. Increment it only for units deferred by `unitLimit`; do not include outside-range units in that count.

```ts
expect(plan.summary).toMatchObject({
  includedUnits: 500,
  cappedUnits: 300,
  excludedUnits: 300,
  totalUnits: 800
});
```

- [ ] **Step 7: Run manifest and ledger tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importManifestService.test.ts src/daemon/import/__tests__/importLedgerRepository.test.ts
```

Expected: PASS; a fresh recent import no longer includes old units, changed old units require a real cursor, and cap totals reconcile.

- [ ] **Step 8: Commit recent-range semantics**

```bash
git add src/daemon/import/importScope.ts src/daemon/import/importManifestService.ts src/shared/sourceImport.ts src/daemon/db/importLedgerRepository.ts src/daemon/db/migrations/025_import_unit_scope.sql src/daemon/import/__tests__/importManifestService.test.ts src/daemon/import/__tests__/importLedgerRepository.test.ts
git commit -m "fix: enforce recent import range before cursor refresh"
```

---

### Task 4: Implement the Grok Conversation Adapter

**Files:**
- Create: `src/adapters/grok/transcriptUnit.ts`
- Modify: `src/adapters/grok/adapter.ts`
- Modify: `src/adapters/__tests__/grokAdapter.test.ts`
- Test fixture: `src/adapters/__fixtures__/grok/chat_history.jsonl`

**Interfaces:**
- Consumes: `TranscriptUnitAdapter`, Grok conversation-directory layout.
- Produces: one `ParsedTranscriptUnit` per Grok conversation directory with stable directory identity and structured evidence.

- [ ] **Step 1: Add failing tests for directory identity, record mapping, and unknown auxiliary rows**

```ts
expect(parsed.sourceSessionIds).toEqual(["019f42f6-8ada-7001-afff-c722e75faf45"]);
expect(parsed.records.map((record) => record.normalized.kind)).toEqual([
  "message",
  "message",
  "checkpoint",
  "message",
  "tool_call",
  "tool_result"
]);
expect(parsed.completeness).toBe("complete");
expect(parsed.records.some((record) => normalizedSessionIds(record).includes("rs_fixture_001"))).toBe(false);
```

- [ ] **Step 2: Run the Grok test and verify it fails**

Run:

```bash
npx vitest --run src/adapters/__tests__/grokAdapter.test.ts
```

Expected: FAIL on session identity and evidence-kind assertions.

- [ ] **Step 3: Implement conversation planning**

`planTranscriptUnits` must group files by the directory immediately containing `chat_history.jsonl`, use that directory name as `sourceSessionId`, prefer the newest semantic timestamp found in `summary.json` or `chat_history.jsonl`, and otherwise declare `timestampBasis: "file_modified"`.

```ts
return [{
  runtime: "grok",
  source,
  unitId: `grok:${conversationId}`,
  sourceSessionId: conversationId,
  semanticActivityAt,
  timestampBasis: semanticActivityAt ? "semantic" : "file_modified",
  modifiedAt: newestFileMtime
}];
```

- [ ] **Step 4: Implement record parsing without generic `id` fallback**

Use the conversation ID for every normalized record. Map:

```ts
switch (row.type) {
  case "system":
  case "user":
  case "assistant":
    return messageRecord(conversationId, row);
  case "reasoning":
    return checkpointRecord(conversationId, row.summary, row.id);
  case "tool_result":
    return toolResultRecord(conversationId, row);
  default:
    return diagnostic("grok_record_type_unrecognized", row.type);
}
```

Assistant `tool_calls` arrays must emit `tool_call` records in addition to the assistant message. Known non-transcript auxiliary files are ignored with info diagnostics; unknown transcript row types make the unit partial.

- [ ] **Step 5: Add a pathology assertion**

```ts
expect(parsed.records.filter((record) => record.normalized.kind === "message").some((record) => {
  const value = record.normalized.value as { role?: string };
  return value.role === "user" || value.role === "assistant";
})).toBe(true);
```

- [ ] **Step 6: Run Grok and multi-adapter tests**

Run:

```bash
npx vitest --run src/adapters/__tests__/grokAdapter.test.ts src/daemon/import/__tests__/multiAdapterImport.test.ts
```

Expected: PASS; one fixture directory yields one session and no `rs_<record-id>` session identity.

- [ ] **Step 7: Commit the Grok adapter**

```bash
git add src/adapters/grok src/adapters/__tests__/grokAdapter.test.ts src/adapters/__fixtures__/grok
git commit -m "fix: assemble Grok conversation transcripts"
```

---

### Task 5: Implement Hermes Session and Tool Normalization

**Files:**
- Create: `src/adapters/hermes/transcriptUnit.ts`
- Modify: `src/adapters/hermes/adapter.ts`
- Modify: `src/adapters/__tests__/hermesAdapter.test.ts`
- Test fixture: `src/adapters/__fixtures__/hermes/session.jsonl`

**Interfaces:**
- Consumes: `TranscriptUnitAdapter`, Hermes JSON/JSONL session files and `state.db` records.
- Produces: stable Hermes sessions with deduplicated source identity and structured tool evidence.

- [ ] **Step 1: Add failing tests for tool normalization and JSON/SQLite identity merging**

```ts
expect(parsed.records.filter((record) => record.normalized.kind === "tool_call")).toHaveLength(1);
expect(parsed.records.filter((record) => record.normalized.kind === "tool_result")).toHaveLength(1);
expect(parsed.records.filter((record) => record.normalized.kind === "message")).toHaveLength(3);
expect(parsed.sourceSessionIds).toEqual(["20260710_100000_fixture"]);
```

Add a second test where JSONL and SQLite rows share `20260710_100000_fixture`; assert that canonical ingestion updates one session rather than creating two.

- [ ] **Step 2: Run the Hermes tests and verify they fail**

Run:

```bash
npx vitest --run src/adapters/__tests__/hermesAdapter.test.ts
```

Expected: FAIL because tool-role rows are messages and cross-source identity is not proven.

- [ ] **Step 3: Implement Hermes identity and record-kind parsing**

Identity priority:

```ts
const sourceSessionId =
  readString(row, ["session_id", "sessionId", "conversation_id"]) ??
  sessionIdFromHermesFilename(unit.source.path);
```

Tool-role mapping:

```ts
if (row.role === "tool" && row.name && row.arguments) return toolCallRecord(sourceSessionId, row);
if (row.role === "tool" && row.tool_call_id && row.content) return toolResultRecord(sourceSessionId, row);
if (row.role === "user" || row.role === "assistant" || row.role === "system") return messageRecord(sourceSessionId, row);
```

Deduplicate JSON/SQLite evidence by `(sourceSessionId, kind, observedAt, payloadHash)` while preserving both source references.

- [ ] **Step 4: Derive semantic activity for recent-range planning**

Use `last_updated`, then the latest message timestamp, then the timestamp encoded in the session filename. File mtime is the final fallback and must be labeled accordingly.

- [ ] **Step 5: Run Hermes, transcript coverage, and quality tests**

Run:

```bash
npx vitest --run src/adapters/__tests__/hermesAdapter.test.ts src/workbench/__tests__/qualityPrecheck.test.ts src/daemon/db/__tests__/sessionTranscriptRepository.test.ts
```

Expected: adapter tests PASS. Existing quality expectations may remain unchanged until Task 7, but coverage must report structured tool calls/results for the new fixture.

- [ ] **Step 6: Commit Hermes normalization**

```bash
git add src/adapters/hermes src/adapters/__tests__/hermesAdapter.test.ts src/adapters/__fixtures__/hermes
git commit -m "fix: normalize Hermes session tool evidence"
```

---

### Task 6: Separate Import Health from Workbench Quality

**Files:**
- Create: `src/daemon/db/sessionImportHealthRepository.ts`
- Create: `src/daemon/db/migrations/026_session_import_health.sql`
- Modify: `src/daemon/import/importWorkUnitRunner.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/shared/workbench.ts`
- Test: `src/daemon/import/__tests__/importWorkUnitRunner.test.ts`
- Test: `src/daemon/db/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `ParsedTranscriptUnit.completeness`, diagnostics, import-job provenance.
- Produces: `SessionImportHealthStatus`, repository reads/writes, and a runner rule that only complete units reach quality reconciliation.

- [ ] **Step 1: Write the failing partial-unit test**

```ts
test("partial transcript units require import repair and never enter Not Added", async () => {
  const result = await runImportWorkUnit(partialUnitInput(db));
  const sessionId = result.sessionIds[0];

  expect(readSessionImportHealth(db, sessionId)).toMatchObject({
    status: "repair_required",
    reason: "partial_parse"
  });
  expect(readWorkbenchSessionState(db, sessionId)).toBeUndefined();
});
```

- [ ] **Step 2: Run the work-unit test and verify it fails**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importWorkUnitRunner.test.ts
```

Expected: FAIL because current hydration immediately creates a failed Workbench row.

- [ ] **Step 3: Add import-health schema**

```sql
CREATE TABLE session_import_health (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'repair_required')),
  reason TEXT,
  import_job_id TEXT REFERENCES import_jobs(import_job_id) ON DELETE SET NULL,
  work_unit_id TEXT REFERENCES import_work_units(work_unit_id) ON DELETE SET NULL,
  evidence_revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_session_import_health_status
  ON session_import_health(status, updated_at DESC);
```

- [ ] **Step 4: Add the repository interface**

```ts
export type SessionImportHealthStatus = "complete" | "partial" | "repair_required";

export function recordSessionImportHealth(db: MastheadDatabase, input: {
  sessionId: string;
  status: SessionImportHealthStatus;
  reason?: string;
  importJobId: string;
  workUnitId: string;
  evidenceRevision: string;
  updatedAt: string;
}): SessionImportHealthRecord;

export function readSessionImportHealth(
  db: MastheadDatabase,
  sessionId: string
): SessionImportHealthRecord | undefined;
```

- [ ] **Step 5: Gate Workbench reconciliation in the runner**

```ts
for (const sessionId of sessionIds) {
  const health = recordHealthForParsedUnit(db, parsedUnit, sessionId, unit);
  if (health.status === "complete") input.onSessionHydrated?.(sessionId);
}
```

Do not create a Workbench state row for partial/repair-required sessions. Existing live sessions without a `session_import_health` row remain valid; the table governs transcript imports only.

- [ ] **Step 6: Add read-only import-health DTOs**

Expose aggregate counts and representative reasons through the import report, not through Not Added.

- [ ] **Step 7: Run schema, runner, and Workbench API tests**

Run:

```bash
npx vitest --run src/daemon/db/__tests__/schema.test.ts src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/daemon/__tests__/workbenchApi.test.ts
```

Expected: PASS; incomplete imports are absent from Workbench quality queues and visible through import health.

- [ ] **Step 8: Commit import-health separation**

```bash
git add src/daemon/db/sessionImportHealthRepository.ts src/daemon/db/migrations/026_session_import_health.sql src/daemon/import/importWorkUnitRunner.ts src/daemon/server.ts src/shared/workbench.ts src/daemon/import/__tests__/importWorkUnitRunner.test.ts src/daemon/db/__tests__/schema.test.ts
git commit -m "feat: separate import health from Workbench quality"
```

---

### Task 7: Make Workbench Quality Conservative and Reversible

**Files:**
- Modify: `src/workbench/qualityPrecheck.ts`
- Modify: `src/workbench/transcriptQualityReconciler.ts`
- Modify: `src/daemon/db/workbenchPipelineRepository.ts`
- Create: `src/daemon/db/migrations/027_workbench_suppression_provenance.sql`
- Modify: `src/shared/workbench.ts`
- Test: `src/workbench/__tests__/qualityPrecheck.test.ts`
- Test: `src/workbench/__tests__/transcriptQualityReconciler.test.ts`
- Test: `src/daemon/db/__tests__/workbenchPipelineRepository.test.ts`

**Interfaces:**
- Consumes: complete transcript coverage and evidence revision.
- Produces: `CaptureQualityDisposition`, suppression provenance, and automatic reopening when evidence changes.

- [ ] **Step 1: Replace pass/fail tests with disposition tests**

Add these red cases:

```ts
expect(runCaptureQualityPrecheck(db, "session:one-request-many-tools")).toMatchObject({
  disposition: "keep",
  reason: "substantial_tool_work"
});

expect(runCaptureQualityPrecheck(db, "session:ambiguous-short")).toMatchObject({
  disposition: "review",
  reason: "insufficient_evidence"
});

expect(runCaptureQualityPrecheck(db, "session:hook-only")).toMatchObject({
  disposition: "suppress",
  reason: "hook_only"
});
```

- [ ] **Step 2: Run quality tests and verify the new semantic cases fail**

Run:

```bash
npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts
```

Expected: FAIL because the current function has only boolean pass/fail and count thresholds.

- [ ] **Step 3: Implement the conservative disposition**

```ts
export type CaptureQualityDisposition =
  | { disposition: "keep"; reason: "meaningful_conversation" | "substantial_tool_work" | "durable_file_effect" }
  | { disposition: "review"; reason: "insufficient_evidence" }
  | { disposition: "suppress"; reason: "empty" | "hook_only" | "diagnostic_only" | "exact_duplicate" };
```

Decision order:

```ts
if (totalEvidence === 0) return suppress("empty");
if (isHookOnly(coverage)) return suppress("hook_only");
if (isDiagnosticOnly(coverage)) return suppress("diagnostic_only");
if (hasExactCanonicalDuplicate(db, sessionId)) return suppress("exact_duplicate");
if (coverage.fileEffects > 0) return keep("durable_file_effect");
if (coverage.toolCalls + coverage.toolResults >= 4 && coverage.userMessages >= 1) return keep("substantial_tool_work");
if (coverage.userMessages >= 1 && coverage.assistantMessages >= 1) return keep("meaningful_conversation");
return review("insufficient_evidence");
```

Do not suppress `review`. Keep it on the package path with next action `review_quality`.

- [ ] **Step 4: Add suppression provenance columns**

```sql
ALTER TABLE workbench_session_state ADD COLUMN suppression_category TEXT
  CHECK (suppression_category IN ('confirmed_noise', 'insufficient_evidence', 'manual_exclusion'));
ALTER TABLE workbench_session_state ADD COLUMN quality_decision_source TEXT NOT NULL DEFAULT 'automatic'
  CHECK (quality_decision_source IN ('automatic', 'user'));
ALTER TABLE workbench_session_state ADD COLUMN quality_evidence_revision TEXT;
```

- [ ] **Step 5: Reopen stale automatic suppression**

```ts
if (
  state.publicationStatus === "not_added_to_logbook" &&
  state.qualityDecisionSource === "automatic" &&
  state.qualityEvidenceRevision !== currentEvidenceRevision
) {
  state = reopenWorkbenchSessionForQualityReview(db, {
    actor: { kind: "system", id: "transcript_import" },
    evidenceRevision: currentEvidenceRevision,
    sessionId
  }).state;
}
```

Manual exclusions must never auto-reopen.

- [ ] **Step 6: Run quality, reconciliation, and repository tests**

Run:

```bash
npx vitest --run src/workbench/__tests__/qualityPrecheck.test.ts src/workbench/__tests__/transcriptQualityReconciler.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
```

Expected: PASS; short tool-heavy work stays, ambiguous work remains reviewable, confirmed noise suppresses, and changed evidence reopens automatic suppression.

- [ ] **Step 7: Commit conservative quality**

```bash
git add src/workbench/qualityPrecheck.ts src/workbench/transcriptQualityReconciler.ts src/daemon/db/workbenchPipelineRepository.ts src/daemon/db/migrations/027_workbench_suppression_provenance.sql src/shared/workbench.ts src/workbench/__tests__/qualityPrecheck.test.ts src/workbench/__tests__/transcriptQualityReconciler.test.ts src/daemon/db/__tests__/workbenchPipelineRepository.test.ts
git commit -m "fix: keep ambiguous sessions on the Workbench path"
```

---

### Task 8: Detect Pathological Imports and Produce Trustworthy Receipts

**Files:**
- Create: `src/daemon/import/importAnomalyDetector.ts`
- Create: `src/daemon/import/__tests__/importAnomalyDetector.test.ts`
- Modify: `src/daemon/import/importCompletionReport.ts`
- Modify: `src/shared/sourceImport.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/import/__tests__/importCompletionReport.test.ts`

**Interfaces:**
- Consumes: work-unit totals, parsed session shapes, timestamp basis, scope outcomes.
- Produces: `ImportAnomaly`, enhanced `ImportCompletionReportDto`, and repair-required job status.

- [ ] **Step 1: Write failing anomaly tests for the observed corpus shapes**

```ts
expect(detectImportAnomalies({
  recordsRecognized: 1_001,
  recordsRejected: 202_390,
  sessionsFinalized: 1_001,
  oneMessageSessions: 1_001,
  sessionsWithUserOrAssistant: 0,
  outOfRangeSessions: 0,
  toolRoleMessages: 0,
  structuredToolItems: 0
})).toEqual(expect.arrayContaining([
  expect.objectContaining({ code: "record_id_session_explosion", severity: "error" }),
  expect.objectContaining({ code: "conversation_roles_missing", severity: "error" }),
  expect.objectContaining({ code: "schema_rejection_dominates", severity: "error" })
]));
```

Add separate assertions for `out_of_range_sessions` and `tool_evidence_not_normalized`.

- [ ] **Step 2: Run the anomaly test and verify it fails**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importAnomalyDetector.test.ts
```

Expected: FAIL because the detector does not exist.

- [ ] **Step 3: Implement deterministic anomaly rules**

```ts
export type ImportAnomalyCode =
  | "record_id_session_explosion"
  | "conversation_roles_missing"
  | "schema_rejection_dominates"
  | "out_of_range_sessions"
  | "tool_evidence_not_normalized"
  | "epoch_timestamp_dominates";

export type ImportAnomaly = {
  code: ImportAnomalyCode;
  severity: "warning" | "error";
  count: number;
  message: string;
};
```

Use fixed, testable thresholds:

- `record_id_session_explosion`: at least 50 sessions, `recordsRecognized / sessionsFinalized <= 1.1`, and at least 90% one-message sessions.
- `conversation_roles_missing`: at least 20 sessions and zero sessions with user or assistant content.
- `schema_rejection_dominates`: at least 100 rejected records and rejection rate at least 50%.
- `out_of_range_sessions`: any newly created session outside a recent scope.
- `tool_evidence_not_normalized`: at least 20 tool-role messages and zero structured tool items.
- `epoch_timestamp_dominates`: at least 20 sessions and at least 25% at Unix epoch.

- [ ] **Step 4: Extend completion reports**

Add:

```ts
recordsRecognized: number;
recordsRejected: number;
sessionsFinalized: number;
sessionsRepairRequired: number;
sessionsSuppressed: number;
sessionsOnPackagePath: number;
outOfRangeSessions: number;
timestampBasis: Record<TranscriptTimestampBasis, number>;
cappedUnits: number;
anomalies: ImportAnomaly[];
```

Any error anomaly makes the job `succeeded_with_issues` and sets next action `repair_import`; it does not create Not Added rows. Add `"repair_import"` to `ImportCompletionReportDto["nextActions"]` in `src/shared/sourceImport.ts`.

- [ ] **Step 5: Run detector and completion-report tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importAnomalyDetector.test.ts src/daemon/import/__tests__/importCompletionReport.test.ts
```

Expected: PASS with reconciling counts and stable anomaly messages.

- [ ] **Step 6: Commit anomaly detection and receipts**

```bash
git add src/daemon/import/importAnomalyDetector.ts src/daemon/import/__tests__/importAnomalyDetector.test.ts src/daemon/import/importCompletionReport.ts src/shared/sourceImport.ts src/daemon/server.ts src/daemon/import/__tests__/importCompletionReport.test.ts
git commit -m "feat: flag pathological imports before Workbench classification"
```

---

### Task 9: Add Provenance-Scoped Repair Preview and Apply

**Files:**
- Create: `src/daemon/import/importRepair.ts`
- Create: `src/daemon/import/__tests__/importRepair.test.ts`
- Create: `src/cli/importRepair.ts`
- Modify: `src/cli/mastheadctl.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/app/daemonClient.ts`
- Test: `src/cli/__tests__/mastheadctl.test.ts`

**Interfaces:**
- Consumes: import job IDs, `import_session_impacts`, `session_sources`, artifact provenance, and current adapter registry.
- Produces: `previewImportRepair` and `applyImportRepair` with an immutable repair plan hash.

- [ ] **Step 1: Write the failing repair-preview isolation test**

```ts
test("repair preview scopes every deletion and reimport to selected import jobs", () => {
  const preview = previewImportRepair(db, { importJobIds: ["job:grok", "job:hermes"] });

  expect(preview).toMatchObject({
    affectedSessions: expect.arrayContaining(["session:grok-fragment", "session:hermes-old"]),
    preservedSessions: expect.arrayContaining(["session:live-codex", "session:unrelated"]),
    blockedPublishedSessions: [],
    applyAllowed: true
  });
  expect(preview.planHash).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Write the failing safety tests**

```ts
expect(() => applyImportRepair(db, { importJobIds, planHash: "wrong" })).toThrow("repair plan changed");
expect(previewImportRepair(db, { importJobIds: ["job:published"] }).applyAllowed).toBe(false);
expect(readSession(db, "session:live-codex")).toBeDefined();
```

- [ ] **Step 3: Run repair tests and verify they fail**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importRepair.test.ts
```

Expected: FAIL because the repair module does not exist.

- [ ] **Step 4: Implement the preview**

The preview must report:

```ts
export type ImportRepairPreview = {
  importJobIds: string[];
  affectedSessions: string[];
  pseudoSessionsToRemove: string[];
  sessionsToReparse: string[];
  automaticSuppressionsToReopen: string[];
  outOfRangeSessionsToDefer: string[];
  preservedSessions: string[];
  blockedPublishedSessions: string[];
  affectedArtifacts: string[];
  applyAllowed: boolean;
  planHash: string;
};
```

Calculate affected sessions only from `import_session_impacts` and `session_sources`. Refuse apply if any affected session has published artifacts unless the preview can prove that the artifact is test-only and explicitly included in a separately approved repair scope.

- [ ] **Step 5: Implement transactional apply**

`applyImportRepair` must:

1. Recompute and compare `planHash`.
2. Run in one immediate transaction for canonical deletions/state cleanup.
3. Delete only pseudo-sessions exclusively owned by selected jobs.
4. Clear only automatic Workbench suppression for reparsed sessions.
5. Reset selected work units/cursors for reimport.
6. Commit before scheduling adapter work.
7. Return a durable receipt with removed, reset, preserved, and blocked IDs.

It must never accept a database path argument from the request body; it operates only on the daemon's active database.

- [ ] **Step 6: Add CLI and daemon routes**

```text
mastheadctl import repair preview --job <id> [--job <id>]
mastheadctl import repair apply --job <id> [--job <id>] --plan-hash <sha256>
```

HTTP routes:

```text
POST /imports/repair/preview
POST /imports/repair/apply
```

The worktree bridge must allow preview and reject apply.

- [ ] **Step 7: Run repair, CLI, server, and bridge tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importRepair.test.ts src/cli/__tests__/mastheadctl.test.ts src/daemon/__tests__/server.test.ts src/core/__tests__/worktreeConnector.test.ts
```

Expected: PASS; preview is read-only, apply requires matching hash, unrelated/live/published data is preserved, and bridge apply is denied.

- [ ] **Step 8: Commit repair tooling**

```bash
git add src/daemon/import/importRepair.ts src/daemon/import/__tests__/importRepair.test.ts src/cli/importRepair.ts src/cli/mastheadctl.ts src/daemon/server.ts src/app/daemonClient.ts src/cli/__tests__/mastheadctl.test.ts src/core/__tests__/worktreeConnector.test.ts
git commit -m "feat: add scoped import repair preview and apply"
```

---

### Task 10: Present Import Health Honestly in Sources and Workbench

**Files:**
- Modify: `src/ui/sources/ImportCompletionReport.tsx`
- Modify: `src/ui/SidebarImportActivity.tsx`
- Modify: `src/ui/workbench/WorkbenchPanel.tsx`
- Modify: `src/app/daemonClient.ts`
- Modify: `src/shared/sourceImport.ts`
- Modify: `src/shared/workbench.ts`
- Test: `src/ui/sources/__tests__/SourcesImportModal.test.tsx`
- Test: `src/ui/workbench/__tests__/WorkbenchPanel.test.tsx`
- Test: `src/ui/settings/__tests__/SettingsSurface.test.tsx`

**Interfaces:**
- Consumes: enhanced completion report and import-health aggregates.
- Produces: honest per-harness receipt, separate repair count, and unchanged Not Added semantics.

- [ ] **Step 1: Write the failing receipt UI test**

```tsx
expect(html).toContain("500 recent units imported");
expect(html).toContain("300 recent units deferred by the safety cap");
expect(html).toContain("12 sessions need import repair");
expect(html).toContain("Timestamp basis: 480 semantic · 20 file modified");
expect(html).toContain("Parser rejected 121 source records");
expect(html).not.toContain("121 sessions were not useful");
```

- [ ] **Step 2: Write the failing Workbench separation test**

```tsx
expect(html).toContain("Package path 102");
expect(html).toContain("Import repair 12");
expect(html).toContain("Not Added 4");
expect(html).not.toContain("Not Added 16");
```

- [ ] **Step 3: Run UI tests and verify they fail**

Run:

```bash
npx vitest --run src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
```

Expected: FAIL because import repair and detailed receipts are not rendered.

- [ ] **Step 4: Render the enhanced import receipt**

Use direct facts, not success theater:

```tsx
<ImportFact label="Canonical sessions" value={report.sessionsFinalized} />
<ImportFact label="Package path" value={report.sessionsOnPackagePath} />
<ImportFact label="Import repair" value={report.sessionsRepairRequired} tone={report.sessionsRepairRequired ? "warning" : "neutral"} />
<ImportFact label="Confirmed noise" value={report.sessionsSuppressed} />
<ImportFact label="Rejected records" value={report.recordsRejected} tone={report.recordsRejected ? "warning" : "neutral"} />
```

When error anomalies exist, label the run `Needs import repair`; never display it as fully succeeded.

- [ ] **Step 5: Add Workbench's separate Import repair count and panel**

Do not place repair rows in the package table or Not Added drawer. The repair panel is read-only in this task and links to the relevant import receipt; repair mutation remains CLI/daemon-controlled until separately designed.

- [ ] **Step 6: Run UI tests, surface contract, and typecheck**

Run:

```bash
npx vitest --run src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx
npm run check:surface-contract
npm run typecheck
```

Expected: all PASS; Settings remains unchanged, Workbench remains the dense ops table, and import repair is visually separate from Not Added.

- [ ] **Step 7: Inspect Sources and Workbench with the in-app Browser**

Run an isolated fixture UI on a non-production port, then inspect desktop, tablet, and 390px widths. Verify:

- receipt numbers do not overflow;
- repair warnings are readable but not alarmist;
- Package path, Import repair, and Not Added cannot be confused;
- no production connector or database is used.

- [ ] **Step 8: Commit honest import UI**

```bash
git add src/ui/sources/ImportCompletionReport.tsx src/ui/SidebarImportActivity.tsx src/ui/workbench/WorkbenchPanel.tsx src/app/daemonClient.ts src/shared/sourceImport.ts src/shared/workbench.ts src/ui/sources/__tests__/SourcesImportModal.test.tsx src/ui/workbench/__tests__/WorkbenchPanel.test.tsx src/ui/settings/__tests__/SettingsSurface.test.tsx
git commit -m "feat: separate import repair from Not Added"
```

---

### Task 11: Replay the Diagnosed Corpus in Isolation and Update Documentation

**Files:**
- Create: `scripts/replay-import-trust-corpus.js`
- Create: `src/daemon/import/__tests__/importTrustAcceptance.test.ts`
- Modify: `openwiki/logbook-and-workbench.md`
- Modify: `openwiki/data-and-integrations.md`
- Modify: `docs/reference/daemon-api.md`
- Modify: `docs/acceptance/product-release-gate.md`

**Interfaces:**
- Consumes: corrected adapters, scope decisions, import health, quality disposition, repair preview.
- Produces: one red-capable corpus replay and documented release evidence.

- [ ] **Step 1: Write the acceptance test over sanitized multi-runtime fixtures**

```ts
expect(report).toMatchObject({
  outOfRangeSessions: 0,
  sessionsRepairRequired: 0,
  anomalies: [],
  recordsRejected: 0
});
expect(sessionCounts).toMatchObject({
  grok: 1,
  hermes: 1
});
expect(workbench.notAddedReasons).toEqual([]);
expect(workbench.packagePath).toBe(2);
```

- [ ] **Step 2: Add the isolated replay script**

The script must require:

```text
--source-root <sanitized-corpus>
--database <path-under-/tmp>
```

It must reject a database path outside `/tmp`, reject any path named `masthead-production`, and print JSON containing:

```ts
{
  productionAccessed: false,
  databasePath,
  perRuntime,
  importReports,
  workbenchCounts,
  anomalies,
  repairPreview
}
```

- [ ] **Step 3: Run the sanitized acceptance loop**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/importTrustAcceptance.test.ts
node scripts/replay-import-trust-corpus.js --source-root src/adapters/__fixtures__ --database /tmp/masthead-import-trust-acceptance.sqlite
```

Expected: PASS and JSON with `productionAccessed: false`, no out-of-range sessions, no reasoning-fragment sessions, and no import failures classified as Not Added.

- [ ] **Step 4: Run a read-only preview against a copy of the current evaluation database**

Copy `/tmp/masthead-production-eval-15f9c519/masthead.sqlite` to a new `/tmp` path before starting the repaired daemon. Never point the new daemon at the active test database. Run only repair preview first and verify the plan identifies:

- the Grok reasoning-fragment pseudo-sessions;
- the old Hermes sessions admitted by the broken recent range;
- automatic suppressions eligible to reopen;
- live Codex sessions as preserved;
- no published artifacts as silently deletable.

- [ ] **Step 5: Apply repair only to the disposable copy**

Use the exact preview hash. Reimport from sanitized or explicitly approved local source paths, then assert:

```text
outOfRangeSessions = 0
recordIdSessionExplosion = absent
toolEvidenceNotNormalized = absent
importRepairCount = 0 or explained by specific remaining adapter diagnostics
```

Do not promise an exact replacement for `102 / 1,497`; correctness of identities and evidence is the gate.

- [ ] **Step 6: Update documentation**

Document:

- transcript-unit ownership;
- recent-range and incremental-refresh semantics;
- timestamp-basis disclosure;
- import-health versus Workbench-quality distinction;
- reversible automatic suppression;
- repair preview/apply safety;
- release-gate evidence from the isolated replay.

- [ ] **Step 7: Run the focused release gate**

Run:

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run typecheck
npx vitest --run \
  src/adapters/__tests__/grokAdapter.test.ts \
  src/adapters/__tests__/hermesAdapter.test.ts \
  src/daemon/import/__tests__/importManifestService.test.ts \
  src/daemon/import/__tests__/importWorkUnitRunner.test.ts \
  src/daemon/import/__tests__/importAnomalyDetector.test.ts \
  src/daemon/import/__tests__/importRepair.test.ts \
  src/daemon/import/__tests__/importTrustAcceptance.test.ts \
  src/workbench/__tests__/qualityPrecheck.test.ts \
  src/workbench/__tests__/transcriptQualityReconciler.test.ts \
  src/ui/sources/__tests__/SourcesImportModal.test.tsx \
  src/ui/workbench/__tests__/WorkbenchPanel.test.tsx
npm run build
```

Expected: every command PASS. The build output remains in the worktree; do not package or install it.

- [ ] **Step 8: Commit acceptance and documentation**

```bash
git add scripts/replay-import-trust-corpus.js src/daemon/import/__tests__/importTrustAcceptance.test.ts openwiki/logbook-and-workbench.md openwiki/data-and-integrations.md docs/reference/daemon-api.md docs/acceptance/product-release-gate.md
git commit -m "docs: lock import trust release gate"
```

---

## Final Acceptance Checklist

- [ ] Fresh `transcript_recent` with no cursors excludes units outside the requested range.
- [ ] Changed old sources require an existing cursor and are reported as incremental refreshes.
- [ ] Unit caps are explicit and do not masquerade as completed range imports.
- [ ] A Grok conversation directory yields one canonical session; `rs_<record-id>` is never session identity.
- [ ] Grok user, assistant, reasoning, tool call, and tool result records remain attached to the conversation.
- [ ] Hermes tool-role records become structured tool calls/results.
- [ ] Hermes JSON/JSONL/SQLite evidence merges under stable source-session identity.
- [ ] Partial, unrecognized, or identity-ambiguous imports never create Not Added rows.
- [ ] Ambiguous short sessions remain on the package path for review.
- [ ] Only empty, hook-only, diagnostic-only, exact-duplicate, or manually excluded sessions enter Not Added.
- [ ] Automatic suppression reopens when its evidence revision changes.
- [ ] Manual exclusion remains sticky.
- [ ] Import anomalies block success theater and produce actionable receipts.
- [ ] Repair preview is read-only and scoped entirely by import-job provenance.
- [ ] Repair apply requires an unchanged plan hash and preserves unrelated/live/published data.
- [ ] Sources and Workbench distinguish Package path, Import repair, and Not Added.
- [ ] The isolated diagnosed-corpus replay has no out-of-range sessions, record-ID session explosion, or unnormalized tool evidence.
- [ ] No production build or production database is changed.
