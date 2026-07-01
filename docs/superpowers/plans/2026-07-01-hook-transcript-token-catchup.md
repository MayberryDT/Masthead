# Hook Transcript Token Catch-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure live Codex hook sessions import the approved transcript JSONL files referenced by hook payloads, so current sessions get real transcript messages and token usage instead of staying hook-only.

**Architecture:** Keep the existing privacy boundary: transcript import only runs after persisted transcript approval. Fix the dev launcher so it no longer disables the already-implemented hook transcript catch-up by default, add a bounded recovery sweep for recent hook payloads already stored with `transcriptPath`, strengthen integration coverage for transcript messages plus token counts, and add diagnostics that make hook-only capture states obvious. Do not replace the transcript parser, source approval model, or canonical session schema.

**Tech Stack:** Node.js 24, TypeScript, Vitest, SQLite via `node:sqlite`, existing Masthead daemon HTTP APIs, existing Codex JSONL transcript importer.

**Optimizer Result:** Best score `96/100`, trajectory `86 -> 94 -> 96 -> 96`. Main improvements: added recovery for already-captured hook-only sessions, corrected the doctor check to use normalized hook event shape, and tightened rollout/verification gates around approval and opt-out behavior.

---

## Background

Diagnosis page: `sessions/2026/07/masthead-transcript-token-capture-diagnosis`.

Observed failure:

- Current live sessions have many hook/tool rows but zero `model_usage` rows.
- Current live session message rows are placeholder text such as `Codex hook event`.
- Hook payloads include `payload.transcriptPath`.
- The referenced transcript JSONL files exist and contain `response_item` message rows and `token_count` rows.
- Transcript import approval exists in `source_policies`.
- `src/daemon/server.ts` already has `scheduleHookTranscriptCatchup(event)` and `importHookTranscriptIfApproved(event)`.
- `src/daemon/config.ts` defaults `hookTranscriptCatchupEnabled` to enabled unless `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP === "0"`.
- `scripts/masthead-live-dev.js` currently forces `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP` to `"0"` when the environment variable is not set, so `npm run dev` disables live transcript catch-up by default.
- A future-only default fix is not enough for sessions already captured while catch-up was disabled. Those raw hook events are still in `raw_events` with normalized `sessionId` and `payload.transcriptPath`, so a bounded recovery sweep can repair recent hook-only sessions after approval.

Non-goals:

- Do not make transcript import bypass approval.
- Do not run broad historical transcript imports automatically.
- Do not rewrite the Codex adapter or the canonical schema.
- Do not turn Masthead into a live monitoring console. This is a session data correctness fix.

## File Structure

- Create `src/core/liveDevDaemonEnv.ts`
  - Owns the environment variables passed from `scripts/masthead-live-dev.js` to the daemon process.
  - Makes launcher defaults testable without spawning the full dev app.

- Create `src/core/__tests__/liveDevDaemonEnv.test.ts`
  - Verifies hook transcript catch-up defaults to enabled in the dev launcher.
  - Verifies explicit opt-out still works.
  - Verifies existing live-copy and remote-enrichment launcher defaults remain unchanged.

- Modify `scripts/masthead-live-dev.js`
  - Import `buildLiveDevDaemonEnv` from the compiled daemon bundle.
  - Replace the inline collector env object with the tested helper.

- Modify `src/daemon/__tests__/config.test.ts`
  - Codify that daemon config enables hook transcript catch-up by default.

- Modify `src/daemon/import/__tests__/progressiveImport.test.ts`
  - Strengthen the existing approved hook transcript test so it proves both token rows and real user/assistant transcript messages are imported.
  - Add an explicit-disabled diagnostic regression test.
  - Add recovery regression coverage for transcript paths that were stored before approval or while catch-up was disabled.
  - Allow `createTestHarness` to override `hookTranscriptCatchupEnabled`.

- Modify `src/daemon/server.ts`
  - Emit a one-shot runtime diagnostic when a hook includes `transcriptPath` but hook transcript catch-up is explicitly disabled.
  - Schedule bounded catch-up for recent stored hook events on startup and after transcript approval.
  - Keep the existing catch-up queue and approval gate.

- Modify `scripts/masthead-doctor.js`
  - Add a read-only check for recent normalized hook events that have `payload.transcriptPath` but no useful transcript or token rows.
  - Warn with a concrete repair recommendation instead of silently reporting healthy hooks.

- Modify `docs/reference/daemon-api.md`
  - Document that approved hook transcript catch-up runs after `/ingest`.
  - Document the opt-out flag and doctor warning.

## Success Criteria

- `npm run dev` starts the primary daemon with hook transcript catch-up enabled by default.
- `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0 npm run dev` still disables live catch-up for responsive debugging.
- If transcript import is not approved, a hook with `transcriptPath` still does not import transcript contents.
- If transcript import is approved, a hook with `transcriptPath` imports both:
  - useful `messages` rows from `response_item` transcript records,
  - `model_usage` token rows from `token_count` transcript records.
- Recent hook events that were stored before approval or while catch-up was disabled are recovered after approval or daemon restart, bounded to recent normalized hook payloads with transcript paths.
- Hook ingestion remains fail-open if the transcript path is missing, excluded, malformed, or unreadable.
- `npm run doctor` warns when recent hook sessions are hook-only despite having transcript paths.
- Dossier and Logbook continue to surface hook-only sessions as incomplete instead of pretending they have useful transcript data.

