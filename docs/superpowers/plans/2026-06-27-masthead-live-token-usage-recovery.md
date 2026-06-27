# Masthead Live Token Usage Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for the implementation, or `superpowers:executing-plans` if working inline. Track progress by updating the checkbox items in this file.

## Optimizer Result

Rubric:

- Root-cause alignment and data contract, 20 points: the plan must preserve the finding that Codex transcripts still contain token data and Masthead must not invent token totals from hook metadata.
- Test-first verifiability, 20 points: each behavior change needs a failing test, a passing verification command, and an observable endpoint/UI check.
- Code-level executability, 20 points: named files, helpers, imports, SQL predicates, and insertion points must line up with the current repo.
- Operational safety, 15 points: `/ingest` must remain fast and best-effort; transcript privacy approval and exclusions must be honored.
- Scope control, 15 points: no DB cleanup, migrations, UI redesign, or unrelated refactors.
- Closeout quality, 10 points: final verification must explain `doctor`, `/usage/summary`, Board cards, and residual cases.

Score trajectory: `84 -> 91 -> 94 -> 94`

Substantive improvements from the first draft:

- Make live transcript catch-up best-effort so a missing, partially-written, excluded, or unreadable transcript never breaks hook ingestion.
- Add explicit tests for the transcript approval gate and catch-up failure path, not just the happy path.
- Centralize the numeric-token SQL predicate and apply it consistently, including `totals.models`, `byModel`, coverage, activity, project, and runtime token aggregates.
- Remove per-task commit instructions from the core execution flow. Commit only after the implementation and verification pass, if Tyler asks for that workflow.

---

## Goal

Restore token totals for new live Codex sessions by importing the transcript token-count rows referenced by hook payloads, while preventing model-only hook events from being reported as token usage.

## Data Contract

Codex hook events are live metadata. They may contain `model` and `transcriptPath`, but they are not the authoritative source for token counts unless numeric token fields are present.

Codex transcript JSONL files are the authoritative source for new token counts. Masthead already parses `event_msg` / `token_count` rows with `info.last_token_usage` and `info.total_token_usage` in `src/adapters/codex/transcriptParser.ts`.

`model_usage` represents token usage only when at least one of `input_tokens`, `output_tokens`, or `total_tokens` is non-null. A row with only `model` or `provider` is model metadata, not token usage, and should not be created from the live hook path.

Live transcript catch-up must be best-effort:

- It runs only after transcript import has been approved.
- It respects source exclusions.
- It accepts only absolute `.jsonl` paths under `config.codexHomeDir/.codex/sessions` or `config.codexHomeDir/.codex/archived_sessions`.
- It must not make `/ingest` fail if the transcript is absent, currently being written, malformed, excluded, or otherwise unreadable.

## File Map

- Modify `src/daemon/db/sessionRepository.ts`
  - Stop inserting `model_usage` rows from live hook events unless a numeric token field is present.

- Modify `src/daemon/server.ts`
  - Add a safe live catch-up helper for hook `payload.transcriptPath`.
  - Normalize single-file transcript source IDs to match Codex discovery.
  - Call the catch-up helper after accepted hook ingestion without letting catch-up failures break `/ingest`.

- Modify `src/daemon/db/usageStatsRepository.ts`
  - Add one reusable numeric-token predicate.
  - Apply it to token totals, model usage summaries, model counts, token activity, project/runtime token CTEs, and coverage.
  - Use the same total-token expression as session token totals: prefer `total_tokens`, otherwise sum `input_tokens + output_tokens`.

- Modify `src/daemon/db/__tests__/sessionRepository.test.ts`
  - Update existing expectations that currently assume a model-only hook creates a usage row.
  - Add a focused model-only hook test.

- Modify `src/daemon/import/__tests__/progressiveImport.test.ts`
  - Add live hook `transcriptPath` catch-up tests.
  - Add approval-gate and catch-up failure tests.
  - Add cursor/source-id stability coverage for repeated hook events.

- Modify `src/daemon/db/__tests__/usageStatsRepository.test.ts`
  - Add a model-only usage row fixture.
  - Assert token totals, token row counts, model usage rows, activity, and coverage ignore tokenless rows.

