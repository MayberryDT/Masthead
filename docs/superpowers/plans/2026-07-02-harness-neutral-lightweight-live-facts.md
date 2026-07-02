# Harness-Neutral Lightweight Live Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Masthead's live session integration lighter by feeding the Now board and Board headline system with compact harness-neutral live facts while deferring tool-heavy evidence work and full transcript import until a session is opened.

**Architecture:** Introduce a small live-fact contract that classifies adapter events into immediate board facts or deferred evidence/stat work. Keep Board headline generation logic unchanged, but ensure projection still receives compact recent-turn facts and status signals. Move expensive Codex hook work out of the `/ingest` and `/projection` hot paths, and trigger full transcript catch-up from session dossier/transcript reads.

**Tech Stack:** TypeScript, Node HTTP daemon, SQLite via `node:sqlite`, Vitest, existing Masthead adapter/session graph/projection/enrichment modules.

---

## Execution Mode

Use `superpowers:subagent-driven-development` for execution.

Before executing Task 1, create or switch to a feature branch or isolated worktree. The current planning worktree may be detached at `main`; do not let implementation start on `main` without an explicit branch.

Dispatch exactly one implementer subagent per task. After each task:

1. Run the task's verification commands.
2. Commit only the files listed in that task.
3. Dispatch a spec-compliance reviewer.
4. Dispatch a code-quality reviewer only after spec compliance passes.
5. Move to the next task only after both reviews pass.

Do not dispatch implementation subagents in parallel because these tasks touch overlapping daemon and projection code.

## Protected Product Boundaries

The Board headline generation behavior is intentionally out of scope. Treat these files as protected unless a reviewer proves a change is required to preserve existing behavior:

- `src/core/boardHeadlineEnricher.ts`
- `src/core/boardHeadlineInput.ts`
- `src/core/boardHeadlineFacts.ts`
- `src/core/offlineBoardHeadline.ts`
- `src/core/openaiBoardHeadlineFrame.ts`
- `src/core/boardHeadlineRefreshKey.ts`

The implementation may change what compact facts are fed into projection, but it must not rewrite headline prompt/input semantics, LLM request behavior, caching, refresh keys, offline headline rendering, or frame validation.

## File Structure

Create:

- `src/core/liveSessionFacts.ts`: harness-neutral classification helpers for immediate live facts versus deferred evidence/stat work.
- `src/core/__tests__/liveSessionFacts.test.ts`: unit tests for high-value facts, deferred tool events, failed-command attention, and transcript pointer preservation.
- `src/daemon/liveIngestQueue.ts`: bounded background queue for deferred hook/event work.
- `src/daemon/__tests__/liveIngestQueue.test.ts`: unit tests for batching, per-session coalescing, flush-on-close, and failure isolation.

Modify:

- `src/core/types.ts`: widen `NormalizedEvent["source"]["adapter"]` so future harness adapters can emit live events without core type edits.
- `src/core/codexAdapter.ts`: preserve transcript source pointers and compact recent-turn fields, but classify `PostToolUse` as deferred for live processing.
- `src/core/__tests__/codexAdapter.test.ts`: assert Codex hook normalization exposes the fields needed by the live-fact classifier.
- `src/core/ingestion.ts`: allow an accepted event to remain deduped without remaining in the live projection event array.
- `src/core/__tests__/ingestion.test.ts`: verify deferred events can leave live projection state without becoming duplicate-prone.
- `src/daemon/server.ts`: route `/ingest` through immediate/deferred processing, remove projection-triggered transcript catch-up, trigger bounded catch-up from dossier/transcript reads, and drain deferred work on close.
- `src/core/__tests__/ingestServer.test.ts`: integration tests for deferred tool ingestion, preserved headline facts, projection no longer importing transcripts, and session-open transcript catch-up.
- `src/daemon/db/liveTranscriptFactsRepository.ts`: bound transcript fact reads in SQL instead of reading all messages then trimming in JS.
- `src/daemon/db/sessionDossierRepository.ts`: bound dossier message reads and keep full transcript access on the paginated transcript endpoint.
- `src/daemon/db/__tests__/sessionDossierRepository.test.ts`: regression test for bounded dossier message loading.
- `src/enrichment/enrichmentCoordinator.ts`: apply failure backoff to validation/invalid-output failures, not only timeout/API failures.
- `src/enrichment/__tests__/enrichmentCoordinator.test.ts`: update retry/backoff expectations for validation failures.
- `docs/hook-onboarding.md`: document that tool-use details are deferred and full transcripts are imported on session open.

Do not modify hook installation defaults in this plan. The first pass keeps the installed Codex hooks compatible and reduces Masthead's handling cost behind the existing hook contract.

## Success Criteria

- `/ingest` still accepts current Codex hook payloads and remains fail-open from the hook helper's perspective.
- Session start, session completion, user questions, approvals, blocked/error status, transcript source pointers, and compact recent-turn facts remain immediate live data.
- Successful `PostToolUse` command/file events are no longer required for immediate Board projection or Board headline inputs.
- Failed commands still surface as immediate high-level attention/status facts.
- Board headline logic files remain unchanged.
- Projection does not kick off transcript import work.
- `/ingest`, daemon startup, and transcript approval do not kick off automatic transcript import work.
- Opening a session dossier or transcript endpoint triggers bounded transcript catch-up when approved and when a hook transcript pointer exists.
- Durable enrichment does not repeatedly call remote providers for unchanged validation/invalid-output failures inside the backoff window.
- Full verification passes with `npm run verify`.

## Dependency Map And Guardrails

Tasks must execute sequentially.

- Task 1 establishes the core live-fact classifier and must land before any daemon routing changes.
- Task 2 depends on Task 1 and is the only task that changes `/ingest` live/deferred behavior.
- Task 3 depends on Task 2's live/deferred split and is the only task that changes transcript catch-up scheduling.
- Task 4 depends on Task 3's on-open transcript path and keeps Board headline logic files read-only.
- Task 5 is independent of the ingest queue but should run after Task 4 so enrichment tests exercise the final transcript-fact shape.
- Task 6 verifies the integrated behavior and protected file boundaries.

Implementation guardrails:

- Do not change Codex hook installation events in this pass.
- Do not weaken redaction or store suppressed raw transcript, prompt, patch, command output, or tool response fields.
- Do not change Board headline generation files listed in Protected Product Boundaries.
- Do not add automatic data pruning, vacuuming, or retention changes.
- Do not make projection or `/ingest` wait on transcript import, Git snapshot collection, or remote durable enrichment.
- If an implementation step discovers that a protected boundary must change, stop and escalate instead of widening the task.

Load-reduction acceptance signals:

- `/ingest` accepted handling for immediate events no longer awaits `collectGitSnapshot`.
- Deferred successful tool/file events are removed from `state.events` immediately and remain out of live projection after restart hydration.
- `/projection` contains no call path to hook transcript import.
- Transcript import catch-up is reachable from dossier/transcript open only.
- Durable enrichment `ensureCurrent` returns a recent failed validation/invalid-output record inside the backoff window instead of calling the provider again.