---

### Task 1: Make Dev Launcher Transcript Catch-Up Defaults Testable

**Files:**

- Create: `src/core/liveDevDaemonEnv.ts`
- Create: `src/core/__tests__/liveDevDaemonEnv.test.ts`
- Modify: `scripts/masthead-live-dev.js`

- [ ] **Step 1: Write the failing helper test**

Create `src/core/__tests__/liveDevDaemonEnv.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildLiveDevDaemonEnv } from "../liveDevDaemonEnv";

const baseInput = {
  allowedOrigins: "http://127.0.0.1:5173",
  dataDirectory: "/tmp/masthead-data",
  diagnosticLogFile: "/tmp/masthead-data/runtime/daemon.log",
  host: "127.0.0.1",
  port: 17373
};

describe("live dev daemon environment", () => {
  test("enables hook transcript catch-up by default", () => {
    const env = buildLiveDevDaemonEnv({ ...baseInput, env: {} });

    expect(env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP).toBe("1");
  });

  test("keeps explicit hook transcript catch-up opt-out", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: { MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0" }
    });

    expect(env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP).toBe("0");
  });

  test("preserves existing responsive dev defaults", () => {
    const env = buildLiveDevDaemonEnv({ ...baseInput, env: {} });

    expect(env).toMatchObject({
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MASTHEAD_DATA_DIR: "/tmp/masthead-data",
      MASTHEAD_DIAGNOSTIC_LOG_FILE: "/tmp/masthead-data/runtime/daemon.log",
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "0",
      MASTHEAD_PORT: "17373",
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
      MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "1"
    });
  });

  test("enables live copy by default when an OpenAI key is inherited", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    expect(env.MASTHEAD_LIVE_COPY).toBe("1");
    expect(env.MASTHEAD_LLM_COPY).toBe("0");
    expect(env.MASTHEAD_REMOTE_ENRICHMENT).toBe("0");
  });

  test("keeps explicit launcher overrides", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: {
        MASTHEAD_DEV_NODE_OPTIONS: "--trace-warnings",
        MASTHEAD_GIT_REFRESH_MS: "2500",
        MASTHEAD_LIVE_COPY: "0",
        MASTHEAD_LLM_COPY: "1",
        MASTHEAD_REMOTE_ENRICHMENT: "1",
        MASTHEAD_SKIP_BACKGROUND_HYDRATION: "0",
        MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "0"
      }
    });

    expect(env).toMatchObject({
      MASTHEAD_GIT_REFRESH_MS: "2500",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "1",
      MASTHEAD_REMOTE_ENRICHMENT: "1",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "0",
      MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "0",
      NODE_OPTIONS: "--trace-warnings"
    });
  });
});
```

- [ ] **Step 2: Run the failing helper test**

Run:

```bash
npx vitest --run src/core/__tests__/liveDevDaemonEnv.test.ts
```

Expected: FAIL because `src/core/liveDevDaemonEnv.ts` does not exist.

- [ ] **Step 3: Add the helper implementation**

Create `src/core/liveDevDaemonEnv.ts`:

```ts
export type LiveDevDaemonEnvInput = {
  allowedOrigins: string;
  dataDirectory: string;
  diagnosticLogFile: string;
  env: NodeJS.ProcessEnv;
  host: string;
  port: number;
};

export function buildLiveDevDaemonEnv(input: LiveDevDaemonEnvInput): NodeJS.ProcessEnv {
  const env = input.env;
  return {
    MASTHEAD_ALLOWED_ORIGINS: input.allowedOrigins,
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DIAGNOSTIC_LOG_FILE: input.diagnosticLogFile,
    MASTHEAD_GIT_REFRESH_MS: env.MASTHEAD_GIT_REFRESH_MS ?? "0",
    MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP ?? "1",
    MASTHEAD_HOST: input.host,
    MASTHEAD_LIVE_COPY: env.MASTHEAD_LIVE_COPY ?? (env.OPENAI_API_KEY ? "1" : "0"),
    MASTHEAD_LLM_COPY: env.MASTHEAD_LLM_COPY ?? "0",
    MASTHEAD_PORT: String(input.port),
    MASTHEAD_REMOTE_ENRICHMENT: env.MASTHEAD_REMOTE_ENRICHMENT ?? "0",
    MASTHEAD_SKIP_BACKGROUND_HYDRATION: env.MASTHEAD_SKIP_BACKGROUND_HYDRATION ?? "1",
    MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: env.MASTHEAD_SKIP_MIGRATION_QUICK_CHECK ?? "1",
    NODE_OPTIONS: env.MASTHEAD_DEV_NODE_OPTIONS ?? ""
  };
}
```

- [ ] **Step 4: Wire the helper into the dev launcher**

Modify the imports at the top of `scripts/masthead-live-dev.js`:

```js
import { removeDaemonOwnershipMetadata, writeDaemonOwnershipMetadata } from "../dist/daemon/src/core/daemonOwnership.js";
import { buildLiveDevDaemonEnv } from "../dist/daemon/src/core/liveDevDaemonEnv.js";
import { buildLiveDevPlan, startReadOnlyConnectorBridge } from "../dist/daemon/src/core/worktreeConnector.js";
```

Replace the inline `extraEnv` object in the collector `start(...)` call with:

