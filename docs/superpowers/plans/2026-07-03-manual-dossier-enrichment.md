# Manual Dossier Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic Dossier-open enrichment with an explicit `Enrich data` action that runs in the background, polls for completion, and gives the user clear status in the `Enrichment summary` header.

**Architecture:** `GET /sessions/:id/dossier` becomes a read-only data fetch and must not queue enrichment or hook-transcript catch-up. A new manual `POST /sessions/:id/dossier/enrich` endpoint owns the full refresh path: catch up approved hook transcript evidence, force-run durable session enrichment with `enrichment.enrich(sessionId)`, bypass `ensureCurrent` backoff for old failed sessions, and return immediately with an in-memory background job state. The UI starts that job, shows a compact header status, and polls `GET /sessions/:id/dossier` until the Dossier reports `Current` or `Failed`.

**Tech Stack:** TypeScript, React, Vitest, Node HTTP daemon, Node SQLite, existing Masthead Dossier DTOs and enrichment coordinator.

---

## File Structure

- Modify `src/shared/sessionDossier.ts`
  - Add a small visible enrichment state DTO to the Dossier response.

- Modify `src/daemon/db/sessionDossierRepository.ts`
  - Derive persisted Dossier enrichment status from current or latest failed `session_capsule` enrichment.

- Modify `src/daemon/server.ts`
  - Remove automatic enrichment queueing from `GET /sessions/:id/dossier`.
  - Add `POST /sessions/:id/dossier/enrich`.
  - Track in-memory active manual enrichment jobs and overlay `enriching` status onto Dossier responses while a job is running.

- Modify `src/app/daemonClient.ts`
  - Add a typed client call for the manual enrichment endpoint.

- Create `src/app/sessionDossierEnrichmentPolling.ts`
  - Share polling logic between Board modal and Logbook detail.

- Modify `src/app/board/useBoardSessionDetailController.ts`
  - Add manual enrich action state and polling.

- Modify `src/app/logbook/useLogbookController.ts`
  - Add the same manual enrich action state and polling for Logbook-selected sessions.

- Modify `src/ui/SessionDetailModal.tsx` and `src/ui/SessionLibraryDetail.tsx`
  - Pass manual enrichment action props into `SessionDossier`.

- Modify `src/ui/session-dossier/SessionDossier.tsx`
  - Replace visible version/status copy with `Current`, `Not enriched`, `Failed`, or `Enriching`.
  - Move the loading/enriching indicator into the `Enrichment summary` header.
  - Add the right-aligned `Enrich data` button.

- Modify `src/styles/session-dossier.css`
  - Style the status/button group in the summary panel header.

- Tests:
  - `src/daemon/__tests__/settingsApi.test.ts`
  - `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`
  - `src/app/__tests__/sessionDossierEnrichmentPolling.test.ts`

---

### Task 1: Add Dossier Enrichment Status To The Shared DTO

**Files:**
- Modify: `src/shared/sessionDossier.ts`

- [ ] **Step 1: Add the status type**

Add this type near the other Dossier types:

```ts
export type SessionDossierEnrichmentState = {
  status: "current" | "not_enriched" | "failed" | "enriching";
  generatedAt?: string;
  provider?: string;
  model?: string;
  failureCode?: string;
  failureMessage?: string;
};
```

Add the manual job response type in the same file so daemon and app code do not drift:

```ts
export type SessionDossierManualEnrichmentJob = Omit<SessionDossierEnrichmentState, "status"> & {
  status: "enriching" | "current" | "failed";
  requestedAt: string;
  completedAt?: string;
};
```

- [ ] **Step 2: Add it to `SessionDossierDto`**

Update the DTO:

```ts
export type SessionDossierDto = {
  identity: SessionDossierIdentity;
  enrichment: SessionDossierEnrichmentState;
  durableEnrichment?: DurableSessionEnrichment;
  coverage: SessionDossierCoverage;
  narrative: SessionDossierNarrative;
  files: SessionDossierFile[];
  tools: SessionDossierTool[];
  verification: SessionDossierVerification;
  attention: SessionDossierAttention[];
  excerpts: SessionDossierExcerpt[];
  timeline: SessionDossierTimelineEvent[];
  reuse: SessionDossierReuse;
  usage: SessionDossierUsage;
};
```

- [ ] **Step 3: Run typecheck to confirm expected failures**

Run:

```bash
npm run typecheck
```

Expected: TypeScript fails where `SessionDossierDto` fixtures or repository returns do not include `enrichment`.

- [ ] **Step 4: Update all Dossier test fixtures deliberately**

Find every inline Dossier fixture and add a realistic `enrichment` state instead of using `as SessionDossierDto` casts:

```bash
rg -n "SessionDossierDto|function dossier\\(|dossierFixture|<SessionDossier" src/app src/ui src/daemon/db -g "*.test.ts" -g "*.test.tsx"
```

Expected fixture policy:

- Existing enriched Dossier fixtures get `enrichment: { status: "current" }`.
- Missing-enrichment fixtures get `enrichment: { status: "not_enriched" }`.
- Failed-state tests use a full `failed` object with `failureCode` and `failureMessage`.
- Do not make `SessionDossierDto.enrichment` optional just to reduce fixture churn; visible Dossier state must always be explicit.