---

### Task 1: Harness-Neutral Live-Fact Classifier

**Files:**
- Create: `src/core/liveSessionFacts.ts`
- Create: `src/core/__tests__/liveSessionFacts.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/codexAdapter.ts`
- Modify: `src/core/__tests__/codexAdapter.test.ts`

- [ ] **Step 1: Write the failing classifier tests**

Create `src/core/__tests__/liveSessionFacts.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  eventLiveProcessingMode,
  liveSessionFactFromEvent,
  liveTranscriptPointerFromEvent,
  shouldApplyLiveEventImmediately
} from "../liveSessionFacts.ts";
import type { NormalizedEvent } from "../types.ts";

describe("live session facts", () => {
  test("treats session lifecycle, user turns, approvals, and completion as immediate live facts", () => {
    const events = [
      event("start", "session.started", { title: "Harness-neutral live facts" }),
      event("question", "user.question", { message: "Make the board lighter." }),
      event("approval", "approval.requested", { command: "npm test" }),
      event("stop", "session.completed", { summary: "Live fact path is working." })
    ];

    expect(events.map(eventLiveProcessingMode)).toEqual(["immediate", "immediate", "immediate", "immediate"]);
    expect(events.every(shouldApplyLiveEventImmediately)).toBe(true);
    expect(events.map((candidate) => liveSessionFactFromEvent(candidate)?.kind)).toEqual([
      "session_started",
      "user_turn",
      "attention",
      "session_completed"
    ]);
  });

  test("defers successful tool and file events out of the live board hot path", () => {
    const shell = event("shell", "command.finished", {
      category: "shell",
      commandId: "call-shell",
      exitCode: 0,
      normalizedCommand: "npm test"
    });
    const file = event("file", "file.changed", {
      category: "file_edit",
      commandId: "call-patch",
      path: "src/core/liveSessionFacts.ts"
    });

    expect(eventLiveProcessingMode(shell)).toBe("deferred");
    expect(eventLiveProcessingMode(file)).toBe("deferred");
    expect(shouldApplyLiveEventImmediately(shell)).toBe(false);
    expect(shouldApplyLiveEventImmediately(file)).toBe(false);
    expect(liveSessionFactFromEvent(shell)).toMatchObject({
      deferredReason: "tool_stat",
      kind: "tool_stat",
      priority: "deferred"
    });
    expect(liveSessionFactFromEvent(file)).toMatchObject({
      deferredReason: "file_stat",
      kind: "tool_stat",
      priority: "deferred"
    });
  });

  test("keeps failed commands immediate because they are high-level attention signals", () => {
    const failed = event("failed", "command.finished", {
      category: "shell",
      commandId: "call-failed",
      exitCode: 1,
      normalizedCommand: "npm test"
    });

    expect(eventLiveProcessingMode(failed)).toBe("immediate");
    expect(liveSessionFactFromEvent(failed)).toMatchObject({
      kind: "attention",
      priority: "immediate",
      status: "failed"
    });
  });

  test("preserves transcript source pointers without storing full transcript text", () => {
    const stopped = event("stop", "session.completed", {
      lastAssistantMessageSummary: { bytes: 4096, redacted: true, stored: false },
      transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/session.jsonl"
    });

    expect(liveTranscriptPointerFromEvent(stopped)).toEqual({
      sourceSessionId: "session-1",
      transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/session.jsonl"
    });
    expect(JSON.stringify(liveSessionFactFromEvent(stopped))).not.toContain("fullTranscript");
  });
});

function event(id: string, type: NormalizedEvent["type"], payload: Record<string, unknown>): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event:${id}`,
    sessionId: "session-1",
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: id
    },
    occurredAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.000Z`,
    receivedAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.100Z`,
    type,
    summary: String(payload.summary ?? payload.message ?? payload.title ?? type),
    payload,
    sensitivity: "metadata",
    payloadHash: `hash:${id}`,
    evidence: [
      {
        id: `event:${id}`,
        kind: "event",
        observedAt: `2026-07-02T12:00:${String(id.length).padStart(2, "0")}.000Z`,
        source: "test"
      }
    ]
  };
}
```

- [ ] **Step 2: Run the classifier test and verify it fails**

Run:

```bash
npm test -- --run src/core/__tests__/liveSessionFacts.test.ts
```

Expected: FAIL because `src/core/liveSessionFacts.ts` does not exist.

- [ ] **Step 3: Widen the adapter type for future harnesses**

In `src/core/types.ts`, replace the current adapter union:

```ts
adapter: "codex" | "git" | "masthead";
```

with:

```ts
adapter: string;
```

This keeps current Codex events valid while avoiding a core type edit every time a new harness emits live facts.

- [ ] **Step 4: Implement `src/core/liveSessionFacts.ts`**

Create `src/core/liveSessionFacts.ts`:

```ts
import type { NormalizedEvent } from "./types.ts";

export type LiveEventProcessingMode = "immediate" | "deferred";

export type LiveSessionFactKind =
  | "session_started"
  | "session_completed"
  | "user_turn"
  | "assistant_turn"
  | "attention"
  | "status"
  | "tool_stat";

export type DeferredLiveReason = "tool_stat" | "file_stat";

export type LiveTranscriptPointer = {
  sourceSessionId: string;
  transcriptPath: string;
};

export type LiveSessionFact = {
  eventId: string;
  sourceSessionId: string;
  adapter: string;
  surface: string;
  kind: LiveSessionFactKind;
  priority: LiveEventProcessingMode;
  occurredAt: string;
  summary: string;
  status?: "active" | "waiting" | "failed" | "completed";
  transcriptPointer?: LiveTranscriptPointer;
  deferredReason?: DeferredLiveReason;
};

export function eventLiveProcessingMode(event: NormalizedEvent): LiveEventProcessingMode {
  return shouldApplyLiveEventImmediately(event) ? "immediate" : "deferred";
}

export function shouldApplyLiveEventImmediately(event: NormalizedEvent): boolean {
  if (!event.sessionId) return false;
  if (event.type === "command.started" || event.type === "file.changed") return false;
  if (event.type === "command.finished") return commandFailed(event);
  return true;
}

export function liveSessionFactFromEvent(event: NormalizedEvent): LiveSessionFact | undefined {
  if (!event.sessionId) return undefined;
  const priority = eventLiveProcessingMode(event);
  const fact: LiveSessionFact = {
    adapter: event.source.adapter,
    eventId: event.eventId,
    kind: factKindForEvent(event),
    occurredAt: event.occurredAt,
    priority,
    sourceSessionId: event.sessionId,
    status: statusForEvent(event),
    summary: event.summary,
    surface: event.source.surface,
    transcriptPointer: liveTranscriptPointerFromEvent(event)
  };
  const deferredReason = deferredReasonForEvent(event);
  return deferredReason ? { ...fact, deferredReason } : fact;
}