```js
    collector = start(
      "collector",
      process.execPath,
      ["dist/daemon/src/daemon/main.js"],
      buildLiveDevDaemonEnv({
        allowedOrigins: plan.allowedOrigins,
        dataDirectory: plan.connector.dataDirectory,
        diagnosticLogFile: join(plan.connector.dataDirectory, "runtime", "daemon.log"),
        env: process.env,
        host: plan.host,
        port: plan.connector.port
      })
    );
```

Do not change the bridge path. Bridges are read-only and do not own hook ingestion.

- [ ] **Step 5: Run the helper test**

Run:

```bash
npx vitest --run src/core/__tests__/liveDevDaemonEnv.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run daemon build to prove the script import target exists**

Run:

```bash
npm run build:daemon
```

Expected: PASS and `dist/daemon/src/core/liveDevDaemonEnv.js` exists.

- [ ] **Step 7: Commit**

```bash
git add src/core/liveDevDaemonEnv.ts src/core/__tests__/liveDevDaemonEnv.test.ts scripts/masthead-live-dev.js
git commit -m "fix: enable live transcript catch-up in dev launcher"
```

---

### Task 2: Codify Daemon Config Default

**Files:**

- Modify: `src/daemon/__tests__/config.test.ts`

- [ ] **Step 1: Add the default-enabled config test**

In `src/daemon/__tests__/config.test.ts`, add this test near the existing hook transcript catch-up test:

```ts
  test("enables hook transcript catch-up by default", () => {
    const config = daemonConfigFromEnv({});

    expect(config.hookTranscriptCatchupEnabled).toBe(true);
  });
```

Keep the existing test:

```ts
  test("can disable hook transcript catch-up for responsive live previews", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0" });

    expect(config.hookTranscriptCatchupEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run the config test**

Run:

```bash
npx vitest --run src/daemon/__tests__/config.test.ts
```

Expected: PASS. This should already pass because `src/daemon/config.ts` has the correct daemon-level default.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/__tests__/config.test.ts
git commit -m "test: lock daemon transcript catch-up default"
```

---

### Task 3: Prove Approved Hook Catch-Up Imports Messages And Tokens

**Files:**

- Modify: `src/daemon/import/__tests__/progressiveImport.test.ts`

- [ ] **Step 1: Strengthen the existing live hook transcript test**

In `src/daemon/import/__tests__/progressiveImport.test.ts`, replace the current test named:

```ts
  test("imports token counts from approved hook transcriptPath during live ingestion", async () => {
```

with:

```ts
  test("imports messages and token counts from approved hook transcriptPath during live ingestion", async () => {
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
        type: "response_item",
        timestamp: "2026-06-25T12:00:30.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Capture this live transcript." }]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:00:45.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "The transcript was imported after the hook arrived." }]
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
    const sessionId = sessionIdFor(daemon.database, "live-token-session");
    await waitFor(() => countWhere(daemon.database, "messages", "session_id = ? AND role = 'assistant'", sessionId) === 1);

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countWhere(daemon.database, "messages", "session_id = ? AND role = 'user'", sessionId)).toBe(1);
    expect(countWhere(daemon.database, "messages", "session_id = ? AND role = 'assistant'", sessionId)).toBe(1);
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

    const transcript = await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`);

    expect(transcript).toMatchObject({
      ok: true,
      coverage: {
        assistantMessages: 1,
        hasUsableTranscript: true,
        userMessages: 1
      }
    });
    expect(transcript.items.map((item) => item.text)).toEqual(
      expect.arrayContaining(["Capture this live transcript.", "The transcript was imported after the hook arrived."])
    );
  });
```

- [ ] **Step 2: Run the focused import test**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "imports messages and token counts from approved hook transcriptPath during live ingestion"
```

Expected: PASS if the existing importer already handles messages. If it fails, inspect the failed assertion before changing importer code. The fix should stay in the hook catch-up/import path, not the UI.

- [ ] **Step 3: Re-run the surrounding hook catch-up tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "hook transcriptPath"
```

Expected: PASS for:

- approved import,
- no import before approval,
- missing transcript fail-open,
- absent transcript path fail-open,
- symlink escape rejection.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/import/__tests__/progressiveImport.test.ts
git commit -m "test: cover live hook transcript messages"
```

---

### Task 4: Add Runtime Diagnostic When Catch-Up Is Explicitly Disabled

**Files:**

- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/import/__tests__/progressiveImport.test.ts`

- [ ] **Step 1: Add a failing diagnostic regression test**

In `src/daemon/import/__tests__/progressiveImport.test.ts`, update the test harness signature:

```ts
async function createTestHarness(options: { hookTranscriptCatchupEnabled?: boolean } = {}): Promise<{ daemon: MastheadDaemon; tempDir: string; codexRoot: string }> {
```

Inside the config object, replace:

```ts
    hookTranscriptCatchupEnabled: true,
```

with:

```ts
    hookTranscriptCatchupEnabled: options.hookTranscriptCatchupEnabled ?? true,
```

Add this test after `does not import hook transcriptPath before transcript import approval`:

```ts
  test("records a runtime diagnostic when hook transcript catch-up is disabled", async () => {
    const { daemon, codexRoot } = await createTestHarness({ hookTranscriptCatchupEnabled: false });
    const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "disabled-catchup-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: { session_id: "disabled-catchup-session", model: "gpt-5" }
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

    await postJson(baseUrl, "/adapters/codex/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "disabled-catchup-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });
    await yieldToEventLoop();

    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    const response = await fetch(`${baseUrl}/diagnostics/runtime`, { headers: { accept: "application/json" } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      diagnostics?: { events?: Array<{ details?: unknown; kind?: string; message?: string; severity?: string }> };
    };
    expect(body.diagnostics?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hook_transcript_catchup_disabled",
          message: "Codex hook included a transcriptPath, but hook transcript catch-up is disabled.",
          severity: "warning"
        })
      ])
    );
  });
```

- [ ] **Step 2: Run the failing diagnostic test**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "records a runtime diagnostic when hook transcript catch-up is disabled"
```

Expected: FAIL because no runtime diagnostic is emitted yet.

- [ ] **Step 3: Emit the one-shot diagnostic**

In `src/daemon/server.ts`, near:

```ts
  const hookTranscriptCatchups = new Map<string, Promise<void>>();
```

add:

```ts
  const disabledHookTranscriptCatchupDiagnostics = new Set<string>();
```

Replace `scheduleHookTranscriptCatchup` with:

```ts
  function scheduleHookTranscriptCatchup(event: NormalizedEvent): void {
    const transcriptPath = stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]);
    const key = transcriptPath ?? event.eventId;
    if (!config.hookTranscriptCatchupEnabled) {
      if (transcriptPath && !disabledHookTranscriptCatchupDiagnostics.has(key)) {
        disabledHookTranscriptCatchupDiagnostics.add(key);
        if (disabledHookTranscriptCatchupDiagnostics.size > 100) disabledHookTranscriptCatchupDiagnostics.clear();
        recordRuntimeDiagnostic({
          details: {
            eventId: event.eventId,
            sourceSessionId: event.sourceSessionId,
            transcriptPath
          },
          kind: "hook_transcript_catchup_disabled",
          message: "Codex hook included a transcriptPath, but hook transcript catch-up is disabled.",
          severity: "warning"
        });
      }
      return;
    }
    const previous = hookTranscriptCatchups.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(resolve);
          })
      )
      .then(() => importHookTranscriptIfApproved(event))
      .finally(() => {
        if (hookTranscriptCatchups.get(key) === next) hookTranscriptCatchups.delete(key);
      });
    hookTranscriptCatchups.set(key, next);
    next.catch(() => {
      // importHookTranscriptIfApproved records diagnostics; this prevents unhandled rejections.
    });
  }