### Task 2: Populate Persisted Dossier Enrichment State

**Files:**
- Modify: `src/daemon/db/sessionDossierRepository.ts`
- Test: `src/daemon/db/__tests__/sessionDossierRepository.test.ts`

- [ ] **Step 1: Write repository tests for the visible states**

Add a test after the durable enrichment test:

```ts
test("reports current, failed, and missing Dossier enrichment state", async () => {
  const db = await openTestDatabase();
  seedDossierSession(db, { sessionId: "session-current-state" });
  seedDossierSession(db, { sessionId: "session-failed-state" });
  seedDossierSession(db, { sessionId: "session-missing-state" });
  db.prepare("DELETE FROM session_enrichments WHERE session_id IN (?, ?, ?)").run(
    "session-current-state",
    "session-failed-state",
    "session-missing-state"
  );
  upsertSessionEnrichment(db, {
    content: {
      candidateDecisions: [],
      liveSummary: "Current Dossier enrichment is available.",
      searchPhrases: [],
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], nextStep: "Use the current enrichment.", openQuestions: [] },
        decisions: [],
        evidenceRefs: [],
        keyWork: ["Generated current enrichment."],
        outcome: "The current Dossier enrichment is visible.",
        purpose: "Expose current enrichment status.",
        verification: { commands: [], evidenceRefs: [], failures: [], status: "passed", summary: "Status test passed." },
        warnings: []
      },
      sessionSummary: { confidence: "high", evidenceRefs: [], state: "completed", text: "Current enrichment exists." },
      sessionTitle: { basis: "dominant_work", confidence: "high", evidenceRefs: [], text: "Current enrichment state" },
      technologies: [],
      title: "Current enrichment state",
      topics: [],
      unresolved: []
    },
    contentFingerprint: "current-state:fingerprint",
    enrichmentKind: "session_capsule",
    generatedAt: "2026-07-03T18:00:00.000Z",
    model: "test-model",
    promptVersion: "session-capsule-v4",
    provider: "test-provider",
    sessionId: "session-current-state",
    sourceRefs: [],
    status: "current"
  });
  upsertSessionEnrichment(db, {
    contentFingerprint: "failed-state:fingerprint:failed:timeout",
    enrichmentKind: "session_capsule",
    failureCode: "timeout",
    failureMessage: "Provider timed out.",
    generatedAt: "2026-07-03T18:01:00.000Z",
    model: "test-model",
    promptVersion: "session-capsule-v4",
    provider: "test-provider",
    sessionId: "session-failed-state",
    sourceRefs: [],
    status: "failed"
  });

  expect(getSessionDossier(db, "session-current-state")?.enrichment).toMatchObject({
    generatedAt: "2026-07-03T18:00:00.000Z",
    model: "test-model",
    provider: "test-provider",
    status: "current"
  });
  expect(getSessionDossier(db, "session-failed-state")?.enrichment).toMatchObject({
    failureCode: "timeout",
    failureMessage: "Provider timed out.",
    status: "failed"
  });
  expect(getSessionDossier(db, "session-missing-state")?.enrichment).toEqual({ status: "not_enriched" });
  db.close();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts -t "reports current, failed, and missing Dossier enrichment state"
```

Expected: FAIL because `dossier.enrichment` is undefined.

- [ ] **Step 3: Implement `getDossierEnrichmentState`**

In `src/daemon/db/sessionDossierRepository.ts`, import the type:

```ts
import type { SessionDossierEnrichmentState } from "../../shared/sessionDossier.ts";
```

Add the helper near `getDurableEnrichment`:

```ts
function getDossierEnrichmentState(db: MastheadDatabase, sessionId: string): SessionDossierEnrichmentState {
  const current = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  if (current) {
    return {
      generatedAt: current.generatedAt,
      model: current.model,
      provider: current.provider,
      status: "current"
    };
  }

  const latestFailed = readLatestFailedSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  if (latestFailed) {
    return {
      failureCode: latestFailed.failureCode,
      failureMessage: latestFailed.failureMessage,
      generatedAt: latestFailed.generatedAt,
      model: latestFailed.model,
      provider: latestFailed.provider,
      status: "failed"
    };
  }

  return { status: "not_enriched" };
}
```

Update the Dossier return object:

```ts
const enrichmentState = getDossierEnrichmentState(db, sessionId);
const partial: DossierWithoutReuse = {
  attention,
  coverage,
  durableEnrichment,
  enrichment: enrichmentState,
  excerpts: getExcerpts(messages, checkpoints, runtimeSignals),
  files,
  identity: dossierIdentity,
  narrative,
  timeline: getTimeline(messages, tools, files, checkpoints, runtimeSignals, attention),
  tools,
  usage,
  verification
};
```

- [ ] **Step 4: Run the focused repository test**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts -t "reports current, failed, and missing Dossier enrichment state"
```

Expected: PASS.

### Task 3: Add Manual Background Enrichment Endpoint

**Files:**
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/__tests__/settingsApi.test.ts`

- [ ] **Step 1: Replace the old automatic GET enrichment tests**

The current suite contains tests that intentionally prove `GET /sessions/:id/dossier` queues configured enrichment. Those tests must be inverted before implementation so the suite protects the new product behavior.