export function liveTranscriptPointerFromEvent(event: NormalizedEvent): LiveTranscriptPointer | undefined {
  if (!event.sessionId) return undefined;
  const transcriptPath = stringPayload(event, "transcriptPath") ?? stringPayload(event, "transcript_path");
  if (!transcriptPath) return undefined;
  return {
    sourceSessionId: event.sessionId,
    transcriptPath
  };
}

function factKindForEvent(event: NormalizedEvent): LiveSessionFactKind {
  if (event.type === "session.started") return "session_started";
  if (event.type === "session.completed") return "session_completed";
  if (event.type === "user.question") return "user_turn";
  if (event.type === "approval.requested") return "attention";
  if (event.type === "command.finished" && commandFailed(event)) return "attention";
  if (event.type === "command.started" || event.type === "command.finished" || event.type === "file.changed") return "tool_stat";
  return "status";
}

function statusForEvent(event: NormalizedEvent): LiveSessionFact["status"] {
  if (event.type === "session.completed") return "completed";
  if (event.type === "approval.requested" || event.type === "user.question") return "waiting";
  if (event.type === "command.finished" && commandFailed(event)) return "failed";
  if (event.type === "session.started") return "active";
  return undefined;
}

function deferredReasonForEvent(event: NormalizedEvent): DeferredLiveReason | undefined {
  if (event.type === "file.changed") return "file_stat";
  if (event.type === "command.started") return "tool_stat";
  if (event.type === "command.finished" && !commandFailed(event)) return "tool_stat";
  return undefined;
}