- Optional docs file: `docs/reference/usage-statistics.md`
  - Update only if the implementation changes the public usage statistics contract text.

---

## Phase 0: Baseline And Guardrails

- [ ] Confirm the worktree state before edits.

```bash
git status --short
```

Expected: note any existing unrelated user changes and do not revert them.

- [ ] Run the currently relevant tests before changing behavior.

```bash
npm test -- --run src/daemon/db/__tests__/sessionRepository.test.ts src/daemon/import/__tests__/progressiveImport.test.ts src/daemon/db/__tests__/usageStatsRepository.test.ts
```

Expected: current tests pass or any existing failure is recorded before implementation.

---

## Phase 1: Stop Creating Model-Only Usage Rows

### Tests First

- [ ] In `src/daemon/db/__tests__/sessionRepository.test.ts`, update the existing test named `upserts live events into the canonical session graph idempotently`.

Replace the final `model_usage` expectation:

```ts
expect(db.prepare("SELECT model, output_tokens FROM model_usage").all()).toEqual([
  { model: "gpt-5.5", output_tokens: null },
  { model: "gpt-5.5", output_tokens: 32 }
]);
```

with:

```ts
expect(db.prepare("SELECT model, output_tokens FROM model_usage").all()).toEqual([{ model: "gpt-5.5", output_tokens: 32 }]);
```

- [ ] Add this focused failing test after the existing live-event idempotency test:

```ts
test("does not create model usage rows for model-only live hook events", async () => {
  const db = await openMigratedDatabase();
  const repository = createSessionRepository(db, {
    hostId: "host:test",
    hostname: "masthead-test-host",
    runtimeKind: "codex",
    runtimeVersion: "codex-test"
  });

  repository.upsertLiveEvent(
    liveEvent("start", "session.started", {
      model: "gpt-5.5",
      project: "Masthead",
      title: "Model metadata only"
    })
  );

  expect(db.prepare("SELECT COUNT(*) AS count FROM model_usage").get()).toEqual({ count: 0 });
  db.close();
});
```

- [ ] Run the failing test.

```bash
npm test -- --run src/daemon/db/__tests__/sessionRepository.test.ts
```

Expected before implementation: the new test fails because the repository still inserts a model-only `model_usage` row.

### Implementation

- [ ] In `src/daemon/db/sessionRepository.ts`, in `upsertModelUsage`, replace the existing guard:

```ts
if (!model && !provider && inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return;
```

with:

```ts
const hasTokenNumbers = inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined;
if (!hasTokenNumbers) return;
```

Keep the existing insert/upsert SQL unchanged.

### Verify