```

This keeps the existing queue behavior and only adds a warning for the explicit disabled state.

- [ ] **Step 4: Run the diagnostic test**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "records a runtime diagnostic when hook transcript catch-up is disabled"
```

Expected: PASS.

- [ ] **Step 5: Run all progressive import tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/server.ts src/daemon/import/__tests__/progressiveImport.test.ts
git commit -m "chore: diagnose disabled hook transcript catch-up"
```

---

### Task 5: Recover Recent Stored Hook Transcript Paths

**Files:**

- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/import/__tests__/progressiveImport.test.ts`

This task closes the gap for sessions that were already captured while transcript catch-up was unavailable. It is not a broad historical transcript import. It only replays recent normalized hook events already stored in `raw_events` when those events include `payload.transcriptPath`, and it still requires transcript import approval.

- [ ] **Step 1: Add a failing recovery test for hooks captured before approval**

In `src/daemon/import/__tests__/progressiveImport.test.ts`, add this test after the approved live hook catch-up test:

```ts
  test("recovers recent stored hook transcriptPath events after transcript approval", async () => {
    const { daemon, codexRoot } = await createTestHarness();
    const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "approval-recovery-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "approval-recovery-session",
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:00:30.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Recover this stored hook transcript." }]
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 11,
              output_tokens: 4,
              total_tokens: 15
            }
          }
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "approval-recovery-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });
    await yieldToEventLoop();
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    await postJson(baseUrl, "/adapters/codex/approve-transcripts");

    await waitFor(() => tokenTotals(daemon.database).totalTokens === 15);
    const sessionId = sessionIdFor(daemon.database, "approval-recovery-session");
    expect(countWhere(daemon.database, "messages", "session_id = ? AND role = 'user'", sessionId)).toBe(1);
    expect(tokenTotals(daemon.database)).toEqual({
      inputTokens: 11,
      outputTokens: 4,
      totalTokens: 15
    });
  });
```

- [ ] **Step 2: Add a failing startup recovery test**

First update `createTestHarness` so it can reuse a temp directory and database across daemon instances:

```ts
async function createTestHarness(
  options: { hookTranscriptCatchupEnabled?: boolean; tempDir?: string } = {}
): Promise<{ daemon: MastheadDaemon; tempDir: string; codexRoot: string }> {
  const tempDir = options.tempDir ?? (await mkdtemp(join(tmpdir(), "masthead-progressive-import-")));
  if (!options.tempDir) tempDirs.push(tempDir);
  const codexRoot = join(tempDir, ".codex");
  await mkdir(codexRoot, { recursive: true });
  const config: DaemonConfig = {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: options.hookTranscriptCatchupEnabled ?? true,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson")
  };
  const daemon = await createMastheadDaemon(config);
  daemons.push(daemon);
  return { codexRoot, daemon, tempDir };
}
```

Add this helper near the other helpers:

```ts
async function closeTrackedDaemon(daemon: MastheadDaemon): Promise<void> {
  const index = daemons.indexOf(daemon);
  if (index >= 0) daemons.splice(index, 1);
  await daemon.close();
}
```