Replace `session dossier GET queues configured enrichment without blocking the response` with:

```ts
test("session dossier GET is read-only and does not queue enrichment", async () => {
  let providerCalls = 0;
  const providerServer = createServer((request, response) => {
    request.resume();
    providerCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
  });
  servers.push(providerServer);
  const providerBaseUrl = await listenHttp(providerServer);
  const { daemon } = await createTestHarness();
  seedSession(daemon.database, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:dossier-read-only",
    title: "Cached dossier"
  });
  daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session:dossier-read-only");
  const baseUrl = await listen(daemon);
  await postJson(baseUrl, "/settings/llm-provider", {
    activeProvider: "openai_compatible",
    apiKey: "test-compatible-key",
    baseUrl: `${providerBaseUrl}/v1`,
    model: "llama-3.1",
    remoteEnrichmentEnabled: true
  });

  const dossier = await getJson(baseUrl, `/sessions/${encodeURIComponent("session:dossier-read-only")}/dossier`);
  await delay(250);

  expect(dossier.dossier.enrichment.status).toBe("not_enriched");
  expect(providerCalls).toBe(0);
});
```

Rewrite the old `session dossier GET does not block on hook transcript catch-up` test as `manual Dossier enrichment catches up hook transcript before provider request`: make the same hook transcript setup, call `POST /sessions/:id/dossier/enrich`, assert the POST returns `202` quickly, then wait for `providerCalls === 1` and assert the provider payload includes the recovered transcript text. Keep `session dossier GET skips hook transcript catch-up when transcript is already current` only if it is moved to `GET /sessions/:id/transcript`; Dossier GET should no longer do catch-up work.

- [ ] **Step 2: Write a failing API test that bypasses failure backoff**

Add this test near the existing Dossier API tests:

```ts
test("manual Dossier enrichment retries old failed sessions in the background", async () => {
  let providerCalls = 0;
  const providerServer = createServer((request, response) => {
    expect(request.url).toBe("/v1/chat/completions");
    request.resume();
    providerCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                durableProviderOutput({
                  summary: "Manual Dossier enrichment refreshed a previously failed session.",
                  title: "Manual Dossier enrichment retry"
                })
              )
            }
          }
        ]
      })
    );
  });
  servers.push(providerServer);
  const providerBaseUrl = await listenHttp(providerServer);
  const { daemon } = await createTestHarness();
  seedSession(daemon.database, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:manual-dossier-enrich",
    title: "Old failed enrichment"
  });
  daemon.database.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session:manual-dossier-enrich");
  upsertSessionEnrichment(daemon.database, {
    contentFingerprint: "manual-dossier:fingerprint:failed:timeout",
    enrichmentKind: "session_capsule",
    failureCode: "timeout",
    failureMessage: "Previous enrichment timed out.",
    generatedAt: "2026-07-03T18:00:00.000Z",
    model: "llama-3.1",
    promptVersion: "session-capsule-v4",
    provider: "openai_compatible",
    sessionId: "session:manual-dossier-enrich",
    sourceRefs: [],
    status: "failed"
  });
  const baseUrl = await listen(daemon);
  await postJson(baseUrl, "/settings/llm-provider", {
    activeProvider: "openai_compatible",
    apiKey: "test-compatible-key",
    baseUrl: `${providerBaseUrl}/v1`,
    model: "llama-3.1",
    remoteEnrichmentEnabled: true
  });

  const accepted = await postJson(baseUrl, `/sessions/${encodeURIComponent("session:manual-dossier-enrich")}/dossier/enrich`, {});

  expect(accepted).toMatchObject({ ok: true, enrichment: { status: "enriching" } });
  await waitFor(() => providerCalls === 1);
  await waitFor(() => getSessionDossier(daemon.database, "session:manual-dossier-enrich")?.enrichment.status === "current");
  const dossier = await getJson(baseUrl, `/sessions/${encodeURIComponent("session:manual-dossier-enrich")}/dossier`);
  expect(dossier.dossier.enrichment.status).toBe("current");
  expect(dossier.dossier.identity.title).toBe("Manual Dossier enrichment retry");
});
```

Add imports if missing:

```ts
import { upsertSessionEnrichment } from "../db/enrichmentRepository.ts";
```

- [ ] **Step 3: Run the failing API test**

Run:

```bash
npm test -- --run src/daemon/__tests__/settingsApi.test.ts -t "manual Dossier enrichment retries old failed sessions"
```

Expected: FAIL with `not found` because the endpoint does not exist.

- [ ] **Step 4: Add in-memory manual job state in `server.ts`**

Near the existing enrichment queue state:

```ts
import type { SessionDossierManualEnrichmentJob } from "../shared/sessionDossier.ts";

const manualDossierEnrichmentJobs = new Map<string, SessionDossierManualEnrichmentJob>();
```

- [ ] **Step 5: Overlay manual state onto Dossier responses**

Add this helper inside `createMastheadDaemon` near the Dossier route:

```ts
function dossierWithManualEnrichmentState(dossier: SessionDossierDto, sessionId: string): SessionDossierDto {
  const job = manualDossierEnrichmentJobs.get(sessionId);
  if (!job) return dossier;
  return {
    ...dossier,
    enrichment: {
      ...dossier.enrichment,
      generatedAt: job.generatedAt ?? dossier.enrichment.generatedAt,
      model: job.model ?? dossier.enrichment.model,
      provider: job.provider ?? dossier.enrichment.provider,
      failureCode: job.failureCode ?? dossier.enrichment.failureCode,
      failureMessage: job.failureMessage ?? dossier.enrichment.failureMessage,
      status: job.status
    }
  };
}
```

Update `GET /sessions/:id/dossier` to stop auto-enriching:

```ts
const sessionDossierMatch = url.pathname.match(/^\/sessions\/([^/]+)\/dossier$/);
if (request.method === "GET" && sessionDossierMatch?.[1]) {
  const sessionId = decodeURIComponent(sessionDossierMatch[1]);
  const dossier = getSessionDossier(database, sessionId);
  sendJson(
    request,
    response,
    config.allowedOrigins,
    dossier ? 200 : 404,
    dossier ? { ok: true, dossier: dossierWithManualEnrichmentState(dossier, sessionId) } : { ok: false, error: "session not found" }
  );
  return;
}
```

- [ ] **Step 6: Add the manual endpoint**

Place this before the generic 404:

```ts
const sessionDossierEnrichMatch = url.pathname.match(/^\/sessions\/([^/]+)\/dossier\/enrich$/);
if (request.method === "POST" && sessionDossierEnrichMatch?.[1]) {
  request.resume();
  const sessionId = decodeURIComponent(sessionDossierEnrichMatch[1]);
  const dossier = getSessionDossier(database, sessionId);
  if (!dossier) {
    sendJson(request, response, config.allowedOrigins, 404, { ok: false, error: "session not found" });
    return;
  }

  const activeJob = manualDossierEnrichmentJobs.get(sessionId);
  if (activeJob?.status === "enriching") {
    sendJson(request, response, config.allowedOrigins, 202, { ok: true, enrichment: activeJob });
    return;
  }

  const job: SessionDossierManualEnrichmentJob = {
    requestedAt: new Date().toISOString(),
    status: "enriching"
  };
  manualDossierEnrichmentJobs.set(sessionId, job);
  setImmediate(() => {
    void runManualDossierEnrichment(sessionId);
  });
  sendJson(request, response, config.allowedOrigins, 202, { ok: true, enrichment: job });
  return;
}
```

- [ ] **Step 7: Implement the background runner**

Add this helper near the manual job helpers:

```ts
async function runManualDossierEnrichment(sessionId: string): Promise<void> {
  try {
    await catchUpSessionTranscriptIfApproved(sessionId);
    const record = await enrichment.enrich(sessionId);
    indexCanonicalSessionSearch(database, sessionId);
    manualDossierEnrichmentJobs.set(sessionId, {
      completedAt: new Date().toISOString(),
      generatedAt: record.generatedAt,
      model: record.model,
      provider: record.provider,
      requestedAt: manualDossierEnrichmentJobs.get(sessionId)?.requestedAt ?? new Date().toISOString(),
      status: "current"
    });
  } catch (error) {
    const failed = error instanceof EnrichmentFailedError ? error : undefined;
    manualDossierEnrichmentJobs.set(sessionId, {
      completedAt: new Date().toISOString(),
      failureCode: failed?.status,
      failureMessage: failed?.failureMessage ?? (error instanceof Error ? error.message : String(error)),
      model: failed?.model,
      provider: failed?.provider,
      requestedAt: manualDossierEnrichmentJobs.get(sessionId)?.requestedAt ?? new Date().toISOString(),
      status: "failed"
    });
    recordRuntimeDiagnostic({
      details: failed
        ? {
            failureCode: failed.status,
            failureMessage: failed.failureMessage,
            model: failed.model,
            provider: failed.provider,
            sessionId,
            status: failed.status
          }
        : { error, sessionId },
      kind: "manual_dossier_enrichment_failed",
      message: `Manual Dossier enrichment failed for ${sessionId}`,
      severity: "warning"
    });
  }

  const cleanupTimer = setTimeout(() => {
    const job = manualDossierEnrichmentJobs.get(sessionId);
    if (job?.status !== "enriching") manualDossierEnrichmentJobs.delete(sessionId);
  }, 120_000);
  cleanupTimer.unref?.();
}
```

- [ ] **Step 8: Run the API tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/settingsApi.test.ts -t "manual Dossier enrichment retries old failed sessions"
npm test -- --run src/daemon/__tests__/settingsApi.test.ts -t "session dossier GET is read-only"
npm test -- --run src/daemon/__tests__/settingsApi.test.ts -t "manual Dossier enrichment catches up hook transcript"
```

Expected: PASS.

### Task 4: Add Client API And Polling Utility

**Files:**
- Modify: `src/app/daemonClient.ts`
- Create: `src/app/sessionDossierEnrichmentPolling.ts`
- Test: create `src/app/__tests__/sessionDossierEnrichmentPolling.test.ts`

- [ ] **Step 1: Add the POST client function**

In `src/app/daemonClient.ts`, import the shared job type and export the function. Use the current `postJson` signature: it accepts one options object with `label`, optional `signal`, and optional `body`.

```ts
import type { SessionDossierDto, SessionDossierManualEnrichmentJob } from "../shared/sessionDossier";