- [ ] Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionRepository.test.ts
```

Expected: all tests in `sessionRepository.test.ts` pass.

---

## Phase 2: Import The Hook Transcript Path Safely

### Tests First

- [ ] In `src/daemon/import/__tests__/progressiveImport.test.ts`, extend the import:

```ts
import { writeFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
```

- [ ] Add a happy-path catch-up test after `imports transcript token counts onto existing hook sessions`.

```ts
test("imports token counts from approved hook transcriptPath during live ingestion", async () => {
  const { daemon, codexRoot } = await createTestHarness();
  const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "live-token-session.jsonl");
  await writeJsonl(transcriptPath, [
    {
      type: "session_meta",
      timestamp: "2026-06-25T12:00:00.000Z",
      payload: {
        session_id: "live-token-session",
        cwd: "/home/tyler/Documents/Masthead",
        model: "gpt-5"
      }
    },
    {
      type: "event_msg",
      timestamp: "2026-06-25T12:01:00.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 30,
            output_tokens: 7,
            total_tokens: 37
          }
        }
      }
    }
  ]);
  const baseUrl = await listen(daemon);

  await postJson(baseUrl, "/adapters/codex/approve-transcripts");
  await ingestHook(baseUrl, {
    event: "session_started",
    model: "gpt-5",
    session_id: "live-token-session",
    timestamp: "2026-06-25T12:00:00.000Z",
    transcriptPath
  });

  await waitFor(() => tokenTotals(daemon.database).totalTokens === 37);
  expect(countRows(daemon.database, "sessions")).toBe(1);
  expect(tokenTotals(daemon.database)).toEqual({
    inputTokens: 30,
    outputTokens: 7,
    totalTokens: 37
  });
  expect(
    daemon.database
      .prepare("SELECT source_id, source_path, source_session_id, model FROM ingest_cursors WHERE source_path = ?")
      .get(transcriptPath)
  ).toEqual({
    model: "gpt-5",
    source_id: "codex-sessions:2026/06/25/live-token-session.jsonl",
    source_path: transcriptPath,
    source_session_id: "live-token-session"
  });
});
```

- [ ] Add a repeated-tail test after the happy-path test.

```ts
test("tails the same hook transcriptPath without duplicating earlier token rows", async () => {
  const { daemon, codexRoot } = await createTestHarness();
  const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "tail-token-session.jsonl");
  await writeJsonl(transcriptPath, [
    {
      type: "session_meta",
      timestamp: "2026-06-25T12:00:00.000Z",
      payload: {
        session_id: "tail-token-session",
        cwd: "/home/tyler/Documents/Masthead",
        model: "gpt-5"
      }
    },
    {
      type: "event_msg",
      timestamp: "2026-06-25T12:01:00.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 10,
            output_tokens: 2,
            total_tokens: 12
          }
        }
      }
    }
  ]);
  const baseUrl = await listen(daemon);

  await postJson(baseUrl, "/adapters/codex/approve-transcripts");
  await ingestHook(baseUrl, {
    event: "session_started",
    model: "gpt-5",
    session_id: "tail-token-session",
    timestamp: "2026-06-25T12:00:00.000Z",
    transcriptPath
  });
  await waitFor(() => tokenTotals(daemon.database).totalTokens === 12);

  const original = await readFile(transcriptPath, "utf8");
  await writeFile(
    transcriptPath,
    `${original}${JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-25T12:02:00.000Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25
          }
        }
      }
    })}\n`,
    "utf8"
  );

  await ingestHook(baseUrl, {
    event: "post_tool_use",
    model: "gpt-5",
    session_id: "tail-token-session",
    timestamp: "2026-06-25T12:02:01.000Z",
    transcriptPath
  });

  await waitFor(() => tokenTotals(daemon.database).totalTokens === 37);
  expect(countWhere(daemon.database, "model_usage", "total_tokens IS NOT NULL")).toBe(2);
});
```

- [ ] Add an approval-gate test.

```ts
test("does not import hook transcriptPath before transcript import approval", async () => {
  const { daemon, codexRoot } = await createTestHarness();
  const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "unapproved-token-session.jsonl");
  await writeJsonl(transcriptPath, [
    {
      type: "session_meta",
      timestamp: "2026-06-25T12:00:00.000Z",
      payload: { session_id: "unapproved-token-session", model: "gpt-5" }
    },
    {
      type: "event_msg",
      timestamp: "2026-06-25T12:01:00.000Z",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }
      }
    }
  ]);
  const baseUrl = await listen(daemon);

  await ingestHook(baseUrl, {
    event: "session_started",
    model: "gpt-5",
    session_id: "unapproved-token-session",
    timestamp: "2026-06-25T12:00:00.000Z",
    transcriptPath
  });

  await yieldToEventLoop();
  expect(countRows(daemon.database, "sessions")).toBe(1);
  expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});
```

- [ ] Add a best-effort failure test.

```ts
test("keeps hook ingestion accepted when approved transcriptPath is missing", async () => {
  const { daemon, codexRoot } = await createTestHarness();
  const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "missing-token-session.jsonl");
  const baseUrl = await listen(daemon);

  await postJson(baseUrl, "/adapters/codex/approve-transcripts");
  await ingestHook(baseUrl, {
    event: "session_started",
    model: "gpt-5",
    session_id: "missing-token-session",
    timestamp: "2026-06-25T12:00:00.000Z",
    transcriptPath
  });

  expect(countRows(daemon.database, "sessions")).toBe(1);
  expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});