Add this test after the approval recovery test:

```ts
  test("recovers approved stored hook transcriptPath events on daemon startup", async () => {
    const first = await createTestHarness({ hookTranscriptCatchupEnabled: false });
    const transcriptPath = join(first.codexRoot, "sessions", "2026", "06", "25", "startup-recovery-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "startup-recovery-session",
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:00:30.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Recovered after daemon restart." }]
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 20,
              output_tokens: 6,
              total_tokens: 26
            }
          }
        }
      }
    ]);
    const firstBaseUrl = await listen(first.daemon);

    await postJson(firstBaseUrl, "/adapters/codex/approve-transcripts");
    await ingestHook(firstBaseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "startup-recovery-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });
    await yieldToEventLoop();
    expect(tokenTotals(first.daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    await closeTrackedDaemon(first.daemon);

    const second = await createTestHarness({ tempDir: first.tempDir });
    await listen(second.daemon);

    await waitFor(() => tokenTotals(second.daemon.database).totalTokens === 26);
    const sessionId = sessionIdFor(second.daemon.database, "startup-recovery-session");
    expect(countWhere(second.daemon.database, "messages", "session_id = ? AND role = 'assistant'", sessionId)).toBe(1);
  });
```

- [ ] **Step 3: Run the failing recovery tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "recovers"
```

Expected: FAIL because stored hook transcript paths are not replayed after approval or startup yet.

- [ ] **Step 4: Add bounded recent hook event discovery**

In `src/daemon/server.ts`, near `LIVE_BOARD_RAW_RECORD_LIMIT`, add:

```ts
const HOOK_TRANSCRIPT_RECOVERY_LIMIT = 25;
```

Near `scheduleHookTranscriptCatchup`, add:

```ts
  function scheduleRecentHookTranscriptCatchups(reason: "approval" | "startup"): void {
    if (!config.hookTranscriptCatchupEnabled || !transcriptImportApproved(database)) return;
    const events = recentHookEventsWithTranscriptPaths(database, HOOK_TRANSCRIPT_RECOVERY_LIMIT);
    if (events.length === 0) return;

    recordRuntimeDiagnostic({
      details: {
        limit: HOOK_TRANSCRIPT_RECOVERY_LIMIT,
        reason,
        scheduled: events.length
      },
      kind: "hook_transcript_catchup_recovery_scheduled",
      message: `Scheduled ${events.length} recent Codex hook transcript catch-up${events.length === 1 ? "" : "s"}.`,
      severity: "info"
    });

    for (const event of events) scheduleHookTranscriptCatchup(event);
  }

  function recentHookEventsWithTranscriptPaths(db: MastheadDatabase, limit: number): NormalizedEvent[] {
    const rows = db
      .prepare(
        `SELECT payload_json AS payloadJson
        FROM raw_events
        WHERE source_id = ?
          AND source_kind = 'hook'
          AND payload_json LIKE '%"transcriptPath"%'
        ORDER BY observed_at DESC
        LIMIT ?`
      )
      .all(codexHookSource.sourceId, limit) as Array<{ payloadJson: string }>;

    const seenTranscriptPaths = new Set<string>();
    const events: NormalizedEvent[] = [];
    for (const row of rows) {
      const event = parseNormalizedHookEvent(row.payloadJson);
      const transcriptPath = event ? stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]) : undefined;
      if (!event || !transcriptPath || seenTranscriptPaths.has(transcriptPath)) continue;
      seenTranscriptPaths.add(transcriptPath);
      events.push(event);
    }
    return events.toReversed();
  }

  function parseNormalizedHookEvent(payloadJson: string): NormalizedEvent | undefined {
    try {
      const parsed = JSON.parse(payloadJson) as unknown;
      if (!isRecord(parsed) || !isRecord(parsed.payload)) return undefined;
      if (typeof parsed.eventId !== "string" || typeof parsed.occurredAt !== "string") return undefined;
      if (!isRecord(parsed.source) || parsed.source.adapter !== "codex" || parsed.source.surface !== "hook") return undefined;
      if (!stringFromPayload(parsed.payload, ["transcriptPath", "transcript_path"])) return undefined;
      return parsed as NormalizedEvent;
    } catch {
      return undefined;
    }
  }
```

If `src/daemon/server.ts` does not already have a local `isRecord` helper, add this near the bottom of the file:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 5: Schedule recovery after approval**

In `approveTranscriptImports(runtime?: RuntimeKind)`, after the runtime policy block, add:

```ts
    if (!runtime || runtime === "codex") scheduleRecentHookTranscriptCatchups("approval");
```

The function should become:

```ts
  function approveTranscriptImports(runtime?: RuntimeKind): void {
    approveTranscriptImport(database, {
      approvedAt: new Date().toISOString(),
      reason: "Source exclusions reviewed before transcript ingestion."
    });
    if (runtime) {
      setRuntimePolicy(database, {
        decidedAt: new Date().toISOString(),
        enabled: true,
        policyKind: "transcript_import",
        reason: "Coding harness transcript import approved.",
        runtime
      });
    }
    if (!runtime || runtime === "codex") scheduleRecentHookTranscriptCatchups("approval");
  }