function commandFailed(event: NormalizedEvent): boolean {
  const exitCode = numberPayload(event, "exitCode");
  const status = stringPayload(event, "status");
  return (exitCode !== undefined && exitCode !== 0) || status === "failed" || status === "error";
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberPayload(event: NormalizedEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
```

- [ ] **Step 5: Add Codex normalization assertions for compact live fields**

In `src/core/__tests__/codexAdapter.test.ts`, add this test after the existing `PostToolUse` tests:

```ts
test("keeps Codex transcript pointers and compact summaries available for live facts", () => {
  const event = normalizeCodexHookPayload(
    {
      hookEventName: "Stop",
      sessionId: "codex-session-live-facts",
      timestamp: "2026-07-02T12:01:00.000Z",
      cwd: "/workspace/masthead",
      lastAssistantMessage: "Implemented the live-fact contract and preserved Board headline context.",
      transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/live-facts.jsonl"
    },
    { receivedAt: "2026-07-02T12:01:00.100Z" }
  );

  expect(event.type).toBe("session.completed");
  expect(event.payload).toMatchObject({
    lastAssistantMessageSummary: {
      redacted: true,
      stored: false
    },
    transcriptPath: "/home/tyler/.codex/sessions/2026/07/02/live-facts.jsonl"
  });
  expect(event.payload.lastAssistantMessage).toBeUndefined();
  expect(JSON.stringify(event)).not.toContain("Implemented the live-fact contract");
});
```

- [ ] **Step 6: Run Task 1 tests**

Run:

```bash
npm test -- --run src/core/__tests__/liveSessionFacts.test.ts src/core/__tests__/codexAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/core/liveSessionFacts.ts src/core/__tests__/liveSessionFacts.test.ts src/core/types.ts src/core/codexAdapter.ts src/core/__tests__/codexAdapter.test.ts
git commit -m "feat: add harness-neutral live fact classification"
```

---

### Task 2: Defer Tool-Heavy Ingest Work

**Files:**
- Create: `src/daemon/liveIngestQueue.ts`
- Create: `src/daemon/__tests__/liveIngestQueue.test.ts`
- Modify: `src/core/ingestion.ts`
- Modify: `src/core/__tests__/ingestion.test.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/core/__tests__/ingestServer.test.ts`

- [ ] **Step 1: Write queue unit tests**

Create `src/daemon/__tests__/liveIngestQueue.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createLiveIngestQueue } from "../liveIngestQueue.ts";
import type { NormalizedEvent } from "../../core/types.ts";

describe("live ingest queue", () => {
  test("batches deferred events and flushes them in insertion order", async () => {
    const flushed: NormalizedEvent[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onFlush: async (events) => {
        flushed.push(events);
      }
    });

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    expect(flushed).toEqual([]);
    await queue.flushNow();

    expect(flushed.map((batch) => batch.map((candidate) => candidate.eventId))).toEqual([["event:one", "event:two"]]);
  });

  test("flushes automatically when max batch size is reached", async () => {
    const flushed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 2,
      onFlush: async (events) => {
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    await queue.flushNow();
    expect(flushed).toEqual([["event:one", "event:two"]]);
  });

  test("continues accepting events after a failed flush", async () => {
    let calls = 0;
    const flushed: string[][] = [];
    const errors: Array<{ error: unknown; events: string[] }> = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onError: (error, events) => {
        errors.push({ error, events: events.map((candidate) => candidate.eventId) });
      },
      onFlush: async (events) => {
        calls += 1;
        if (calls === 1) throw new Error("first flush failed");
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("failed"));
    await expect(queue.flushNow()).rejects.toThrow("first flush failed");
    queue.enqueue(event("recovered"));
    await queue.flushNow();

    expect(flushed).toEqual([["event:recovered"]]);
    expect(errors).toEqual([
      {
        error: expect.any(Error),
        events: ["event:failed"]
      }
    ]);
  });
});

function event(id: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event:${id}`,
    sessionId: "session-1",
    source: {
      adapter: "codex",
      surface: "hook",
      sourceEventId: id
    },
    occurredAt: "2026-07-02T12:00:00.000Z",
    receivedAt: "2026-07-02T12:00:00.100Z",
    type: "command.finished",
    summary: "Tool event",
    payload: { exitCode: 0 },
    sensitivity: "metadata",
    payloadHash: `hash:${id}`,
    evidence: [
      {
        id: `event:${id}`,
        kind: "event",
        observedAt: "2026-07-02T12:00:00.000Z",
        source: "test"
      }
    ]
  };
}
```

- [ ] **Step 2: Run queue tests and verify failure**

Run:

```bash
npm test -- --run src/daemon/__tests__/liveIngestQueue.test.ts
```

Expected: FAIL because `src/daemon/liveIngestQueue.ts` does not exist.

- [ ] **Step 3: Implement the bounded queue**

Create `src/daemon/liveIngestQueue.ts`:

```ts
import type { NormalizedEvent } from "../core/types.ts";

export type LiveIngestQueue = {
  enqueue(event: NormalizedEvent): void;
  flushNow(): Promise<void>;
  close(): Promise<void>;
  size(): number;
};

export type LiveIngestQueueOptions = {
  flushDelayMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown, events: NormalizedEvent[]) => void;
  onFlush(events: NormalizedEvent[]): Promise<void> | void;
};

export function createLiveIngestQueue(options: LiveIngestQueueOptions): LiveIngestQueue {
  const flushDelayMs = Math.max(0, options.flushDelayMs ?? 750);
  const maxBatchSize = Math.max(1, options.maxBatchSize ?? 100);
  const pending: NormalizedEvent[] = [];
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let closed = false;

  function enqueue(event: NormalizedEvent): void {
    if (closed) return;
    pending.push(event);
    if (pending.length >= maxBatchSize) {
      clearTimer();
      triggerBackgroundFlush();
      return;
    }
    schedule();
  }

  async function flushNow(): Promise<void> {
    clearTimer();
    inFlight = inFlight.then(flushBatch, flushBatch);
    return inFlight;
  }

  async function close(): Promise<void> {
    closed = true;
    clearTimer();
    await flushNow();
  }

  function size(): number {
    return pending.length;
  }

  function schedule(): void {
    if (timer || pending.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      triggerBackgroundFlush();
    }, flushDelayMs);
    timer.unref?.();
  }

  function triggerBackgroundFlush(): void {
    inFlight = inFlight.catch(() => undefined).then(flushBatch);
    void inFlight.catch(() => undefined);
  }

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  }

  async function flushBatch(): Promise<void> {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    try {
      await options.onFlush(batch);
    } catch (error) {
      options.onError?.(error, batch);
      throw error;
    }
  }

  return {
    close,
    enqueue,
    flushNow,
    size
  };
}
```

- [ ] **Step 4: Add integration tests for deferred tool handling**

In `src/core/__tests__/ingestion.test.ts`, add this import:

```ts
import { removeEventFromLiveProjectionState } from "../ingestion";
```

If the file already imports from `../ingestion`, add `removeEventFromLiveProjectionState` to the existing import list.

Then add this test near the dedupe test:

```ts
test("can remove an accepted event from live projection state while preserving dedupe memory", () => {
  const state = createIngestionState();
  const first = ingestCodexHookPayload(JSON.stringify(hookPayload), state, {
    receivedAt: "2026-06-23T02:12:00.100Z"
  });
  expect(first.status).toBe("accepted");
  if (first.status !== "accepted") throw new Error("expected accepted event");

  removeEventFromLiveProjectionState(state, first.event);
  const duplicate = ingestCodexHookPayload(JSON.stringify(hookPayload), state, {
    receivedAt: "2026-06-23T02:12:00.200Z"
  });

  expect(state.events).toHaveLength(0);
  expect(duplicate.status).toBe("duplicate");
});
```

Add this test near the same section:

```ts
test("hydrates dedupe memory without hydrating deferred events into live projection state", () => {
  const accepted = ingestCodexHookPayload(JSON.stringify(hookPayload), createIngestionState(), {
    receivedAt: "2026-06-23T02:12:00.100Z"
  });
  expect(accepted.status).toBe("accepted");
  if (accepted.status !== "accepted") throw new Error("expected accepted event");

  const state = createIngestionState([accepted.event], {
    includeInLiveProjection: () => false
  });
  const duplicate = ingestCodexHookPayload(JSON.stringify(hookPayload), state, {
    receivedAt: "2026-06-23T02:12:00.200Z"
  });

  expect(state.events).toHaveLength(0);
  expect(duplicate.status).toBe("duplicate");
});
```

In `src/core/ingestion.ts`, add this options type near `IngestionOptions`:

```ts
type CreateIngestionStateOptions = {
  includeInLiveProjection?: (event: NormalizedEvent) => boolean;
};
```

Change the `createIngestionState` signature from:

```ts
export function createIngestionState(events: NormalizedEvent[] = []): IngestionState {
```

to:

```ts
export function createIngestionState(
  events: NormalizedEvent[] = [],
  options: CreateIngestionStateOptions = {}
): IngestionState {
```

Inside its loop, replace:

```ts
state.events.push(event);
```

with:

```ts
if (options.includeInLiveProjection?.(event) ?? true) state.events.push(event);
```

Then add this exported helper after `ingestNormalizedEvent`:

```ts
export function removeEventFromLiveProjectionState(state: IngestionState, event: NormalizedEvent): void {
  state.events = state.events.filter((candidate) => candidate.eventId !== event.eventId);
}
```

This intentionally leaves `seenProviderEventIds` and `seenPayloadHashes` untouched so deferred tool events still dedupe.

In `src/core/__tests__/ingestServer.test.ts`, add a test near the other `/ingest` tests:

```ts
test("defers successful PostToolUse events out of immediate projection while preserving high-value turns", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
  tempDirs.push(tempDir);
  const storePath = join(tempDir, "events.ndjson");
  const databasePath = join(tempDir, "masthead.sqlite");
  const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
  servers.push(server.child);

  await postJson(server.baseUrl, "/ingest", liveQuestionPayload("server-live-question"));
  await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-tool"));

  const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
  const card = projection.projection.cards[0];

  expect(card.sessionId).toBe("server-live");
  expect(card.headlineInput.facts.recentTranscriptMessages).toEqual(
    expect.arrayContaining(["Make Masthead live facts lightweight."])
  );
  expect(card.headlineInput.facts.recentToolNames).not.toContain("npm run noisy-tool-stat");
});
```

Add these helpers near the existing payload helpers in the same file:

```ts
function liveQuestionPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "user_question",
    session_id: "server-live",
    timestamp: "2026-06-24T12:01:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    title: "Lightweight live facts",
    message: "Make Masthead live facts lightweight."
  };
}

function liveSuccessfulToolPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "PostToolUse",
    sessionId: "server-live",
    timestamp: "2026-06-24T12:02:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    toolName: "Bash",
    toolUseId: "call-noisy-tool-stat",
    toolInput: {
      command: "npm run noisy-tool-stat"
    },
    toolResponse: "exit code 0"
  };
}
```

- [ ] **Step 5: Run the new integration test and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/ingestion.test.ts -t "remove an accepted event"
npm test -- --run src/core/__tests__/ingestServer.test.ts -t "defers successful PostToolUse"
```

Expected: FAIL before the server wiring is complete because successful `PostToolUse` events still enter immediate projection.

- [ ] **Step 6: Wire the queue into `src/daemon/server.ts`**

Add imports near the existing imports:

```ts
import { eventLiveProcessingMode } from "../core/liveSessionFacts.ts";
import { removeEventFromLiveProjectionState } from "../core/ingestion.ts";
import { createLiveIngestQueue } from "./liveIngestQueue.ts";
```

If `server.ts` already imports from `../core/ingestion.ts`, merge `removeEventFromLiveProjectionState` into that import instead of adding a duplicate import.

Replace the existing ingestion-state initialization:

```ts
const state = createIngestionState(canonicalLiveEvents(database));
```

with:

```ts
const state = createIngestionState(canonicalLiveEvents(database), {
  includeInLiveProjection: (event) => eventLiveProcessingMode(event) === "immediate"
});
```

This keeps stored deferred tool records available for dedupe after restart without putting them back into Now projection.

After `appendGitSnapshotIfChanged` is defined in `createMastheadDaemon`, create the queue:

```ts
    const deferredLiveIngestQueue = createLiveIngestQueue({
      flushDelayMs: 750,
      maxBatchSize: 100,
      onError: (error, events) => {
        recordRuntimeDiagnostic({
          details: {
            error,
            eventIds: events.map((event) => event.eventId),
            sourceSessionIds: [...new Set(events.flatMap((event) => (event.sessionId ? [event.sessionId] : [])))]
          },
          kind: "deferred_live_ingest_flush_failed",
          message: `Deferred live ingest flush failed for ${events.length} event${events.length === 1 ? "" : "s"}.`,
          severity: "warning"
        });
      },
      onFlush: async (events) => {
        const latestEventBySession = new Map<string, NormalizedEvent>();
        for (const event of events) {
          appendStoreRecordToRawJournal({
            recordId: `event:${event.eventId}`,
            recordType: "event",
            observedAt: event.occurredAt,
            value: event
          });
          const sessionId = sessions.upsertLiveEvent(event);
          if (sessionId) indexCanonicalSessionSearch(database, sessionId);
          if (event.sessionId) latestEventBySession.set(event.sessionId, event);
        }
        for (const event of latestEventBySession.values()) {
          const gitSnapshot = await collectGitSnapshot(event);
          if (gitSnapshot) await appendGitSnapshotIfChanged(gitSnapshot);
        }
      }
    });
```

If `appendGitSnapshotIfChanged` is currently declared after the `/ingest` handler, move only the queue creation to the nearest scope where `appendGitSnapshotIfChanged`, `appendStoreRecordToRawJournal`, `sessions`, and `database` are all available. Do not move unrelated server code.

In the `/ingest` accepted branch, replace the current accepted-event body:

```ts
      if (result.status === "accepted") {
        const sessionId = sessions.upsertLiveEvent(result.event);
        if (sessionId) {
          indexCanonicalSessionSearch(database, sessionId);
          if (!shouldDeferLiveEnrichmentToHookTranscript(result.event)) queueSessionEnrichment(sessionId);
          scheduleHookTranscriptCatchup(result.event);
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

with:

```ts
      if (result.status === "accepted") {
        if (eventLiveProcessingMode(result.event) === "deferred") {
          removeEventFromLiveProjectionState(state, result.event);
          deferredLiveIngestQueue.enqueue(result.event);
        } else {
          const sessionId = sessions.upsertLiveEvent(result.event);
          if (sessionId) {
            indexCanonicalSessionSearch(database, sessionId);
            if (!shouldDeferLiveEnrichmentToHookTranscript(result.event)) queueSessionEnrichment(sessionId);
            scheduleHookTranscriptCatchup(result.event);
          }
          appendStoreRecordToRawJournal({
            recordId: `event:${result.event.eventId}`,
            recordType: "event",
            observedAt: result.event.occurredAt,
            value: result.event
          });
        }
      }
```

This intentionally removes `await collectGitSnapshot(result.event)` from the immediate hook response path. Deferred flush coalesces Git snapshots to one attempt per source session per batch.

In the daemon `close` implementation, stop accepting new HTTP work before draining the queue, then checkpoint and close the database. The close flow should keep the existing `closePromise` guard and end up in this order inside the async close body:

```ts
await hydrationPromise;
if (gitRefreshTimer) clearInterval(gitRefreshTimer);
await new Promise<void>((resolve) => server.close(() => resolve()));
await deferredLiveIngestQueue.close();
checkpointMastheadDatabase(database);
closeDatabase(database);
await writerLock.release();
```

Keep the existing error handling around `checkpointMastheadDatabase(database)` and `writerLock.release()`. The key requirement is that `deferredLiveIngestQueue.close()` runs after `server.close()` and before the database is checkpointed or closed.

- [ ] **Step 7: Keep response shape compatible**

In the `/ingest` response body, keep the existing fields:

```ts
{
  ok: true,
  status: result.status,
  event: result.event,
  gitSnapshots: gitSnapshots.length,
  events: state.events.length
}
```

Do not remove `event`, `events`, or `gitSnapshots` in this task. Compatibility matters more than reducing response bytes in the first pass.

- [ ] **Step 8: Run Task 2 tests**

Run:

```bash
npm test -- --run src/daemon/__tests__/liveIngestQueue.test.ts src/core/__tests__/ingestion.test.ts src/core/__tests__/ingestServer.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/daemon/liveIngestQueue.ts src/daemon/__tests__/liveIngestQueue.test.ts src/core/ingestion.ts src/core/__tests__/ingestion.test.ts src/daemon/server.ts src/core/__tests__/ingestServer.test.ts
git commit -m "feat: defer tool-heavy live ingest work"
```

---

### Task 3: Move Transcript Catch-Up From Projection To Session Open

**Files:**
- Modify: `src/daemon/server.ts`
- Modify: `src/core/__tests__/ingestServer.test.ts`
- Modify: `docs/hook-onboarding.md`

- [ ] **Step 1: Add a failing integration test for projection not importing transcripts**

In `src/core/__tests__/ingestServer.test.ts`, add:

```ts
test("projection does not import hook transcripts, but opening a session transcript triggers bounded catch-up", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
  tempDirs.push(tempDir);
  const codexHome = join(tempDir, "home");
  const sessionsDir = join(codexHome, ".codex", "sessions", "2026", "07", "02");
  await mkdir(sessionsDir, { recursive: true });
  const transcriptPath = join(sessionsDir, "server-live.jsonl");
  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      content: "Transcript text imported when the session is opened.",
      role: "user",
      session_id: "server-live",
      timestamp: "2026-07-02T12:03:00.000Z"
    })}\n`,
    "utf8"
  );
  const storePath = join(tempDir, "events.ndjson");
  const databasePath = join(tempDir, "masthead.sqlite");
  const server = await startServer(storePath, {
    MASTHEAD_CODEX_HOME: codexHome,
    MASTHEAD_DB_PATH: databasePath
  });
  servers.push(server.child);

  await postJson(server.baseUrl, "/sources/codex/approve-transcripts", {});
  const accepted = await postJson(server.baseUrl, "/ingest", liveStopWithTranscriptPayload("server-open-transcript", transcriptPath));
  const canonicalSessionId = accepted.event.sessionId
    ? canonicalSessionIdFromDatabase(databasePath, accepted.event.sessionId)
    : undefined;
  expect(canonicalSessionId).toBeTruthy();

  await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
  expect(transcriptMessageTexts(databasePath, canonicalSessionId as string)).not.toContain(
    "Transcript text imported when the session is opened."
  );

  await getJson(server.baseUrl, `/sessions/${encodeURIComponent(canonicalSessionId as string)}/transcript`);
  await waitFor(() => {
    expect(transcriptMessageTexts(databasePath, canonicalSessionId as string)).toContain(
      "Transcript text imported when the session is opened."
    );
  });
});
```

Add helpers near the other test helpers:

```ts
function liveStopWithTranscriptPayload(providerEventId: string, transcriptPath: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hook_event_name: "Stop",
    session_id: "server-live",
    timestamp: "2026-07-02T12:02:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    summary: "Live session stopped.",
    transcript_path: transcriptPath
  };
}