```

- [ ] Run:

```bash
npm test -- --run src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected before implementation: the happy-path and tail tests fail because `/ingest` does not import `payload.transcriptPath`. The failure test may fail if an attempted import throws through `/ingest` after implementation starts.

### Implementation

- [ ] In `src/daemon/server.ts`, update the path import:

```ts
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
```

- [ ] Add these helpers near `transcriptSources`.

Use a distinct helper name because `server.ts` already has a `stringPayload(event, key)` helper near the bottom.

```ts
function transcriptSourceFromHookEvent(event: NormalizedEvent, homeDir: string): DiscoveredSource | undefined {
  const transcriptPath = stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]);
  if (!transcriptPath || !transcriptPath.endsWith(".jsonl") || !isAbsolute(transcriptPath)) return undefined;

  const codexRoot = join(homeDir, ".codex");
  const roots = [
    { id: "sessions", path: join(codexRoot, "sessions") },
    { id: "archived-sessions", path: join(codexRoot, "archived_sessions") }
  ];

  for (const root of roots) {
    const relativePath = relative(root.path, transcriptPath).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("../") || relativePath === ".." || isAbsolute(relativePath)) continue;
    return {
      confidence: "authoritative",
      path: transcriptPath,
      runtime: "codex",
      runtimeVersion: "file",
      schemaVersion: "codex-transcript-jsonl",
      sourceId: `codex-${root.id}:${relativePath}`,
      sourceKind: "jsonl"
    };
  }

  return undefined;
}

function stringFromPayload(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
```

- [ ] Normalize directory-expanded source IDs in `transcriptSources`.

Replace:

```ts
sourceId: `${source.sourceId}:${file.slice(source.path?.length ?? 0)}`
```

with:

```ts
sourceId: `${source.sourceId}:${relative(source.path, file).replaceAll("\\", "/")}`
```

- [ ] Add a best-effort catch-up helper inside `createMastheadDaemon`, near `queueAdapterTranscriptImports`.

```ts
  async function importHookTranscriptIfApproved(event: NormalizedEvent): Promise<void> {
    if (!transcriptImportApproved(database)) return;
    const source = transcriptSourceFromHookEvent(event, config.codexHomeDir);
    if (!source?.path || sourceIsExcluded(database, source.path)) return;

    try {
      await importTranscriptSources([source]);
    } catch (error) {
      state.diagnostics.push({
        code: "invalid_payload",
        details: error instanceof Error ? error.message : String(error),
        message: "Codex hook transcript catch-up failed; live hook ingestion was kept.",
        receivedAt: new Date().toISOString()
      });
    }
  }
```

- [ ] Call the helper after accepted hook ingestion, after the session is indexed/enrichment is queued, and before the HTTP response is sent.

The accepted block should read:

```ts
      if (result.status === "accepted") {
        const sessionId = sessions.upsertLiveEvent(result.event);
        if (sessionId) {
          indexCanonicalSessionSearch(database, sessionId);
          queueSessionEnrichment(sessionId);
          await importHookTranscriptIfApproved(result.event);
        }
        appendStoreRecordToRawJournal({
          recordId: `event:${result.event.eventId}`,
          recordType: "event",
          observedAt: result.event.occurredAt,
          value: result.event
        });
        const gitSnapshot = await collectGitSnapshot(result.event);
        if (gitSnapshot) await appendGitSnapshotIfChanged(gitSnapshot);
      }
```

If latency is measurable during manual testing, keep the same helper but move the call behind a bounded in-process queue in a follow-up. Do not do that preemptively.

### Verify

- [ ] Run:

```bash
npm test -- --run src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected: all progressive import tests pass.

---

## Phase 3: Make Usage Summary Ignore Tokenless Rows

### Tests First

- [ ] In `src/daemon/db/__tests__/usageStatsRepository.test.ts`, add a model-only row in `seedUsageFixture` after the current null-token row for `session-today-b`.

```ts
insertUsage(db, "usage-model-only", "session-today-b", "gpt-5-model-only", "openai", null, null, null, "2026-06-26T10:09:00.000Z");
```

- [ ] Update the `summarizes today's canonical usage while excluding deleted sessions` expectations:

```ts
expect(stats.totals).toMatchObject({
  fileEffects: 3,
  inputTokens: 100,
  mcpQueries: 2,
  messages: 3,
  models: 1,
  outputTokens: 50,
  projects: 2,
  runtimes: 2,
  sessions: 2,
  tokenCoverageSessions: 1,
  tokenRows: 1,
  toolCalls: 3,
  totalTokens: 150
});
```

`stats.byModel` should contain only the real token row:

```ts
expect(stats.byModel).toEqual([
  {
    inputTokens: 100,
    model: "gpt-5",
    outputTokens: 50,
    provider: "openai",
    sessions: 1,
    totalTokens: 150
  }
]);
```

Coverage should treat the tokenless current session as missing token usage:

```ts
expect(stats.coverage).toEqual({
  currentEnrichments: 3,
  importedSessions: 3,
  mcpQueries: 3,
  sessionsWithTokenUsage: 2,
  sessionsWithoutTokenUsage: 1,
  sources: 2
});
```

- [ ] Update any `stats.activity` expectation for the `10:00` bucket so the model-only row does not affect `totalTokens`.

- [ ] Run:

```bash
npm test -- --run src/daemon/db/__tests__/usageStatsRepository.test.ts
```

Expected before implementation: token row count, token coverage, model count, by-model output, and coverage fail because tokenless rows are still counted in at least some paths.

### Implementation

- [ ] In `src/daemon/db/usageStatsRepository.ts`, add these constants near the row type declarations:

```ts
const TOKEN_VALUE_PRESENT_SQL = `(model_usage.total_tokens IS NOT NULL OR model_usage.input_tokens IS NOT NULL OR model_usage.output_tokens IS NOT NULL)`;
const TOKEN_TOTAL_SQL = `COALESCE(model_usage.total_tokens, COALESCE(model_usage.input_tokens, 0) + COALESCE(model_usage.output_tokens, 0))`;
```

- [ ] In `getSessionTokenTotals`, replace the inline token-present condition with `${TOKEN_VALUE_PRESENT_SQL}` and use `${TOKEN_TOTAL_SQL}` if needed. Preserve the existing behavior.

- [ ] In `countModels`, add:

```sql
        AND ${TOKEN_VALUE_PRESENT_SQL}
```

This keeps `totals.models` aligned with token usage rather than model-only hook metadata.

- [ ] In `getTokenTotals`, add `${TOKEN_VALUE_PRESENT_SQL}` to the `WHERE` clause and sum total tokens with `${TOKEN_TOTAL_SQL}`.

The query should include:

```sql
        COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
```

and:

```sql
        AND ${TOKEN_VALUE_PRESENT_SQL}
```

- [ ] In `getUsageByModel`, add `${TOKEN_VALUE_PRESENT_SQL}` to the `WHERE` clause and use `${TOKEN_TOTAL_SQL}` for `totalTokens`.

- [ ] In `getUsageByProject` and `getUsageByRuntime`, update each `token_counts` CTE:

```sql
token_counts AS (
  SELECT session_id, COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
  FROM model_usage
  WHERE (? IS NULL OR observed_at >= ?)
    AND observed_at <= ?
    AND ${TOKEN_VALUE_PRESENT_SQL}
  GROUP BY session_id
)
```

If the table is not aliased as `model_usage` inside a CTE, either alias it:

```sql
FROM model_usage AS model_usage
```

or define a second unqualified predicate. Prefer the alias so there is one predicate constant.

- [ ] In `getUsageActivity`, change the `model_usage` activity call from:

```ts
"sessions.deleted_at IS NULL"
```

to:

```ts
`sessions.deleted_at IS NULL AND ${TOKEN_VALUE_PRESENT_SQL}`
```

and use `${TOKEN_TOTAL_SQL}` for the aggregate.

- [ ] In `getUsageCoverage`, update `sessionsWithTokenUsage`:

```sql
WHERE sessions.deleted_at IS NULL
  AND ${TOKEN_VALUE_PRESENT_SQL}
```

### Verify

- [ ] Run:

```bash
npm test -- --run src/daemon/db/__tests__/usageStatsRepository.test.ts
```

Expected: all usage stats tests pass.

---

## Phase 4: Integrated Verification

- [ ] Run the focused suite:

```bash
npm test -- --run src/daemon/db/__tests__/sessionRepository.test.ts src/daemon/import/__tests__/progressiveImport.test.ts src/daemon/db/__tests__/usageStatsRepository.test.ts
```

Expected: all selected tests pass.

- [ ] Run related API/server tests:

```bash
npm test -- --run src/core/__tests__/ingestServer.test.ts src/daemon/__tests__/dataApi.test.ts src/daemon/__tests__/server.test.ts
```

Expected: all selected tests pass.

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] Run the citation guard:

```bash
npm run verify:no-citations
```

Expected: exits 0.

- [ ] Start local Masthead:

```bash
npm run dev
```

Expected: connector is available at `http://127.0.0.1:17373`; UI starts on the first available UI port beginning at `5173`.

- [ ] Verify endpoints:

```bash
curl -s 'http://127.0.0.1:17373/usage/summary?window=today'
curl -s 'http://127.0.0.1:17373/projection'
```

Expected:

- `/usage/summary?window=today` has nonzero `totalTokens` after the current transcript has at least one imported `token_count` row.
- `totals.tokenRows` counts only rows with numeric token values.
- `totals.tokenCoverageSessions` and `coverage.sessionsWithTokenUsage` do not count model-only hook sessions.
- Board/session DTOs include `totalTokens` for sessions whose transcript token rows have been imported.

- [ ] Use the Codex in-app Browser plugin with the `iab` backend first. Inspect the local UI:

  - Board card token fact for an active or recently imported session.
  - Usage surface totals.
  - Sidebar Today usage.

Expected:

- Token values render for sessions whose transcripts were caught up.
- No `No live connection` state.
- No Board card displays `-` for a session that has imported numeric token rows.

- [ ] Run doctor:

```bash
npm run doctor:json
```

Expected:

- `usage-summary` no longer warns about sessions today with token rows but zero total tokens once at least one current transcript token count has been imported.
- Any remaining warning is explainable by truly absent transcript token data or transcript import not being approved, not by model-only hook rows.

---

## Phase 5: Optional Documentation

- [ ] Only update `docs/reference/usage-statistics.md` if a durable public contract clarification is useful.

Suggested sentence:

```md
`model_usage` rows are counted as token usage only when at least one token column is present; model-only hook metadata does not count toward token coverage.
```

- [ ] If docs changed, rerun:

```bash
npm run typecheck
npm run verify:no-citations
```

---

## Closeout Criteria

The implementation is complete when all of these are true:

- A model-only live hook creates a canonical session but no `model_usage` row.
- An approved hook with a valid `transcriptPath` imports transcript token rows during live ingestion.
- A repeated hook for the same transcript tails from the saved cursor and does not duplicate prior token rows.
- An unapproved hook does not import transcript content.
- A missing or unreadable transcript path does not make `/ingest` fail.
- Usage totals, model counts, token rows, activity, and coverage ignore tokenless rows.
- Board cards and session DTOs show token totals for sessions with imported numeric token rows.
- Focused tests, related API/server tests, typecheck, no-citation guard, endpoint checks, Browser verification, and doctor all pass or have documented pre-existing failures.

## Risks And Follow-Ups

- Inline transcript catch-up adds file IO to `/ingest`. The cursor path should keep repeated imports small. If manual verification shows meaningful latency, move the helper behind a bounded in-process queue in a follow-up.
- This plan intentionally avoids a new model-metadata table. If Masthead needs model filtering for hook-only sessions later, add a separate session-level model field or `session_models` table rather than using token usage rows.
- This plan does not clean or rewrite existing DB rows. Existing tokenless `model_usage` rows become harmless because usage reads filter them out. A cleanup migration is not needed for this bug and should not be added in this fix.
- Transcript import still depends on persisted transcript approval. If a local install has not approved transcript import, new live sessions will continue to have no token totals until approval is granted; that is the privacy boundary, not a parser failure.