```

- [ ] **Step 6: Schedule recovery on daemon startup**

Before the `return { server, database, ... }` block near the end of `createMastheadDaemon`, add:

```ts
  queueMicrotask(() => {
    scheduleRecentHookTranscriptCatchups("startup");
  });
```

This keeps startup responsive because actual transcript imports still go through the existing async catch-up queue.

- [ ] **Step 7: Run recovery tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts -t "recovers"
```

Expected: PASS.

- [ ] **Step 8: Run all progressive import tests**

Run:

```bash
npx vitest --run src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/server.ts src/daemon/import/__tests__/progressiveImport.test.ts
git commit -m "fix: recover recent hook transcript catch-ups"
```

---

### Task 6: Add Doctor Check For Hook-Only Sessions With Transcript Paths

**Files:**

- Modify: `scripts/masthead-doctor.js`

- [ ] **Step 1: Add the doctor check to the check list**

Near the top of `scripts/masthead-doctor.js`, after:

```js
checks.push(await checkUsage());
```

add:

```js
checks.push(await checkHookTranscriptCapture());
```

- [ ] **Step 2: Add the read-only SQLite check**

In `scripts/masthead-doctor.js`, add this function after `checkUsage()`:

```js
async function checkHookTranscriptCapture() {
  const data = isRecord(health?.data) ? health.data : {};
  const databasePath = stringValue(data.databasePath);
  if (!databasePath) {
    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: "Health did not expose a database path for hook transcript capture checks.",
      details: { baseUrl }
    };
  }

  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const hookRows = db
      .prepare(
        `SELECT observed_at AS observedAt, payload_json AS payloadJson
        FROM raw_events
        WHERE source_id = 'codex-hook-local'
          AND source_kind = 'hook'
          AND payload_json LIKE '%"transcriptPath"%'
        ORDER BY observed_at DESC
        LIMIT 100`
      )
      .all();
    const selectSession = db.prepare(
      `SELECT session_id AS sessionId, source_session_id AS sourceSessionId, title, last_activity_at AS lastActivityAt
      FROM sessions
      WHERE runtime = 'codex'
        AND deleted_at IS NULL
        AND source_session_id = ?
      ORDER BY last_activity_at DESC
      LIMIT 1`
    );
    const selectMessages = db.prepare(
      `SELECT
        COUNT(*) AS messages,
        SUM(
          CASE
            WHEN lower(trim(text_redacted)) NOT IN ('codex hook event', 'runtime signal', 'tool call', 'shell', 'unknown')
              AND lower(trim(text_redacted)) NOT LIKE 'codex hook event:%'
            THEN 1
            ELSE 0
          END
        ) AS usefulMessages
      FROM messages
      WHERE session_id = ?`
    );
    const selectUsage = db.prepare(
      `SELECT COUNT(*) AS usageRows, COALESCE(SUM(COALESCE(total_tokens, 0)), 0) AS totalTokens
      FROM model_usage
      WHERE session_id = ?`
    );

    const seen = new Set();
    const stuckSessions = [];
    for (const row of hookRows) {
      const event = parseDoctorHookEvent(row.payloadJson);
      const sourceSessionId = stringValue(event?.sessionId);
      const transcriptPath = stringValue(event?.payload?.transcriptPath) ?? stringValue(event?.payload?.transcript_path);
      if (!sourceSessionId || !transcriptPath) continue;

      const key = `${sourceSessionId}\0${transcriptPath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const session = selectSession.get(sourceSessionId);
      if (!isRecord(session)) continue;
      const messages = selectMessages.get(session.sessionId);
      const usage = selectUsage.get(session.sessionId);
      const usefulMessages = numberValue(messages?.usefulMessages) ?? 0;
      const usageRows = numberValue(usage?.usageRows) ?? 0;
      if (usefulMessages > 0 || usageRows > 0) continue;

      stuckSessions.push({
        hookObservedAt: row.observedAt,
        lastActivityAt: session.lastActivityAt,
        messages: numberValue(messages?.messages) ?? 0,
        sessionId: session.sessionId,
        sourceSessionId,
        title: session.title,
        totalTokens: numberValue(usage?.totalTokens) ?? 0,
        transcriptPath,
        usageRows
      });
      if (stuckSessions.length >= 10) break;
    }

    if (stuckSessions.length === 0) {
      return {
        id: "hook-transcript-capture",
        label: "hook transcript capture",
        status: "ok",
        message: "Recent Codex hooks with transcript paths are not stuck in a hook-only tokenless state.",
        details: { checkedHookRows: hookRows.length, databasePath, stuckSessions: [] }
      };
    }

    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: `${stuckSessions.length} recent Codex session${stuckSessions.length === 1 ? "" : "s"} have hook transcript paths but no useful transcript messages or token rows.`,
      details: {
        checkedHookRows: hookRows.length,
        databasePath,
        repairRecommendations: [
          "Confirm transcript import is approved in Sources.",
          "Restart npm run dev without MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0.",
          "If the warning is for old rows only, run approved transcript import from Sources."
        ],
        stuckSessions
      }
    };
  } catch (error) {
    return {
      id: "hook-transcript-capture",
      label: "hook transcript capture",
      status: "warn",
      message: errorMessage(error),
      details: { databasePath }
    };
  } finally {
    if (db) db.close();
  }
}