function canonicalSessionIdFromDatabase(databasePath: string, sourceSessionId: string): string | undefined {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db
      .prepare("SELECT session_id AS sessionId FROM sessions WHERE source_session_id = ?")
      .get(sourceSessionId) as { sessionId: string } | undefined;
    return row?.sessionId;
  } finally {
    db.close();
  }
}

function transcriptMessageTexts(databasePath: string, sessionId: string): string[] {
  const db = new DatabaseSync(databasePath);
  try {
    const rows = db
      .prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ? ORDER BY observed_at ASC")
      .all(sessionId) as Array<{ text: string }>;
    return rows.map((row) => row.text);
  } finally {
    db.close();
  }
}
```

If `waitFor` already exists in the test file, reuse it. If it does not, add:

```ts
async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1500;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assertion();
  throw lastError;
}
```

- [ ] **Step 2: Run the new test and verify failure**

Run:

```bash
npm test -- --run src/core/__tests__/ingestServer.test.ts -t "projection does not import hook transcripts"
```

Expected: FAIL because projection currently calls `catchUpVisibleHookTranscripts`.

- [ ] **Step 3: Remove automatic transcript catch-up from projection, ingest, startup, and approval**

In `src/daemon/server.ts`, remove this line from the `/projection` handler:

```ts
await catchUpVisibleHookTranscripts(projectionSessionIds, refreshIntervalMs);
```

Keep `refreshIntervalMs` because Board headline enrichment still uses it.

In the `/ingest` accepted immediate branch, remove this line:

```ts
scheduleHookTranscriptCatchup(result.event);
```

Leave the `queueSessionEnrichment` guard in place:

```ts
if (!shouldDeferLiveEnrichmentToHookTranscript(result.event)) queueSessionEnrichment(sessionId);
```

This keeps durable enrichment from running against hook-only facts when a transcript pointer is available and transcript import has already been approved. The transcript import and enrichment queue happen from session open.

Remove the startup timer block:

```ts
const startupHookTranscriptCatchupTimer = setTimeout(() => {
  scheduleRecentHookTranscriptCatchups("startup");
}, 1000).unref();
```

Remove the matching shutdown cleanup:

```ts
clearTimeout(startupHookTranscriptCatchupTimer);
```

In `approveTranscriptImports`, remove this line:

```ts
if (!runtime || runtime === "codex") scheduleRecentHookTranscriptCatchups("approval");
```

If `scheduleRecentHookTranscriptCatchups`, `recentHookEventsWithTranscriptPaths`, or `HOOK_TRANSCRIPT_RECOVERY_LIMIT` become unused after these removals, delete those unused server-local references and imports. Keep `scheduleHookTranscriptCatchup`, `importHookTranscriptIfApproved`, and `recentHookEventsWithTranscriptPathsForSessions` because the on-open helper uses them.

- [ ] **Step 4: Add on-open transcript catch-up helper**

In `src/daemon/server.ts`, add this helper near the existing hook transcript catch-up helpers:

```ts
  async function catchUpSessionTranscriptIfApproved(canonicalSessionIdValue: string): Promise<void> {
    if (!config.hookTranscriptCatchupEnabled || !transcriptImportApproved(database)) return;
    const row = database
      .prepare("SELECT source_session_id AS sourceSessionId FROM sessions WHERE session_id = ? AND deleted_at IS NULL")
      .get(canonicalSessionIdValue) as { sourceSessionId: string } | undefined;
    const sourceSessionId = row?.sourceSessionId?.trim();
    if (!sourceSessionId) return;
    const events = recentHookEventsWithTranscriptPathsForSessions(
      database,
      codexHookSource.sourceId,
      new Set([sourceSessionId]),
      1
    );
    const scheduled = events
      .map((event) => scheduleHookTranscriptCatchup(event))
      .filter((promise): promise is Promise<void> => Boolean(promise));
    if (scheduled.length === 0) return;
    await Promise.race([Promise.allSettled(scheduled).then(() => undefined), unrefDelay(VISIBLE_TRANSCRIPT_CATCHUP_BUDGET_MS)]);
  }