export async function enrichSessionDossier(
  sessionId: string,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<SessionDossierManualEnrichmentJob> {
  const body = await postJson<{ ok: true; enrichment: SessionDossierManualEnrichmentJob }>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/dossier/enrich`,
    {
      body: {},
      label: "session dossier enrichment",
      signal: options.signal
    }
  );
  return body.enrichment;
}
```

- [ ] **Step 2: Create polling helper**

Create `src/app/sessionDossierEnrichmentPolling.ts`:

```ts
import type { SessionDossierDto } from "../shared/sessionDossier";
import { getSessionDossier } from "./daemonClient";

export type PollDossierEnrichmentInput = {
  baseUrl: string;
  intervalMs?: number;
  maxAttempts?: number;
  onDossier: (dossier: SessionDossierDto) => void;
  sessionId: string;
  signal?: AbortSignal;
};

export async function pollDossierEnrichment({
  baseUrl,
  intervalMs = 1500,
  maxAttempts = 80,
  onDossier,
  sessionId,
  signal
}: PollDossierEnrichmentInput): Promise<SessionDossierDto> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const dossier = await getSessionDossier(sessionId, baseUrl, { signal });
    onDossier(dossier);
    if (dossier.enrichment.status !== "enriching") return dossier;
    await delay(intervalMs, signal);
  }
  throw new Error("Dossier enrichment is still running. Refresh the Dossier to check again.");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(abortError());
      },
      { once: true }
    );
  });
}

function abortError(): Error {
  const error = new Error("Polling aborted.");
  error.name = "AbortError";
  return error;
}
```

- [ ] **Step 3: Add a focused polling utility test**

Create `src/app/__tests__/sessionDossierEnrichmentPolling.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import { pollDossierEnrichment } from "../sessionDossierEnrichmentPolling";

vi.mock("../daemonClient", () => ({
  getSessionDossier: vi.fn()
}));

import { getSessionDossier } from "../daemonClient";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("pollDossierEnrichment", () => {
  test("polls until enrichment leaves the enriching state", async () => {
    vi.useFakeTimers();
    const enriching = dossier("enriching");
    const current = dossier("current");
    vi.mocked(getSessionDossier).mockResolvedValueOnce(enriching).mockResolvedValueOnce(current);
    const seen: string[] = [];

    const resultPromise = pollDossierEnrichment({
      baseUrl: "http://127.0.0.1:17373",
      intervalMs: 10,
      onDossier: (next) => seen.push(next.enrichment.status),
      sessionId: "session-1"
    });
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toBe(current);
    expect(seen).toEqual(["enriching", "current"]);
  });
});

function dossier(status: SessionDossierDto["enrichment"]["status"]): SessionDossierDto {
  return {
    attention: [],
    coverage: {
      level: "partial",
      transcript: {
        assistantMessages: 1,
        checkpoints: 0,
        fileEffects: 0,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 2,
        runtimeSignals: 0,
        toolCalls: 0,
        toolResults: 0,
        userMessages: 1
      },
      warnings: []
    },
    enrichment: { status },
    excerpts: [],
    files: [],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-07-03T18:00:00.000Z",
      lifecycle: "ended",
      models: [],
      runtime: "codex",
      sessionId: "session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      title: "Session"
    },
    narrative: { technologies: [], topics: [], unresolved: [] },
    reuse: {
      canonicalSessionId: "session-1",
      copyableContext: "",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source-session-1"
    },
    timeline: [],
    tools: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 },
    verification: { commands: [], status: "unknown", summary: "No verification signal captured." }
  };
}
```

- [ ] **Step 4: Run the client tests**

Run:

```bash
npm test -- --run src/app/__tests__/sessionDossierEnrichmentPolling.test.ts
```

Expected: PASS.

### Task 5: Wire Manual Enrichment Into Board And Logbook Controllers

**Files:**
- Modify: `src/app/board/useBoardSessionDetailController.ts`
- Modify: `src/app/logbook/useLogbookController.ts`

- [ ] **Step 1: Update Board controller imports and state**

In `src/app/board/useBoardSessionDetailController.ts`, update imports:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  enrichSessionDossier,
  getSessionDossier,
  getSessionTranscript,
  type SessionTranscriptKindFilter,
  type SessionTranscriptResult
} from "../daemonClient";
import { pollDossierEnrichment } from "../sessionDossierEnrichmentPolling";
```

Add state near Dossier state:

```ts
const [dossierEnrichmentBusy, setDossierEnrichmentBusy] = useState(false);
const [dossierEnrichmentError, setDossierEnrichmentError] = useState<string>();
const dossierEnrichmentAbortRef = useRef<AbortController | null>(null);
```

Add cleanup:

```ts
useEffect(() => {
  return () => dossierEnrichmentAbortRef.current?.abort();
}, []);
```

- [ ] **Step 2: Add Board manual enrichment action**

Add before `retryDossier`:

```ts
const enrichDossier = useCallback(async () => {
  if (!sessionId || dossierEnrichmentBusy) return;
  dossierEnrichmentAbortRef.current?.abort();
  const controller = new AbortController();
  dossierEnrichmentAbortRef.current = controller;
  setDossierEnrichmentBusy(true);
  setDossierEnrichmentError(undefined);
  try {
    await enrichSessionDossier(sessionId, activeProjectionUrl, { signal: controller.signal });
    await pollDossierEnrichment({
      baseUrl: activeProjectionUrl,
      onDossier: setDossier,
      sessionId,
      signal: controller.signal
    });
  } catch (error) {
    if (!controller.signal.aborted) setDossierEnrichmentError(error instanceof Error ? error.message : String(error));
  } finally {
    if (!controller.signal.aborted) setDossierEnrichmentBusy(false);
  }
}, [activeProjectionUrl, dossierEnrichmentBusy, sessionId]);
```

Add these to the returned object:

```ts
dossierEnrichmentBusy,
dossierEnrichmentError,
enrichDossier,
```

- [ ] **Step 3: Update Logbook controller similarly**

In `src/app/logbook/useLogbookController.ts`, import `useRef`, `enrichSessionDossier`, and `pollDossierEnrichment`.

Add state near Dossier state:

```ts
const [dossierEnrichmentBusy, setDossierEnrichmentBusy] = useState(false);
const [dossierEnrichmentError, setDossierEnrichmentError] = useState<string>();
const dossierEnrichmentAbortRef = useRef<AbortController | null>(null);
```

Add cleanup:

```ts
useEffect(() => {
  return () => dossierEnrichmentAbortRef.current?.abort();
}, []);
```

Add the action:

```ts
const enrichDossier = useCallback(async () => {
  if (!selectedSessionId || dossierEnrichmentBusy) return;
  dossierEnrichmentAbortRef.current?.abort();
  const controller = new AbortController();
  dossierEnrichmentAbortRef.current = controller;
  setDossierEnrichmentBusy(true);
  setDossierEnrichmentError(undefined);
  try {
    await enrichSessionDossier(selectedSessionId, activeProjectionUrl, { signal: controller.signal });
    await pollDossierEnrichment({
      baseUrl: activeProjectionUrl,
      onDossier: setDossier,
      sessionId: selectedSessionId,
      signal: controller.signal
    });
  } catch (error) {
    if (!controller.signal.aborted) setDossierEnrichmentError(error instanceof Error ? error.message : String(error));
  } finally {
    if (!controller.signal.aborted) setDossierEnrichmentBusy(false);
  }
}, [activeProjectionUrl, dossierEnrichmentBusy, selectedSessionId]);
```

Return:

```ts
dossierEnrichmentBusy,
dossierEnrichmentError,
enrichDossier,
```

- [ ] **Step 4: Run typecheck and fix any return-shape callsites**

Run:

```bash
npm run typecheck
```

Expected: FAIL until `App.tsx`, `SessionDetailModal.tsx`, and `SessionLibraryDetail.tsx` receive/pass the new props.

### Task 6: Add The Header Button And Status UI

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/ui/SessionDetailModal.tsx`
- Modify: `src/ui/SessionLibraryDetail.tsx`
- Modify: `src/ui/session-dossier/SessionDossier.tsx`
- Modify: `src/styles/session-dossier.css`
- Test: `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`

- [ ] **Step 1: Update modal/detail props**

In both `SessionDetailModal.tsx` and `SessionLibraryDetail.tsx`, add props:

```ts
onEnrichDossier?: () => void;
dossierEnrichmentBusy?: boolean;
dossierEnrichmentError?: string;
```

Pass them into `SessionDossier`:

```tsx
<SessionDossier
  dossier={dossier}
  error={dossierError}
  loading={dossierLoading}
  transcript={transcript}
  transcriptLoading={transcriptLoading}
  dossierEnrichmentBusy={dossierEnrichmentBusy}
  dossierEnrichmentError={dossierEnrichmentError}
  onEnrichDossier={onEnrichDossier}
/>
```

In `App.tsx`, pass Board values:

```tsx
onEnrichDossier={boardDetail.enrichDossier}
dossierEnrichmentBusy={boardDetail.dossierEnrichmentBusy}
dossierEnrichmentError={boardDetail.dossierEnrichmentError}
```

Pass Logbook values:

```tsx
onEnrichDossier={logbook.enrichDossier}
dossierEnrichmentBusy={logbook.dossierEnrichmentBusy}
dossierEnrichmentError={logbook.dossierEnrichmentError}
```

- [ ] **Step 2: Update `SessionDossier` props**

Add to `Props`:

```ts
dossierEnrichmentBusy?: boolean;
dossierEnrichmentError?: string;
onEnrichDossier?: () => void;
```

Destructure them:

```ts
dossierEnrichmentBusy = false,
dossierEnrichmentError,
onEnrichDossier,
```

Pass them to the panel:

```tsx
<DossierEnrichmentPanel
  dossier={dossier}
  enrichmentBusy={dossierEnrichmentBusy}
  enrichmentError={dossierEnrichmentError}
  error={error}
  loading={loading}
  onEnrich={onEnrichDossier}
  summary={summary}
/>
```

- [ ] **Step 3: Replace visible version/status copy**

Delete visible uses of `CURRENT_SESSION_CAPSULE_VERSION` from `dossierEnrichmentStatus`.

Use this shape:

```ts
function dossierEnrichmentStatus(dossier: SessionDossierDto | undefined, loading?: boolean, enrichmentBusy?: boolean): string {
  if (enrichmentBusy || dossier?.enrichment.status === "enriching") return "Enriching";
  if (!dossier) return loading ? "Loading" : "Live";
  if (dossier.enrichment.status === "current") return "Current";
  if (dossier.enrichment.status === "failed") return "Failed";
  return "Not enriched";
}
```

Keep `CURRENT_SESSION_CAPSULE_VERSION` only for hidden compatibility helpers like `currentDurableEnrichment` and `currentNarrativeDebug`.

- [ ] **Step 4: Move the loading indicator into the panel header**

Change `DossierEnrichmentPanel`:

```tsx
function DossierEnrichmentPanel({
  dossier,
  enrichmentBusy,
  enrichmentError,
  error,
  loading,
  onEnrich,
  summary
}: {
  dossier?: SessionDossierDto;
  enrichmentBusy?: boolean;
  enrichmentError?: string;
  error?: string;
  loading?: boolean;
  onEnrich?: () => void;
  summary?: string;
}) {
  const coverage = dossier?.coverage.transcript;
  const status = dossierEnrichmentStatus(dossier, loading, enrichmentBusy);
  const hasCurrentEnrichment = hasCurrentDossierEnrichment(dossier);
  return (
    <section className="panel summary" aria-label="Enrichment summary">
      <div className="panel-head">
        <h3>Enrichment summary</h3>
        <div className="dossier-enrichment-actions">
          <span className={["dossier-enrichment-status", `is-${status.toLowerCase().replace(/\\s+/g, "-")}`].join(" ")}>
            {status}
          </span>
          <AppButton className="dossier-enrich-button" type="button" onClick={onEnrich} disabled={!onEnrich || enrichmentBusy || (loading && !dossier)}>
            {enrichmentBusy ? (
              <>
                <span className="dossier-loading-spinner" aria-hidden="true" />
                Enriching
              </>
            ) : (
              "Enrich data"
            )}
          </AppButton>
        </div>
      </div>
      <div className="summary-scroll">
        <DossierDurableMemory dossier={dossier} />
        <SummarySection label="Transcript summary" section="summary" value={summary} extraParagraphs={dossierSummaryExtras(dossier)} />
        <SummarySection label="Latest prompt" section="latest-prompt" value={dossier?.narrative.latestUserPrompt} />
        <SummarySection label="Retrieval notes" section="retrieval" values={dossierRetrievalNotes(dossier)} />
        <SummarySection label="Continuation notes" section="continuation" values={dossier?.attention.map((item) => item.title)} />
        <SummarySection label="Unresolved" section="unresolved" values={hasCurrentEnrichment ? dossier?.narrative.unresolved : undefined} />
        {enrichmentError ? <SummarySection label="Enrichment error" section="error" value={enrichmentError} /> : null}
        {error ? <SummarySection label="Dossier error" section="error" value={error} /> : null}
        <DossierEvidenceBlocks dossier={dossier} hasCurrentEnrichment={hasCurrentEnrichment} />
        <SummarySection label="First prompt" section="first-prompt" value={dossier?.narrative.firstUserPrompt} />
        <SummarySection label="Technologies" section="technologies" values={hasCurrentEnrichment ? dossier?.narrative.technologies : undefined} />
        <DiagnosticCoverage coverage={coverage} />
      </div>
    </section>
  );
}
```

Delete `DossierLoadingState` if it becomes unused.

- [ ] **Step 5: Add CSS**

In `src/styles/session-dossier.css`, add after `.session-dossier .rail-label`:

```css
.session-dossier .dossier-enrichment-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.session-dossier .dossier-enrichment-status {
  color: var(--mute);
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  white-space: nowrap;
}

.session-dossier .dossier-enrichment-status.is-current {
  color: var(--green);
}

.session-dossier .dossier-enrichment-status.is-failed {
  color: var(--red);
}

.session-dossier .dossier-enrichment-status.is-enriching {
  color: var(--blue);
}

.session-dossier .dossier-enrich-button {
  min-height: 28px;
  padding: 0 10px;
  font-size: 11px;
  line-height: 1;
}

.session-dossier .dossier-enrich-button .dossier-loading-spinner {
  width: 12px;
  height: 12px;
  margin-right: 6px;
}
```

- [ ] **Step 6: Update UI tests**

In `src/ui/session-dossier/__tests__/SessionDossier.test.tsx`, replace the old `not enriched` assertion with:

```ts
test("renders manual Dossier enrichment status and action", () => {
  const currentDossier = dossier();
  currentDossier.enrichment = { status: "not_enriched" };
  const onEnrich = vi.fn();

  const html = renderToStaticMarkup(<SessionDossier dossier={currentDossier} onEnrichDossier={onEnrich} />);

  expect(html).toContain("Not enriched");
  expect(html).toContain("Enrich data");
  expect(html).not.toContain("session-capsule-v4");
});
```

Add a DOM test for the disabled busy state:

```ts
test("disables the Enrich data action while enrichment is running", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(<SessionDossier dossier={dossier()} dossierEnrichmentBusy onEnrichDossier={() => undefined} />);
  });

  expect(host.textContent).toContain("Enriching");
  expect(host.querySelector(".dossier-enrich-button")?.getAttribute("disabled")).not.toBeNull();
  act(() => root.unmount());
});
```

- [ ] **Step 7: Run Dossier UI tests**

Run:

```bash
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: PASS.

### Task 7: Verify The Full Feature

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/settingsApi.test.ts -t "manual Dossier enrichment retries old failed sessions"
npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts -t "reports current, failed, and missing Dossier enrichment state"
npm test -- --run src/app/__tests__/sessionDossierEnrichmentPolling.test.ts
npm test -- --run src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck and full tests**

Run:

```bash
npm run typecheck
npm test -- --run
```

Expected: typecheck passes and the full Vitest suite passes.

- [ ] **Step 3: Restart the Electron dev app**

Use the existing service, do not start a separate browser Vite server on port 5173:

```bash
systemctl --user restart masthead-dev-electron.service
for i in $(seq 1 20); do
  curl -m 2 -fsS http://127.0.0.1:17373/health && break
  sleep 1
done
```

Expected: health returns `ok: true`.

- [ ] **Step 4: Live-test the Dossier endpoint flow**

Pick a session with failed or missing enrichment and run:

```bash
SESSION_ID=$(node --input-type=module <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/tyler/.local/share/masthead-dev/masthead.sqlite', { readOnly: true });
const row = db.prepare("SELECT session_id AS sessionId FROM sessions WHERE deleted_at IS NULL ORDER BY last_activity_at DESC LIMIT 1").get();
db.close();
if (!row?.sessionId) process.exit(1);
console.log(row.sessionId);
NODE
)
ENCODED_SESSION_ID=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$SESSION_ID")
curl -m 5 -fsS "http://127.0.0.1:17373/sessions/$ENCODED_SESSION_ID/dossier" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.dossier.enrichment);})'
curl -m 5 -fsS -X POST "http://127.0.0.1:17373/sessions/$ENCODED_SESSION_ID/dossier/enrich"
```

Expected: first command prints `current`, `not_enriched`, or `failed`; second command returns `status: "enriching"` unless another manual job for the same session is already active, in which case it returns that active job.

- [ ] **Step 5: Live-test the UI**

Open a Dossier in the Electron dev app:

- The `Enrichment summary` header shows `Current`, `Not enriched`, `Failed`, or `Enriching`.
- The visible header no longer shows `session-capsule-v4`.
- The right-aligned `Enrich data` button is present.
- Clicking it changes the status to `Enriching`, disables the button, and later updates the Dossier copy.
- Opening a Dossier without clicking the button does not automatically trigger enrichment.

### Task 8: Commit

**Files:**
- Commit all files touched by this plan only.

- [ ] **Step 1: Review changed files**

Run:

```bash
git status --short
git diff -- src/shared/sessionDossier.ts src/daemon/db/sessionDossierRepository.ts src/daemon/server.ts src/app/daemonClient.ts src/app/sessionDossierEnrichmentPolling.ts src/app/board/useBoardSessionDetailController.ts src/app/logbook/useLogbookController.ts src/ui/SessionDetailModal.tsx src/ui/SessionLibraryDetail.tsx src/ui/session-dossier/SessionDossier.tsx src/styles/session-dossier.css src/daemon/__tests__/settingsApi.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts src/app/__tests__/sessionDossierEnrichmentPolling.test.ts src/ui/session-dossier/__tests__/SessionDossier.test.tsx
```

Expected: diff only contains manual Dossier enrichment behavior.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/shared/sessionDossier.ts \
  src/daemon/db/sessionDossierRepository.ts \
  src/daemon/server.ts \
  src/app/daemonClient.ts \
  src/app/sessionDossierEnrichmentPolling.ts \
  src/app/board/useBoardSessionDetailController.ts \
  src/app/logbook/useLogbookController.ts \
  src/ui/SessionDetailModal.tsx \
  src/ui/SessionLibraryDetail.tsx \
  src/ui/session-dossier/SessionDossier.tsx \
  src/styles/session-dossier.css \
  src/daemon/__tests__/settingsApi.test.ts \
  src/daemon/db/__tests__/sessionDossierRepository.test.ts \
  src/app/__tests__/sessionDossierEnrichmentPolling.test.ts \
  src/ui/session-dossier/__tests__/SessionDossier.test.tsx \
  docs/superpowers/plans/2026-07-03-manual-dossier-enrichment.md
git commit -m "feat: add manual Dossier enrichment"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: the plan removes automatic Dossier-open enrichment, adds a manual button, runs enrichment as a background job, polls for completion, removes visible `session-capsule-v4` copy, and keeps clear status beside the button.
- Placeholder scan: no TBD or unspecified implementation steps remain.
- Type consistency: `SessionDossierDto.enrichment.status` is the source for visible status; transient server jobs overlay `enriching`; manual endpoint returns the same active job state used by polling.

## Plan Optimizer Result

- Final score: 92/100.
- Score trajectory: 82 -> 89 -> 92 -> 92.
- Main improvements from optimization: shared the manual job type across daemon and app code, fixed the `postJson` call shape, inverted the old auto-enrichment GET tests, made polling Node-safe for Vitest, added explicit fixture update rules, and clarified manual transcript catch-up as part of the POST path.