function parseDoctorHookEvent(payloadJson) {
  try {
    const event = JSON.parse(payloadJson);
    if (!isRecord(event) || !isRecord(event.payload)) return undefined;
    return event;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 3: Verify doctor syntax**

Run:

```bash
node --check scripts/masthead-doctor.js
```

Expected: PASS.

- [ ] **Step 4: Run doctor against the active daemon**

Run:

```bash
npm run doctor
```

Expected before restarting the dev daemon: likely WARN for `hook transcript capture` if recent active sessions are still hook-only.

Expected after implementing Tasks 1 and 5 and restarting `npm run dev`: no new active sessions should be stuck hook-only once transcript import is approved, and recent stored hook transcript paths should be queued for bounded recovery.

- [ ] **Step 5: Commit**

```bash
git add scripts/masthead-doctor.js
git commit -m "chore: warn on hook-only transcript capture"
```

---

### Task 7: Keep Dossier Messaging Honest For Hook-Only Coverage

**Files:**

- Modify: `src/daemon/db/sessionDossierRepository.ts`
- Modify: `src/daemon/db/__tests__/sessionDossierRepository.test.ts`
- Modify only if needed: `src/ui/session-dossier/SessionDossier.tsx`
- Modify only if needed: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`

Current state already has:

- `SessionDossierCoverageLevel = "complete" | "partial" | "hook_only" | "metadata_only"`
- `transcript_missing`
- `tokens_missing`
- `low_value_hook_summaries`
- `withCoverageCaveat(...)` that says `Only live hook metadata is available for this session.`

This task is a guardrail. It should produce a small test change only unless the test fails.

- [ ] **Step 1: Add repository-level assertion for hook-only tokenless sessions**

In `src/daemon/db/__tests__/sessionDossierRepository.test.ts`, add this test before `returns undefined for deleted sessions...`:

```ts
  test("labels hook-only tokenless sessions without useful transcript as incomplete capture", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "running",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-hook-only",
      title: "Codex hook event"
    });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session-hook-only");
    db.prepare("DELETE FROM model_usage WHERE session_id = ?").run("session-hook-only");
    db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
      "session-hook-only:hook-message",
      "session-hook-only",
      "user",
      "Codex hook event",
      "2026-06-26T12:00:00.000Z",
      JSON.stringify({ sourceKind: "hook" })
    );
    db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
      "session-hook-only:tool",
      "session-hook-only",
      "shell",
      "2026-06-26T12:01:00.000Z",
      JSON.stringify({ sourceKind: "hook" })
    );

    const dossier = getSessionDossier(db, "session-hook-only");

    expect(dossier?.coverage.level).toBe("hook_only");
    expect(dossier?.coverage.transcript.hasUsableTranscript).toBe(false);
    expect(dossier?.coverage.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "transcript_missing" }),
        expect.objectContaining({ code: "tokens_missing" }),
        expect.objectContaining({ code: "low_value_hook_summaries" })
      ])
    );
    expect(dossier?.narrative.liveSummary).toContain("Only live hook metadata is available for this session.");
    db.close();
  });
```

- [ ] **Step 2: Run the dossier repository test**

Run:

```bash
npx vitest --run src/daemon/db/__tests__/sessionDossierRepository.test.ts -t "labels hook-only tokenless sessions without useful transcript as incomplete capture"
```

Expected: PASS with current code. If it fails, make the smallest change in `src/daemon/db/sessionDossierRepository.ts` so hook-only tokenless sessions include the three warnings above.

- [ ] **Step 3: Do not add new UI copy unless the current UI hides the warnings**

Run:

```bash
npx vitest --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx -t "renders coverage warning and sparse transcript CTA"
```

Expected: PASS. If it fails after backend warning changes, adjust the test fixture to include the backend warnings and keep the visible text concise. Do not add a new onboarding card or marketing copy.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/db/__tests__/sessionDossierRepository.test.ts src/daemon/db/sessionDossierRepository.ts src/ui/session-dossier/SessionDossier.tsx src/ui/session-dossier/__tests__/SessionDossier.test.tsx
git commit -m "test: keep hook-only dossier coverage honest"
```

If `src/daemon/db/sessionDossierRepository.ts`, `src/ui/session-dossier/SessionDossier.tsx`, or `src/ui/session-dossier/__tests__/SessionDossier.test.tsx` were not changed, omit them from `git add`.

---

### Task 8: Document Operational Behavior

**Files:**

- Modify: `docs/reference/daemon-api.md`

- [ ] **Step 1: Update `/ingest` write endpoint documentation**

In `docs/reference/daemon-api.md`, replace:

```md
- `POST /ingest` accepts Codex hook payloads.
```

with:

```md
- `POST /ingest` accepts Codex hook payloads. When a Codex hook includes `transcriptPath`, transcript import has been approved, and `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP` is not `0`, the daemon schedules a bounded catch-up import for that transcript file so live sessions receive canonical messages and token usage. The daemon also performs a bounded recovery sweep for recent stored hook events with transcript paths after transcript approval and on startup.
```

- [ ] **Step 2: Update verification documentation**

At the end of the Verification section, after the existing paragraph, add:

```md

`npm run doctor` also checks recent normalized Codex hook events that include transcript paths but still have no useful transcript messages or token rows. That warning usually means transcript import is not approved, the daemon was started with `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0`, the recovery sweep has not run yet, or the referenced transcript file cannot be imported.
```

- [ ] **Step 3: Run docs grep to confirm the old wording is gone**

Run:

```bash
rg -n "POST /ingest|MASTHEAD_HOOK_TRANSCRIPT_CATCHUP|hook transcript" docs/reference/daemon-api.md
```

Expected: output includes the new `/ingest` behavior and doctor warning.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/daemon-api.md
git commit -m "docs: explain hook transcript catch-up"
```

---

### Task 9: End-To-End Verification

**Files:**

- No planned edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest --run src/core/__tests__/liveDevDaemonEnv.test.ts src/daemon/__tests__/config.test.ts src/daemon/import/__tests__/progressiveImport.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run daemon build**

Run:

```bash
npm run build:daemon
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Restart dev app with default catch-up**

Stop any existing `npm run dev` process for this worktree, then run:

```bash
npm run dev
```

Expected startup behavior:

- primary connector starts normally,
- no `MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0` default is injected,
- UI URL is printed,
- existing transcript approval remains the import gate.

- [ ] **Step 5: Confirm launcher opt-out still works**

Stop the dev app, then run:

```bash
MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0 npm run dev
```

Expected: daemon starts, hook ingestion still works, and a hook payload with `transcriptPath` records the runtime warning instead of importing transcript rows.

- [ ] **Step 6: Run doctor**

With the default dev app running, run:

```bash
npm run doctor
```

Expected:

- `hook transcript capture` is `ok` when new approved hook sessions have transcript/token rows.
- Recent pre-fix hook-only sessions are either backfilled by the bounded recovery sweep or listed with specific stuck-session details.

- [ ] **Step 7: Verify current live behavior with a real hook**

Use an ordinary Codex session that triggers hooks. Then query the active daemon:

```bash
curl -s http://127.0.0.1:17373/usage/summary?window=today | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(JSON.stringify(j.usage.totals,null,2));})'
```

Expected: token totals increase after the hook and transcript catch-up have had time to run.

Then find the newest session and inspect transcript coverage:

```bash
curl -s "http://127.0.0.1:17373/sessions?limit=1" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const id=j.sessions?.[0]?.sessionId; console.log(id);})'
```

Use the printed session ID:

```bash
SESSION_ID="<printed-session-id>"
curl -s "http://127.0.0.1:17373/sessions/${SESSION_ID}/transcript?limit=20" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(JSON.stringify(j.coverage,null,2));})'
```

Expected:

- `hasUsableTranscript: true` for sessions whose transcript file has user/assistant messages,
- `userMessages` and/or `assistantMessages` greater than zero,
- token rows present in usage for that session.

- [ ] **Step 8: Run broader verification**

Run:

```bash
npm run verify:no-citations
npm run check:product-contract
npm run check:surface-contract
npm run check:endpoint-matrix
```

Expected: PASS.

Run the full suite if time permits:

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 9: Final commit if verification caused any follow-up edits**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify hook transcript catch-up"
```

Only commit if there are actual follow-up edits. Do not create an empty commit.

---

## Implementation Notes

- The catch-up path intentionally imports one hook-referenced transcript source at a time. Do not replace it with broad `/sources/codex/import-transcripts` behavior inside `/ingest`.
- `importHookTranscriptIfApproved(event)` must continue returning early when `transcriptImportApproved(database)` is false.
- `transcriptSourceFromHookEvent(event, config.codexHomeDir)` must continue rejecting:
  - missing paths,
  - non-`.jsonl` paths,
  - relative paths,
  - paths outside `$HOME/.codex/sessions` or `$HOME/.codex/archived_sessions`,
  - symlinks that resolve outside those roots.
- Hook ingestion must stay fail-open. Transcript catch-up failure should never make `/ingest` return failure for a valid hook event.
- The doctor query is intentionally read-only and bounded to recent rows. Keep it diagnostic, not a repair command.

## Rollback Plan

If live catch-up causes unacceptable dev responsiveness issues:

1. Start dev with:

```bash
MASTHEAD_HOOK_TRANSCRIPT_CATCHUP=0 npm run dev
```

2. Keep the diagnostic warning so the token/transcript gap is explicit.
3. Investigate importer performance separately with a bounded cursor or chunk-size improvement.

Do not remove transcript approval checks to work around performance issues.

## Self-Review

Spec coverage:

- Fixes live dev default that disabled hook transcript catch-up.
- Preserves explicit opt-out.
- Preserves transcript approval privacy gate.
- Tests approved hook catch-up for both messages and token counts.
- Tests unapproved behavior remains blocked.
- Tests bounded recovery for recent stored hook transcript paths after approval and startup.
- Adds runtime and doctor diagnostics for hook-only transcript gaps.
- Keeps dossier messaging honest for hook-only sessions.
- Documents operational behavior.

Placeholder scan:

- No `TBD`, `TODO`, or open-ended implementation steps are present.
- Code-changing steps include concrete code snippets.
- Verification commands include expected outcomes.

Type consistency:

- `buildLiveDevDaemonEnv` is created in `src/core/liveDevDaemonEnv.ts` and imported from `../liveDevDaemonEnv` in tests.
- `scripts/masthead-live-dev.js` imports the compiled helper from `../dist/daemon/src/core/liveDevDaemonEnv.js`, matching `tsconfig.daemon.json`.
- Diagnostic kind is consistently `hook_transcript_catchup_disabled`.
- Existing DTO terms remain unchanged: `SessionTranscriptCoverage`, `SessionDossierCoverage`, `hook_only`, `transcript_missing`, `tokens_missing`.