```

- [ ] **Step 5: Call catch-up from dossier and transcript endpoints**

In the dossier endpoint, before reading the dossier, change:

```ts
const dossier = getSessionDossier(database, decodeURIComponent(sessionDossierMatch[1]));
```

to:

```ts
const sessionId = decodeURIComponent(sessionDossierMatch[1]);
await catchUpSessionTranscriptIfApproved(sessionId);
const dossier = getSessionDossier(database, sessionId);
```

In the transcript endpoint, before `getSessionTranscript`, change:

```ts
sendJson(request, response, config.allowedOrigins, 200, {
  ok: true,
  ...getSessionTranscript(database, {
```

to:

```ts
const sessionId = decodeURIComponent(sessionTranscriptMatch[1]);
await catchUpSessionTranscriptIfApproved(sessionId);
sendJson(request, response, config.allowedOrigins, 200, {
  ok: true,
  ...getSessionTranscript(database, {
```

and replace the existing inline decode in the transcript options:

```ts
sessionId: decodeURIComponent(sessionTranscriptMatch[1])
```

with:

```ts
sessionId
```

- [ ] **Step 6: Remove now-unused visible catch-up state**

If TypeScript reports unused symbols after Step 3, remove the smallest possible unused pieces:

- `visibleTranscriptCatchupLastRunBySession`
- `catchUpVisibleHookTranscripts`
- `effectiveVisibleTranscriptCatchupIntervalMs` if it becomes unused

Do not remove `scheduleHookTranscriptCatchup`, `importHookTranscriptIfApproved`, or `recentHookEventsWithTranscriptPathsForSessions`.

- [ ] **Step 7: Update hook onboarding docs**

In `docs/hook-onboarding.md`, add this paragraph under the helper behavior list:

```md
Live hook ingestion keeps the Now board supplied with compact session facts. Successful tool-use details are deferred out of the immediate board path, while failed commands, approvals, user questions, session start/stop signals, and transcript source pointers remain live. Full transcript catch-up runs when transcript import is approved and the session dossier or transcript endpoint is opened.
```

- [ ] **Step 8: Run Task 3 tests**

Run:

```bash
npm test -- --run src/core/__tests__/ingestServer.test.ts src/daemon/__tests__/hookTranscriptRecovery.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/daemon/server.ts src/core/__tests__/ingestServer.test.ts docs/hook-onboarding.md
git commit -m "feat: import hook transcripts on session open"
```

---

### Task 4: Bound Projection And Dossier Reads Without Touching Headline Logic

**Files:**
- Modify: `src/daemon/db/liveTranscriptFactsRepository.ts`
- Modify: `src/daemon/db/sessionDossierRepository.ts`
- Modify: `src/daemon/db/__tests__/sessionDossierRepository.test.ts`
- Modify: `src/enrichment/__tests__/productionIntegration.test.ts`

- [ ] **Step 1: Add a dossier bound regression test**

In `src/daemon/db/__tests__/sessionDossierRepository.test.ts`, add:

```ts
test("bounds message rows used to build the dossier while preserving newest narrative facts", async () => {
  const db = await openTestDatabase();
  seedDossierSession(db, { sessionId: "session-many-messages" });
  db.prepare("DELETE FROM messages WHERE session_id = ?").run("session-many-messages");
  for (let index = 0; index < 320; index += 1) {
    insertMessage(
      db,
      "session-many-messages",
      `bulk-${index}`,
      index % 2 === 0 ? "user" : "assistant",
      `Bounded dossier message ${index}`,
      `2026-06-26T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
    );
  }

  const dossier = getSessionDossier(db, "session-many-messages");

  expect(dossier?.narrative.latestUserPrompt).toBe("Bounded dossier message 318");
  expect(dossier?.narrative.finalAssistantMessage).toBe("Bounded dossier message 319");
  expect(dossier?.timeline.length).toBeLessThanOrEqual(260);
  db.close();
});
```

- [ ] **Step 2: Add a production headline-input regression**

In `src/enrichment/__tests__/productionIntegration.test.ts`, add this assertion to the existing `live ingestion persists reusable enrichment and reindexes the session` test after the projection is fetched:

```ts
expect(projection.projection.cards[0].headlineInput.facts.recentTranscriptMessages).toEqual(
  expect.arrayContaining(["Fix OAuth callback routing."])
);
```

This locks in Tyler's requirement: the Board headline path still receives enough compact transcript context.

- [ ] **Step 3: Run the new tests and verify failure where expected**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts src/enrichment/__tests__/productionIntegration.test.ts
```

Expected: The dossier bound test may fail because `getMessages` currently loads all messages.

- [ ] **Step 4: Bound live transcript fact reads in SQL**

In `src/daemon/db/liveTranscriptFactsRepository.ts`, replace the current query with a ranked query:

```ts
  const maxMessagesPerSession = Math.max(1, Math.min(options.maxMessagesPerSession ?? 24, 48));
  const sourceSessionFilter = scopedSourceSessionIds ? `AND sessions.source_session_id IN (${scopedSourceSessionIds.map(() => "?").join(", ")})` : "";
  const rows = db
    .prepare(
      `WITH ranked_messages AS (
        SELECT
          sessions.source_session_id AS sourceSessionId,
          messages.role AS role,
          messages.text_redacted AS text,
          messages.observed_at AS observedAt,
          messages.message_id AS messageId,
          ROW_NUMBER() OVER (
            PARTITION BY sessions.source_session_id
            ORDER BY COALESCE(messages.observed_at, '') DESC, messages.message_id DESC
          ) AS rowNumber
        FROM messages
        JOIN sessions ON sessions.session_id = messages.session_id
        WHERE messages.role IN ('user', 'assistant')
          AND trim(COALESCE(messages.text_redacted, '')) <> ''
          ${sourceSessionFilter}
      )
      SELECT sourceSessionId, role, text, observedAt
      FROM ranked_messages
      WHERE rowNumber <= ?
      ORDER BY sourceSessionId ASC, COALESCE(observedAt, '') DESC, messageId DESC`
    )
    .all(...(scopedSourceSessionIds ?? []), maxMessagesPerSession) as TranscriptFactRow[];
```

Remove the later duplicate `const maxMessagesPerSession = Math.max(1, Math.min(options.maxMessagesPerSession ?? 24, 48));` declaration from the old implementation and keep the existing JS guard as defensive code:

```ts
if (facts.recentMessages.length >= maxMessagesPerSession) {
  factsBySourceSession.set(sourceSessionId, facts);
  continue;
}
```

- [ ] **Step 5: Bound dossier message reads**

In `src/daemon/db/sessionDossierRepository.ts`, add constants near the type definitions:

```ts
const DOSSIER_MESSAGE_LIMIT = 240;
const DOSSIER_TIMELINE_LIMIT = 260;
```

Replace `getMessages` with:

```ts
function getMessages(db: MastheadDatabase, sessionId: string): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT message_id AS messageId, role, text_redacted AS text, observed_at AS observedAt, source_ref_json AS sourceRefJson
      FROM messages
      WHERE session_id = ?
      ORDER BY observed_at DESC, message_id DESC
      LIMIT ?`
    )
    .all(sessionId, DOSSIER_MESSAGE_LIMIT) as MessageRow[];
  return rows.toSorted((left, right) => left.observedAt.localeCompare(right.observedAt) || left.messageId.localeCompare(right.messageId));
}
```

In `getTimeline`, keep the existing event assembly but cap the returned array:

```ts
  return events
    .toSorted((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(-DOSSIER_TIMELINE_LIMIT);
```

Use the local variable names already present in `getTimeline`. Do not change the DTO shape.

- [ ] **Step 6: Run Task 4 tests**

Run:

```bash
npm test -- --run src/daemon/db/__tests__/sessionDossierRepository.test.ts src/enrichment/__tests__/productionIntegration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/daemon/db/liveTranscriptFactsRepository.ts src/daemon/db/sessionDossierRepository.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts src/enrichment/__tests__/productionIntegration.test.ts
git commit -m "perf: bound live transcript and dossier reads"
```

---

### Task 5: Back Off Repeated Enrichment Validation Failures

**Files:**
- Modify: `src/enrichment/enrichmentCoordinator.ts`
- Modify: `src/enrichment/__tests__/enrichmentCoordinator.test.ts`

- [ ] **Step 1: Replace the existing validation retry test**

In `src/enrichment/__tests__/enrichmentCoordinator.test.ts`, replace the test named:

```ts
test("ensureCurrent retries validation failures without stale-failure backoff", async () => {
```

with:

```ts
test("ensureCurrent backs off recent validation failures for unchanged facts", async () => {
  const db = await openTestDatabase();
  seedSession(db);
  const provider = countingFailingProvider("validation_failed");
  let now = Date.parse("2026-06-25T12:00:00.000Z");
  const coordinator = createEnrichmentCoordinator(db, provider, {
    failureBackoffMs: 10 * 60_000,
    now: () => now
  });

  await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "validation_failed" });
  const backedOff = await coordinator.ensureCurrent("session-1");

  now += 10 * 60_000 + 1;
  await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "validation_failed" });

  expect(backedOff).toMatchObject({
    failureCode: "validation_failed",
    status: "failed"
  });
  expect(provider.calls()).toBe(2);
  db.close();
});
```

- [ ] **Step 2: Run the changed test and verify failure**

Run:

```bash
npm test -- --run src/enrichment/__tests__/enrichmentCoordinator.test.ts -t "backs off recent validation failures"
```

Expected: FAIL because `isRecentFailureForFingerprint` explicitly skips `validation_failed`.

- [ ] **Step 3: Apply backoff to all unchanged provider failures**

In `src/enrichment/enrichmentCoordinator.ts`, replace:

```ts
if (record.failureCode === "validation_failed") return false;
```

with no line. The final function should be:

```ts
function isRecentFailureForFingerprint(
  record: SessionEnrichmentRecord | undefined,
  fingerprint: string,
  nowMs: number,
  failureBackoffMs: number
): record is SessionEnrichmentRecord {
  if (!record?.generatedAt || !record.contentFingerprint.startsWith(`${fingerprint}:failed:`)) return false;
  const generatedAtMs = Date.parse(record.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return false;
  return nowMs - generatedAtMs < failureBackoffMs;
}
```

This intentionally leaves direct `coordinator.enrich(sessionId)` behavior unchanged. Only `ensureCurrent` backs off repeated unchanged failures.

- [ ] **Step 4: Run Task 5 tests**

Run:

```bash
npm test -- --run src/enrichment/__tests__/enrichmentCoordinator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/enrichment/enrichmentCoordinator.ts src/enrichment/__tests__/enrichmentCoordinator.test.ts
git commit -m "fix: back off repeated enrichment validation failures"
```

---

### Task 6: Final Verification And Product Contract Check

**Files:**
- No planned source edits.

- [ ] **Step 1: Run targeted regression suite**

Run:

```bash
npm test -- --run src/core/__tests__/liveSessionFacts.test.ts src/daemon/__tests__/liveIngestQueue.test.ts src/core/__tests__/codexAdapter.test.ts src/core/__tests__/ingestServer.test.ts src/enrichment/__tests__/productionIntegration.test.ts src/enrichment/__tests__/enrichmentCoordinator.test.ts src/daemon/db/__tests__/sessionDossierRepository.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run product contract checks**

Run:

```bash
npm run check:product-contract
npm run typecheck
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS. If this fails because an unrelated existing test is already failing, capture the failing command, test name, and error text in the task closeout before asking Tyler for direction.

- [ ] **Step 4: Inspect removed hot-path call sites**

Run:

```bash
if rg -n "catchUpVisibleHookTranscripts|startupHookTranscriptCatchupTimer|scheduleRecentHookTranscriptCatchups|scheduleHookTranscriptCatchup\\(result\\.event\\)|await collectGitSnapshot\\(result\\.event\\)" src/daemon/server.ts; then
  echo "Unexpected hot-path transcript/git work remains in server.ts"
  exit 1
fi
```

Expected: command exits `0` with no matching hot-path call sites.

- [ ] **Step 5: Inspect protected headline files**

Run:

```bash
git diff -- src/core/boardHeadlineEnricher.ts src/core/boardHeadlineInput.ts src/core/boardHeadlineFacts.ts src/core/offlineBoardHeadline.ts src/core/openaiBoardHeadlineFrame.ts src/core/boardHeadlineRefreshKey.ts
```

Expected: no diff.

- [ ] **Step 6: Inspect final changed-file scope**

Run:

```bash
git diff --stat HEAD~5..HEAD
```

Expected: changed files are limited to the task files listed in this plan.

- [ ] **Step 7: Commit verification fixes if verification required edits**

If implementation required only code/test changes already committed in Tasks 1 through 5, do not create an empty verification commit. If a verification fix changed docs or tests, inspect `git status --short`, stage only the changed files that belong to the verification fix, and commit them:

```bash
git status --short
git add docs/hook-onboarding.md src/core/__tests__/ingestServer.test.ts
git commit -m "test: verify lightweight live facts integration"
```

The `git add` command above shows the most likely verification-fix paths. Replace it with the actual task-owned files from `git status --short` when the executed fix touches different files.

---

## Subagent Review Prompts

Use these review emphases after each task.

Spec compliance reviewer:

```text
Review the completed task against docs/superpowers/plans/2026-07-02-harness-neutral-lightweight-live-facts.md.
Focus only on whether the implementation matches the task requirements.
Confirm that Board headline logic files were not changed.
Confirm that successful tool-use work is deferred, while user turns, approvals, failed commands, session start/stop, and transcript pointers remain immediate.
Return findings with exact file and line references.
```

Code quality reviewer:

```text
Review the completed task for correctness, minimality, maintainability, and test quality.
Look for hidden synchronous work in /ingest and /projection, unbounded queries, dropped transcript pointers, privacy regressions, and accidental changes to Board headline behavior.
Return findings with exact file and line references.
```

Final reviewer:

```text
Review the full implementation for the lightweight live-facts objective.
Verify that the product remains harness-neutral, Codex is only the first adapter path, Board headline generation behavior was not rewritten, and no privacy/redaction behavior was weakened.
Check that full transcripts are imported on session open and that tool use is deferred rather than required for immediate live projection.
Return blockers first, then residual risks.
```

## Residual Risks To Watch During Execution

- Deferred queue crash window: successful tool-use events queued in memory can be lost if the daemon exits before flush. This is acceptable for the first pass only because Tyler explicitly demoted live tool-use importance. If reviewers object, the next iteration should use a tiny durable queue table.
- Transcript catch-up on session open can make first dossier open slower. Keep the existing 750 ms budget and return current data if import takes longer.
- On-open transcript catch-up can still be expensive for very large transcripts. If first-open latency is too high after this pass, add a visible import-progress state instead of moving transcript work back to projection or startup.
- The hook helper still starts a Node process per Codex hook event. This plan reduces Masthead daemon amplification but does not replace Codex's hook process model.
- Storage compaction is intentionally not included. Evidence pruning needs a separate user-controlled plan because silent retention changes are product-risky.

## Self-Review Checklist

- Spec coverage: the plan covers live-fact contract, Codex hot-path demotion, transcript-on-open import, bounded projection/dossier reads, enrichment backoff, tests, and verification.
- Placeholder scan: no incomplete task sections are present.
- Type consistency: `LiveEventProcessingMode`, `LiveSessionFact`, `eventLiveProcessingMode`, and `shouldApplyLiveEventImmediately` are named consistently across tasks.
- Product boundary: Board headline logic files are protected and checked at final verification.
- Harness-neutrality: the new live-fact contract uses string adapter identity and does not introduce Codex-only core semantics.
