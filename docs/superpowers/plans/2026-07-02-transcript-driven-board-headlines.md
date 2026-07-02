# Transcript-Driven Board Headlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Board headline refreshes reliable by tailing real session transcript messages quickly, refreshing LLM headlines only when meaningful transcript input changes, and removing brittle semantic validation failures.

**Architecture:** Keep the Board refresh dropdown as the UI projection polling interval and use it as a bounded catch-up hint for active transcript files. Transcript import becomes the fast data path, headline requests become input-hash driven, and LLM output validation becomes a small structural/safety guard rather than a semantic quality gate.

**Tech Stack:** TypeScript, Node 24 `node:sqlite`, Vitest, Masthead daemon `/projection`, Codex hook transcript import, OpenAI Responses API.

---

## Behavior Contract

- The Board refresh dropdown controls how often the renderer requests `/projection`.
- The daemon should still ingest transcript/token data from hook `transcriptPath` as soon as hook events arrive.
- Each `/projection?refreshIntervalMs=...` request should opportunistically schedule or perform bounded catch-up for visible transcript files if their last catch-up is older than the selected interval.
- `/projection` must stay responsive. Visible transcript catch-up may be awaited only within a small budget; if it cannot finish quickly, it must continue in the existing hook transcript catch-up queue and the current projection should return with the last known data.
- The LLM should run only when the normalized headline evidence key changes.
- The primary headline evidence should be the most recent meaningful user/assistant transcript messages.
- Hook placeholders such as `Codex hook event`, runtime placeholders, generic shell/tool noise, and progress-only assistant chatter must not crowd real transcript text out of the LLM input.
- In configured LLM mode, deterministic offline headlines are allowed only when LLM access is unavailable or enrichment is disabled. If LLM is configured but transcript evidence is not ready yet, preserve the previous ready LLM headline or show a calm pending/waiting state.
- Remove `validation_failed` as a user-visible Board headline state. Keep only structural JSON parsing, allowed enum checks, unsafe-text checks, and non-empty subject/disposition checks.

## Optimizer Rubric And Score

The plan was optimized with this weighted rubric:

- Correctness and root-cause fit, 25 points: fixes transcript availability and headline refresh behavior at the data-flow boundary, not just card copy.
- Latency and load control, 20 points: supports the `5s` Board mode without blocking projection or spamming OpenAI.
- Testability, 20 points: each behavior has a focused failing test before implementation.
- Sequencing and rollback safety, 15 points: tasks are ordered so data capture, input keys, provider behavior, daemon pacing, and UI state can be reviewed independently.
- Scope discipline, 10 points: avoids unrelated UI redesigns and does not change port/dev-server behavior.
- Operational visibility, 10 points: acceptance checks expose transcript readiness, request gating, and status cleanup.

Score trajectory: `82 -> 90 -> 94 -> 94`. The accepted improvements were bounded projection catch-up, safer time/cooldown handling, structural validator hardening, and explicit failure-retry acceptance.

## File Map

- Modify `src/daemon/db/liveTranscriptFactsRepository.ts`
  - Filter low-value message rows before limiting.
  - Overscan recent rows so placeholder hook messages cannot crowd out real transcript text.
- Modify `src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts`
  - Cover placeholder filtering and overscan behavior.
- Create `src/core/boardHeadlineRefreshKey.ts`
  - Own the normalized evidence key and transcript-readiness check.
- Create `src/core/__tests__/boardHeadlineRefreshKey.test.ts`
  - Cover stable keys, transcript-only triggering, and ignored hook/tool noise.
- Modify `src/core/openaiBoardHeadlineFrame.ts`
  - Send recent transcript messages to OpenAI.
  - Remove semantic input-support validation.
  - Return `invalid_output` for malformed or unsafe frames instead of `validation_failed`.
- Modify `src/core/boardHeadlineFrame.ts`
  - Convert the validator into a structural/safety guard.
- Modify `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`
  - Replace `validation_failed` expectations with accepted useful frames or `invalid_output`.
- Modify `src/core/__tests__/boardHeadlineFrame.test.ts`
  - Replace weak-subject/weak-disposition rejection tests with structural/safety tests.
- Modify `src/core/offlineBoardHeadline.ts`
  - Add a waiting-for-transcript pending headline view.
- Modify `src/core/__tests__/offlineBoardHeadline.test.ts`
  - Cover the waiting-for-transcript view.
- Modify `src/core/boardHeadlineEnricher.ts`
  - Use the new refresh key.
  - Preserve previous ready headlines while transcript evidence is missing or request cooldown is active.
  - Accept per-request refresh interval options.
- Modify `src/core/__tests__/boardHeadlineEnricher.test.ts`
  - Cover no-transcript deferral, changed-transcript scheduling, unchanged-transcript no-op, and refresh-interval cooldown.
- Modify `src/daemon/hookTranscriptRecovery.ts`
  - Add a helper for latest hook transcript events scoped to visible source session IDs.
- Modify `src/daemon/__tests__/hookTranscriptRecovery.test.ts`
  - Cover scoped transcript-path recovery.
- Modify `src/daemon/server.ts`
  - Parse `refreshIntervalMs`.
  - Run a budgeted visible transcript catch-up before building transcript facts, then queue unfinished work without blocking projection.
  - Pass refresh interval options into the headline enricher.
- Modify `src/daemon/import/__tests__/progressiveImport.test.ts`
  - Cover projection-driven transcript tailing without a new hook.
- Modify `src/core/types.ts`
  - Remove `validation_failed` from `BoardHeadlineRefreshStatus`.
- Modify UI tests only if type/status snapshots require it.
- Write a concise GBrain closeout after implementation if the implementation succeeds.

---

### Task 1: Make Live Transcript Facts Filter Before Limiting

**Files:**
- Modify: `src/daemon/db/liveTranscriptFactsRepository.ts`
- Test: `src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts`

- [ ] **Step 1: Add failing tests for placeholder crowding**

Append these tests inside the existing `describe("live transcript facts repository", ...)` block:

```ts
  test("filters hook placeholders before applying the per-session message limit", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-transcript-facts-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");

    for (let index = 0; index < 30; index += 1) {
      seedMessage(db, "session-a", "assistant", "Codex hook event", `2026-06-24T12:30:${String(index).padStart(2, "0")}.000Z`);
    }
    seedMessage(db, "session-a", "user", "Use the latest transcript turns for Board headlines.", "2026-06-24T12:01:00.000Z");
    seedMessage(db, "session-a", "assistant", "Board headlines now refresh from transcript evidence.", "2026-06-24T12:02:00.000Z");

    const facts = liveProjectionTranscriptFacts(db, new Set(["source-a"]), { maxMessagesPerSession: 4 });

    expect(facts.get("source-a")?.recentMessages).toEqual([
      {
        observedAt: "2026-06-24T12:02:00.000Z",
        role: "assistant",
        text: "Board headlines now refresh from transcript evidence."
      },
      {
        observedAt: "2026-06-24T12:01:00.000Z",
        role: "user",
        text: "Use the latest transcript turns for Board headlines."
      }
    ]);
    db.close();
  });

  test("drops progress-only assistant messages from live headline facts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-transcript-facts-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");
    seedMessage(db, "session-a", "assistant", "I’m checking the local tests now.", "2026-06-24T12:03:00.000Z");
    seedMessage(db, "session-a", "user", "Headlines should refresh only when transcript messages change.", "2026-06-24T12:02:00.000Z");

    const facts = liveProjectionTranscriptFacts(db, new Set(["source-a"]));

    expect(facts.get("source-a")?.recentMessages).toEqual([
      {
        observedAt: "2026-06-24T12:02:00.000Z",
        role: "user",
        text: "Headlines should refresh only when transcript messages change."
      }
    ]);
    db.close();
  });
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
vitest --run src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts
```

Expected: the new placeholder-crowding test fails because the query limits after ordering raw message rows, and the progress-message test fails because progress chatter is not filtered in the repository.

- [ ] **Step 3: Implement low-value filtering and overscan**

In `src/daemon/db/liveTranscriptFactsRepository.ts`, add these helpers near the bottom:

```ts
function isLowValueLiveTranscriptText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (/^(codex hook event|runtime signal|unknown|shell)$/i.test(normalized)) return true;
  if (/\bI(?:'|’)m\s+(?:checking|running|reading|looking|starting|rerunning|applying|writing|opening|waiting)\b/i.test(normalized)) {
    return true;
  }
  if (/^I\s+(?:am|will|can)\s+/i.test(normalized)) return true;
  return false;
}
```

Change the query loop so it skips low-value rows before pushing to `facts.recentMessages`:

```ts
    const text = row.text?.replace(/\s+/g, " ").trim();
    if (!sourceSessionId || !role || !text || isLowValueLiveTranscriptText(text)) continue;
```

Keep the SQL ordering, but do not add a SQL `LIMIT` unless it is safely above the worst expected placeholder crowding. The existing repository-level loop can scan all scoped visible-session rows because `/projection` passes a small set of visible session IDs.

- [ ] **Step 4: Run transcript facts tests**

Run:

```bash
vitest --run src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/daemon/db/liveTranscriptFactsRepository.ts src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts
git commit -m "fix: filter live transcript facts before headline input"
```

---

### Task 2: Add Transcript-Driven Headline Refresh Keys

**Files:**
- Create: `src/core/boardHeadlineRefreshKey.ts`
- Test: `src/core/__tests__/boardHeadlineRefreshKey.test.ts`

- [ ] **Step 1: Write tests for evidence-key behavior**

Create `src/core/__tests__/boardHeadlineRefreshKey.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { boardHeadlineRefreshKey, hasHeadlineTranscriptEvidence } from "../boardHeadlineRefreshKey";
import type { BoardHeadlineInput } from "../boardHeadlineInput";

function input(overrides: Partial<BoardHeadlineInput> = {}): BoardHeadlineInput {
  return {
    lifecycle: "running",
    primaryStatus: "editing",
    stateHint: "active",
    signals: [],
    subjectCandidates: ["Board headlines"],
    dispositionHints: ["refresh from transcript messages"],
    evidence: ["Board headlines should refresh from transcript messages."],
    facts: {
      sessionId: "session-1",
      project: "Masthead",
      lifecycle: "running",
      primaryStatus: "editing",
      recentTranscriptMessages: ["Board headlines should refresh from transcript messages."],
      recentFileBasenames: ["SessionCard.tsx"],
      changedFileCount: 1,
      recentEvents: [],
      recentToolNames: ["shell"],
      recentCommandFailures: [],
      attentionTitles: [],
      conflictTitles: []
    },
    ...overrides
  };
}

describe("board headline refresh key", () => {
  test("requires meaningful transcript evidence", () => {
    expect(hasHeadlineTranscriptEvidence(input())).toBe(true);
    expect(
      hasHeadlineTranscriptEvidence(
        input({
          facts: {
            ...input().facts,
            recentTranscriptMessages: []
          }
        })
      )
    ).toBe(false);
  });

  test("returns undefined without transcript evidence", () => {
    const key = boardHeadlineRefreshKey("gpt-test", input({ facts: { ...input().facts, recentTranscriptMessages: [] } }));

    expect(key).toBeUndefined();
  });

  test("is stable when only low-value tool evidence changes", () => {
    const first = boardHeadlineRefreshKey("gpt-test", input());
    const second = boardHeadlineRefreshKey(
      "gpt-test",
      input({
        facts: {
          ...input().facts,
          changedFileCount: 9,
          recentToolNames: ["shell", "Read", "Grep"],
          recentEvents: [{ type: "command.finished", summary: "Codex hook event", occurredAt: "2026-07-01T12:00:00.000Z" }]
        }
      })
    );

    expect(second).toBe(first);
  });

  test("changes when meaningful transcript evidence changes", () => {
    const first = boardHeadlineRefreshKey("gpt-test", input());
    const second = boardHeadlineRefreshKey(
      "gpt-test",
      input({
        facts: {
          ...input().facts,
          recentTranscriptMessages: ["Use the last assistant answer as headline evidence."]
        }
      })
    );

    expect(second).not.toBe(first);
  });

  test("includes state and attention changes that affect the headline frame", () => {
    const first = boardHeadlineRefreshKey("gpt-test", input());
    const second = boardHeadlineRefreshKey(
      "gpt-test",
      input({
        stateHint: "blocked",
        signals: ["command_failed"],
        facts: {
          ...input().facts,
          recentCommandFailures: ["npm test failed"]
        }
      })
    );

    expect(second).not.toBe(first);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
vitest --run src/core/__tests__/boardHeadlineRefreshKey.test.ts
```

Expected: FAIL because `src/core/boardHeadlineRefreshKey.ts` does not exist.

- [ ] **Step 3: Implement the refresh-key module**

Create `src/core/boardHeadlineRefreshKey.ts`:

```ts
import type { BoardHeadlineInput } from "./boardHeadlineInput.ts";

export function hasHeadlineTranscriptEvidence(input: BoardHeadlineInput): boolean {
  return meaningfulTranscriptMessages(input).length > 0;
}

export function boardHeadlineRefreshKey(model: string, input: BoardHeadlineInput): string | undefined {
  const transcriptMessages = meaningfulTranscriptMessages(input);
  if (transcriptMessages.length === 0) return undefined;

  return stableStringify({
    model,
    lifecycle: clean(input.lifecycle),
    primaryStatus: clean(input.primaryStatus),
    stateHint: input.stateHint,
    signals: input.signals,
    transcriptMessages,
    recentCommandFailures: cleanList(input.facts.recentCommandFailures, 4),
    attentionTitles: cleanList(input.facts.attentionTitles, 4),
    conflictTitles: cleanList(input.facts.conflictTitles, 4)
  });
}

function meaningfulTranscriptMessages(input: BoardHeadlineInput): string[] {
  return cleanList(input.facts.recentTranscriptMessages ?? [], 8).filter((message) => !isLowValueHeadlineEvidence(message));
}

function cleanList(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLowValueHeadlineEvidence(value: string): boolean {
  const normalized = clean(value);
  return /^(codex hook event|runtime signal|unknown|shell)$/i.test(normalized);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Run refresh-key tests**

Run:

```bash
vitest --run src/core/__tests__/boardHeadlineRefreshKey.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/core/boardHeadlineRefreshKey.ts src/core/__tests__/boardHeadlineRefreshKey.test.ts
git commit -m "feat: add transcript-driven headline refresh keys"
```

---

### Task 3: Send Transcript Messages To OpenAI And Remove Semantic Validation

**Files:**
- Modify: `src/core/openaiBoardHeadlineFrame.ts`
- Modify: `src/core/boardHeadlineFrame.ts`
- Test: `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`
- Test: `src/core/__tests__/boardHeadlineFrame.test.ts`

- [ ] **Step 1: Add provider-payload test for transcript messages**

In `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`, add or adjust the existing payload test so it asserts the OpenAI payload contains `recentTranscriptMessages`:

```ts
  test("sends recent transcript messages as primary headline evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseWithFrame(validFrame()));

    await rewriteBoardHeadlineFrameWithOpenAI(input(), {
      enabled: true,
      apiKey: "key",
      fetchImpl,
      model: "gpt-5-nano-2025-08-07"
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const providerInput = JSON.parse(body.input);

    expect(providerInput.facts.recentTranscriptMessages).toEqual([
      "Use subject and disposition frames for Board headlines."
    ]);
  });
```

- [ ] **Step 2: Replace semantic validation tests**

In `src/core/__tests__/openaiBoardHeadlineFrame.test.ts`, remove tests that expect these `validationReason` values:

```ts
"weak_subject"
"weak_disposition"
"state_mismatch"
"empty_evidence"
"unsupported_evidence"
"unsupported_claim"
```

Replace them with this acceptance test:

```ts
  test("accepts structurally valid frames without semantic support matching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      responseWithFrame({
        subject: "UI changes",
        disposition: "has recent activity",
        state: "completed",
        subjectKind: "component",
        confidence: "low",
        evidence: []
      })
    );

    await expect(
      rewriteBoardHeadlineFrameWithOpenAI(input(), {
        enabled: true,
        apiKey: "key",
        fetchImpl,
        model: "gpt-5-nano-2025-08-07"
      })
    ).resolves.toMatchObject({
      status: "llm",
      frame: {
        subject: "UI changes",
        disposition: "has recent activity",
        state: "completed"
      }
    });
  });
```

Keep tests that expect `invalid_output` for non-JSON, invalid enum values, non-string evidence, unsafe URLs, directives, or secrets.

- [ ] **Step 3: Relax frame validation tests**

In `src/core/__tests__/boardHeadlineFrame.test.ts`, replace weak-subject and weak-disposition rejection tests with:

```ts
  test("allows generic but structurally valid model text", () => {
    expect(validateBoardHeadlineFrame(frame({ subject: "UI changes" })).ok).toBe(true);
    expect(validateBoardHeadlineFrame(frame({ disposition: "has recent activity" })).ok).toBe(true);
  });
```

- [ ] **Step 4: Run failing tests**

Run:

```bash
vitest --run src/core/__tests__/openaiBoardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineFrame.test.ts
```

Expected: FAIL because transcript messages are not present in the provider payload and semantic validation still rejects frames.

- [ ] **Step 5: Update provider payload**

In `src/core/openaiBoardHeadlineFrame.ts`, update the instructions string to make transcript text the primary source:

```ts
"Use facts.recentTranscriptMessages as the primary source when present.",
"Prefer the latest user request and latest assistant substantive update over tool names or hook events.",
"If transcript evidence is thin, keep the frame literal and conservative.",
```

Update `OpenAIProviderPayload`:

```ts
  facts: {
    changedFileCount: number;
    recentFileBasenames: string[];
    recentToolNames: string[];
    recentTranscriptMessages: string[];
  };
```

Update `toOpenAIProviderPayload`:

```ts
    facts: {
      changedFileCount: input.facts.changedFileCount,
      recentFileBasenames: safeStrings(input.facts.recentFileBasenames, 8),
      recentToolNames: safeStrings(input.facts.recentToolNames, 8),
      recentTranscriptMessages: safeStrings(input.facts.recentTranscriptMessages ?? [], 8)
    }
```

- [ ] **Step 6: Remove `validation_failed` status and semantic input matching**

In `src/core/openaiBoardHeadlineFrame.ts`:

```ts
export type OpenAIBoardHeadlineFrameStatus =
  | "llm"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "api_error"
  | "invalid_output";
```

Change the validation failure branch:

```ts
    const validation = validateBoardHeadlineFrame(parsed);
    if (!validation.ok) {
      return {
        failureMessage: "OpenAI board headline frame response was structurally invalid.",
        latencyMs,
        status: "invalid_output",
        validationReason: validation.reason
      };
    }

    return { frame: validation.frame, latencyMs, status: "llm" };
```

Delete `validateFrameAgainstInput`, `isSupportedEvidence`, `hasUnsupportedClaim`, `normalizeForSupport`, `supportTokens`, and `supportStopWords` from `src/core/openaiBoardHeadlineFrame.ts`.

- [ ] **Step 7: Relax structural guard**

In `src/core/boardHeadlineFrame.ts`, remove `bannedHeadlinePhrases`, `bannedSubjects`, `isUsefulSubject`, and `isUsefulDisposition`.

Change `validateBoardHeadlineFrame` to use only structural/safety checks:

```ts
  const subject = cleanSlot(candidate.subject);
  const disposition = cleanSlot(candidate.disposition);
  const evidence = candidate.evidence.map(cleanSlot).filter(Boolean).slice(0, 6);

  if (isUnsafeText(subject) || isUnsafeText(disposition) || evidence.some(isUnsafeText)) {
    return { ok: false, reason: "unsafe_text" };
  }
  if (!subject) return { ok: false, reason: "weak_subject" };
  if (!disposition) return { ok: false, reason: "weak_disposition" };

  const frame: BoardHeadlineFrame = {
    subject: subject.slice(0, 96),
    disposition: disposition.slice(0, 180),
    state: candidate.state as BoardHeadlineState,
    subjectKind: candidate.subjectKind as BoardHeadlineSubjectKind,
    confidence: candidate.confidence as BoardHeadlineConfidence,
    evidence: evidence.map((value) => value.slice(0, 180))
  };
```

Keep the existing `weak_subject` and `weak_disposition` reason names for empty slots only so callers do not need a larger type migration.

- [ ] **Step 8: Update shared status type**

In `src/core/types.ts`, remove `"validation_failed"` from `BoardHeadlineRefreshStatus`.

- [ ] **Step 9: Run frame tests**

Run:

```bash
vitest --run src/core/__tests__/openaiBoardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineFrame.test.ts
```

Expected: all tests pass.

- [ ] **Step 10: Commit checkpoint**

```bash
git add src/core/openaiBoardHeadlineFrame.ts src/core/boardHeadlineFrame.ts src/core/types.ts src/core/__tests__/openaiBoardHeadlineFrame.test.ts src/core/__tests__/boardHeadlineFrame.test.ts
git commit -m "fix: simplify board headline frame validation"
```

---

### Task 4: Gate Headline Requests By Transcript Evidence Changes

**Files:**
- Modify: `src/core/offlineBoardHeadline.ts`
- Modify: `src/core/boardHeadlineEnricher.ts`
- Test: `src/core/__tests__/offlineBoardHeadline.test.ts`
- Test: `src/core/__tests__/boardHeadlineEnricher.test.ts`

- [ ] **Step 1: Test waiting-for-transcript pending headline**

In `src/core/__tests__/offlineBoardHeadline.test.ts`, add:

```ts
  test("builds a waiting-for-transcript pending headline", () => {
    expect(buildWaitingForTranscriptBoardHeadlineView(input())).toEqual({
      headline: "Waiting for transcript...",
      source: "pending",
      status: "pending"
    });
  });
```

- [ ] **Step 2: Implement waiting headline view**

In `src/core/offlineBoardHeadline.ts`, export:

```ts
export function buildWaitingForTranscriptBoardHeadlineView(_input: BoardHeadlineInput): BoardHeadlineView {
  return {
    headline: "Waiting for transcript...",
    source: "pending",
    status: "pending"
  };
}
```

- [ ] **Step 3: Add enricher tests for transcript gating**

In `src/core/__tests__/boardHeadlineEnricher.test.ts`, add:

```ts
  test("does not call OpenAI when configured LLM mode has no transcript evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    const result = await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            facts: {
              ...input().facts,
              recentTranscriptMessages: []
            }
          })
        })
      ])
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.cards[0]?.headline).toMatchObject({
      headline: "Waiting for transcript...",
      source: "pending",
      status: "pending"
    });
  });

  test("does not request a new headline when the transcript refresh key is unchanged", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    await enricher.enrichProjection(projection([card()]));
    response.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
    await enricher.enrichProjection(projection([card()]));
    await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            facts: {
              ...input().facts,
              changedFileCount: 3,
              recentToolNames: ["shell", "Read"]
            }
          })
        })
      ])
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("requests a new headline when transcript evidence changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    await enricher.enrichProjection(projection([card()]));
    first.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
    await enricher.enrichProjection(projection([card()]));

    const result = await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            facts: {
              ...input().facts,
              recentTranscriptMessages: ["Use new transcript evidence for the next headline."]
            }
          })
        })
      ]),
      { refreshIntervalMs: 5_000 }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 1,
      pending: 1
    });

    second.resolve(responseWithFrame(validFrame({ subject: "New transcript evidence" })));
    await flushMicrotasks();
  });
```

- [ ] **Step 4: Add cooldown test**

In the same test file, add:

```ts
  test("uses the Board refresh interval as the active-session request cooldown", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    let nowMs = Date.parse("2026-07-01T12:00:00.000Z");
    const now = vi.fn<() => Date>(() => new Date(nowMs));
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl, now });

    await enricher.enrichProjection(projection([card()]), { refreshIntervalMs: 10_000 });
    first.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
    nowMs = Date.parse("2026-07-01T12:00:01.000Z");
    await enricher.enrichProjection(projection([card()]), { refreshIntervalMs: 10_000 });
    nowMs = Date.parse("2026-07-01T12:00:05.000Z");
    await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            facts: {
              ...input().facts,
              recentTranscriptMessages: ["Changed too soon for another active request."]
            }
          })
        })
      ]),
      { refreshIntervalMs: 10_000 }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    nowMs = Date.parse("2026-07-01T12:00:11.000Z");
    await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            facts: {
              ...input().facts,
              recentTranscriptMessages: ["Changed after the Board refresh interval."]
            }
          })
        })
      ]),
      { refreshIntervalMs: 10_000 }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    second.resolve(responseWithFrame(validFrame({ subject: "Board refresh interval" })));
    await flushMicrotasks();
  });
```

- [ ] **Step 5: Add retry-after-failure coverage**

In the same test file, update or add a provider-failure test so failures do not permanently poison a changed or retryable transcript key:

```ts
  test("retries a failed headline request after the refresh cooldown", async () => {
    const retryResponse = deferred<Response>();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockImplementationOnce(() => retryResponse.promise);
    let nowMs = Date.parse("2026-07-01T12:00:00.000Z");
    const now = vi.fn<() => Date>(() => new Date(nowMs));
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl, now });

    await enricher.enrichProjection(projection([card()]), { refreshIntervalMs: 10_000 });
    await flushMicrotasks();

    nowMs = Date.parse("2026-07-01T12:00:05.000Z");
    await enricher.enrichProjection(projection([card()]), { refreshIntervalMs: 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    nowMs = Date.parse("2026-07-01T12:00:11.000Z");
    const result = await enricher.enrichProjection(projection([card()]), { refreshIntervalMs: 10_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 1,
      failed: 1,
      pending: 1
    });

    retryResponse.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
  });
```

- [ ] **Step 6: Run failing tests**

Run:

```bash
vitest --run src/core/__tests__/offlineBoardHeadline.test.ts src/core/__tests__/boardHeadlineEnricher.test.ts
```

Expected: FAIL because the waiting view, refresh key gating, and `enrichProjection` options are not implemented.

- [ ] **Step 7: Update the enricher interface**

In `src/core/boardHeadlineEnricher.ts`, import:

```ts
import { boardHeadlineRefreshKey } from "./boardHeadlineRefreshKey.ts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView, buildWaitingForTranscriptBoardHeadlineView } from "./offlineBoardHeadline.ts";
```

Change the interface:

```ts
export type BoardHeadlineEnrichProjectionOptions = {
  refreshIntervalMs?: number;
};

export type BoardHeadlineEnricher = {
  enrichProjection(projection: LiveBoardProjection, options?: BoardHeadlineEnrichProjectionOptions): Promise<LiveBoardProjection>;
  status(): { enabled: boolean; configured: boolean; model: string };
};
```

- [ ] **Step 8: Add per-session request pacing**

Inside `createBoardHeadlineEnricher`, add:

```ts
  const lastRequestedAtBySession = new Map<string, number>();
```

Change `enrichProjection` signature:

```ts
  async function enrichProjection(projection: LiveBoardProjection, options: BoardHeadlineEnrichProjectionOptions = {}): Promise<LiveBoardProjection> {
```

Replace `const generatedAt = nowIso(config.now);` with one captured projection timestamp:

```ts
    const projectionNow = config.now?.() ?? new Date();
    const generatedAt = projectionNow.toISOString();
    const nowMs = projectionNow.getTime();
    const requestCooldownMs = effectiveHeadlineRequestCooldownMs(options.refreshIntervalMs);
```

Add helper functions near the bottom:

```ts
function effectiveHeadlineRequestCooldownMs(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 10_000;
  return Math.max(5_000, Math.min(60_000, Number(refreshIntervalMs)));
}

function requestAllowedForSession(lastRequestedAtBySession: Map<string, number>, sessionId: string, nowMs: number, cooldownMs: number): boolean {
  const lastRequestedAt = lastRequestedAtBySession.get(sessionId);
  return lastRequestedAt === undefined || nowMs - lastRequestedAt >= cooldownMs;
}
```

- [ ] **Step 9: Replace cache key behavior**

Replace:

```ts
      const key = cacheKey(model, input);
```

with:

```ts
      const key = boardHeadlineRefreshKey(model, input);
```

Then handle missing keys before cache lookup:

```ts
      if (!key) {
        overlays.set(card.sessionId, retained ?? buildWaitingForTranscriptBoardHeadlineView(input));
        refreshOverlays.set(card.sessionId, {
          provider: "openai",
          model,
          requestedAt: generatedAt,
          status: "pending"
        });
        summary.pending += 1;
        continue;
      }
```

Before scheduling `requestHeadline`, add:

```ts
      const canRequestNow = requestAllowedForSession(lastRequestedAtBySession, card.sessionId, nowMs, requestCooldownMs);
      if (!canRequestNow && !isFinalRefreshCard(card)) {
        continue;
      }
```

When scheduling:

```ts
      if (!inFlight.has(key)) {
        lastRequestedAtBySession.set(card.sessionId, nowMs);
        inFlight.set(key, requestHeadline(input, key, card.sessionId));
        summary.requested += 1;
      }
```

Add:

```ts
function isFinalRefreshCard(card: SessionCardView): boolean {
  return card.lifecycle === "ended";
}
```

Delete the old `cacheKey` function after no callers remain.

- [ ] **Step 10: Run enricher tests**

Run:

```bash
vitest --run src/core/__tests__/boardHeadlineRefreshKey.test.ts src/core/__tests__/offlineBoardHeadline.test.ts src/core/__tests__/boardHeadlineEnricher.test.ts
```

Expected: all tests pass.

- [ ] **Step 11: Commit checkpoint**

```bash
git add src/core/boardHeadlineRefreshKey.ts src/core/offlineBoardHeadline.ts src/core/boardHeadlineEnricher.ts src/core/__tests__/boardHeadlineRefreshKey.test.ts src/core/__tests__/offlineBoardHeadline.test.ts src/core/__tests__/boardHeadlineEnricher.test.ts
git commit -m "feat: refresh board headlines from transcript evidence changes"
```

---

### Task 5: Use Board Refresh Interval For Visible Transcript Catch-Up

**Files:**
- Modify: `src/daemon/hookTranscriptRecovery.ts`
- Modify: `src/daemon/server.ts`
- Test: `src/daemon/__tests__/hookTranscriptRecovery.test.ts`
- Test: `src/daemon/import/__tests__/progressiveImport.test.ts`

- [ ] **Step 1: Test scoped hook transcript recovery**

In `src/daemon/__tests__/hookTranscriptRecovery.test.ts`, update the import:

```ts
import { recentHookEventsWithTranscriptPaths, recentHookEventsWithTranscriptPathsForSessions } from "../hookTranscriptRecovery.ts";
```

Add:

```ts
  test("selects transcript paths for requested source sessions only", async () => {
    const db = await openTestDatabase();
    seedHookRecord(db, {
      eventId: "visible",
      observedAt: "2026-06-25T12:00:00.000Z",
      sourceSessionId: "visible-source",
      transcriptPath: "/home/tyler/.codex/sessions/visible.jsonl"
    });
    seedHookRecord(db, {
      eventId: "hidden",
      observedAt: "2026-06-25T12:01:00.000Z",
      sourceSessionId: "hidden-source",
      transcriptPath: "/home/tyler/.codex/sessions/hidden.jsonl"
    });

    const events = recentHookEventsWithTranscriptPathsForSessions(db, "codex-hook-local", new Set(["visible-source"]), 10);

    expect(events.map((event) => event.sessionId)).toEqual(["visible-source"]);
    db.close();
  });
```

- [ ] **Step 2: Implement scoped hook recovery helper**

In `src/daemon/hookTranscriptRecovery.ts`, export:

```ts
export function recentHookEventsWithTranscriptPathsForSessions(
  db: MastheadDatabase,
  sourceId: string,
  sourceSessionIds: Set<string>,
  limit: number
): NormalizedEvent[] {
  const sessionIds = [...sourceSessionIds].filter(Boolean);
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `WITH candidates AS (
        SELECT
          raw_event_id AS rawEventId,
          observed_at AS observedAt,
          payload_json AS payloadJson,
          COALESCE(
            json_extract(payload_json, '$.value.sessionId'),
            json_extract(payload_json, '$.value.sourceSessionId'),
            json_extract(payload_json, '$.sessionId'),
            json_extract(payload_json, '$.sourceSessionId')
          ) AS sourceSessionId,
          COALESCE(
            json_extract(payload_json, '$.value.payload.transcriptPath'),
            json_extract(payload_json, '$.value.payload.transcript_path'),
            json_extract(payload_json, '$.payload.transcriptPath'),
            json_extract(payload_json, '$.payload.transcript_path')
          ) AS transcriptPath
        FROM raw_events
        WHERE source_id = ?
          AND source_kind = 'hook'
          AND json_valid(payload_json)
          AND (payload_json LIKE '%"transcriptPath"%' OR payload_json LIKE '%"transcript_path"%')
      ),
      ranked AS (
        SELECT
          rawEventId,
          observedAt,
          payloadJson,
          ROW_NUMBER() OVER (
            PARTITION BY sourceSessionId, transcriptPath
            ORDER BY observedAt DESC, rawEventId DESC
          ) AS rowRank
        FROM candidates
        WHERE sourceSessionId IN (${placeholders})
          AND transcriptPath IS NOT NULL
      )
      SELECT payloadJson
      FROM ranked
      WHERE rowRank = 1
      ORDER BY observedAt DESC, rawEventId DESC
      LIMIT ?`
    )
    .all(sourceId, ...sessionIds, Math.max(1, limit)) as HookTranscriptRow[];

  return rows
    .map((row) => parseNormalizedHookEvent(row.payloadJson))
    .filter((event): event is NormalizedEvent => Boolean(event));
}
```

- [ ] **Step 3: Add projection catch-up test**

In `src/daemon/import/__tests__/progressiveImport.test.ts`, add a test near the existing hook transcript tailing tests:

```ts
  test("projection refresh tails visible hook transcript paths without a new hook event", async () => {
    const { daemon, codexRoot } = await createTestHarness();
    const transcriptPath = join(codexRoot, "sessions", "2026", "06", "25", "projection-tail-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "projection-tail-session",
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
          content: [{ type: "input_text", text: "Start from the transcript tail." }]
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/codex/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      provider_event_id: "projection-tail-start",
      session_id: "projection-tail-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      title: "Projection tail session",
      transcriptPath
    });
    const sessionId = sessionIdFor(daemon.database, "projection-tail-session");
    await waitFor(() => countWhere(daemon.database, "messages", "session_id = ? AND role = 'user'", sessionId) === 1);

    const original = await readFile(transcriptPath, "utf8");
    await writeFile(
      transcriptPath,
      `${original}${JSON.stringify({
        type: "response_item",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Projection polling imported this transcript update." }]
        }
      })}\n`,
      "utf8"
    );

    await getJson(baseUrl, "/projection?refreshIntervalMs=5000");

    await waitFor(() => countWhere(daemon.database, "messages", "session_id = ? AND role = 'assistant'", sessionId) === 1);
  });
```

- [ ] **Step 4: Run failing daemon tests**

Run:

```bash
vitest --run src/daemon/__tests__/hookTranscriptRecovery.test.ts src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected: FAIL because scoped recovery and projection catch-up do not exist.

- [ ] **Step 5: Parse projection refresh interval**

In `src/daemon/server.ts`, add helper functions near other local helpers:

```ts
function parseBoardRefreshIntervalMs(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10_000;
  return Math.max(5_000, Math.min(60_000, Math.trunc(parsed)));
}

function visibleTranscriptCatchupIntervalMs(refreshIntervalMs: number): number {
  return Math.max(5_000, Math.min(60_000, refreshIntervalMs));
}
```

- [ ] **Step 6: Add visible transcript catch-up state**

Inside `createServer`, near `hookTranscriptCatchups`, add:

```ts
  const visibleTranscriptCatchupLastRunBySession = new Map<string, number>();
```

Import the scoped helper:

```ts
import { recentHookEventsWithTranscriptPaths, recentHookEventsWithTranscriptPathsForSessions } from "./hookTranscriptRecovery.ts";
```

Near the other hook transcript constants, add:

```ts
const VISIBLE_TRANSCRIPT_CATCHUP_BUDGET_MS = 750;
```

Change `scheduleHookTranscriptCatchup` to return its scheduled promise so projection catch-up can wait briefly without duplicating import logic:

```ts
  function scheduleHookTranscriptCatchup(event: NormalizedEvent): Promise<void> | undefined {
    const transcriptPath = stringFromPayload(event.payload, ["transcriptPath", "transcript_path"]);
    const key = transcriptPath ?? event.eventId;
    if (!config.hookTranscriptCatchupEnabled) {
      if (transcriptPath && !disabledHookTranscriptCatchupDiagnostics.has(key)) {
        disabledHookTranscriptCatchupDiagnostics.add(key);
        if (disabledHookTranscriptCatchupDiagnostics.size > 100) disabledHookTranscriptCatchupDiagnostics.clear();
        recordRuntimeDiagnostic({
          details: {
            eventId: event.eventId,
            sourceSessionId: event.sessionId,
            transcriptPath
          },
          kind: "hook_transcript_catchup_disabled",
          message: "Codex hook included a transcriptPath, but hook transcript catch-up is disabled.",
          severity: "warning"
        });
      }
      return undefined;
    }

    const previousForKey = hookTranscriptCatchups.get(key) ?? Promise.resolve();
    const next = hookTranscriptCatchupQueue
      .catch(() => undefined)
      .then(() => previousForKey.catch(() => undefined))
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
    hookTranscriptCatchupQueue = next.catch(() => undefined);
    next.catch(() => {
      // importHookTranscriptIfApproved records diagnostics; this prevents unhandled rejections.
    });
    return next;
  }
```

Add this function near `scheduleRecentHookTranscriptCatchups`:

```ts
  async function catchUpVisibleHookTranscripts(sourceSessionIds: Set<string>, refreshIntervalMs: number): Promise<void> {
    if (!config.hookTranscriptCatchupEnabled || !transcriptImportApproved(database)) return;
    const nowMs = Date.now();
    const dueSessionIds = new Set<string>();
    const intervalMs = visibleTranscriptCatchupIntervalMs(refreshIntervalMs);

    for (const sourceSessionId of sourceSessionIds) {
      const lastRunAt = visibleTranscriptCatchupLastRunBySession.get(sourceSessionId);
      if (lastRunAt === undefined || nowMs - lastRunAt >= intervalMs) {
        visibleTranscriptCatchupLastRunBySession.set(sourceSessionId, nowMs);
        dueSessionIds.add(sourceSessionId);
      }
    }

    if (dueSessionIds.size === 0) return;

    const events = recentHookEventsWithTranscriptPathsForSessions(
      database,
      codexHookSource.sourceId,
      dueSessionIds,
      Math.max(1, Math.min(25, dueSessionIds.size))
    );

    const scheduled = events.map(scheduleHookTranscriptCatchup).filter((task): task is Promise<void> => Boolean(task));
    if (scheduled.length === 0) return;

    await Promise.race([
      Promise.allSettled(scheduled),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, VISIBLE_TRANSCRIPT_CATCHUP_BUDGET_MS);
        timer.unref?.();
      })
    ]);
  }
```

- [ ] **Step 7: Use catch-up in `/projection`**

In the `/projection` route, before `liveProjectionTranscriptFacts`, parse and use the interval:

```ts
      const refreshIntervalMs = parseBoardRefreshIntervalMs(url.searchParams.get("refreshIntervalMs"));
      await catchUpVisibleHookTranscripts(projectionSessionIds, refreshIntervalMs);
```

Then pass it into the enricher:

```ts
      liveEnvelope.projection = await boardHeadlineEnricher.enrichProjection(liveEnvelope.projection, { refreshIntervalMs });
```

- [ ] **Step 8: Run daemon tests**

Run:

```bash
vitest --run src/daemon/__tests__/hookTranscriptRecovery.test.ts src/daemon/import/__tests__/progressiveImport.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Commit checkpoint**

```bash
git add src/daemon/hookTranscriptRecovery.ts src/daemon/server.ts src/daemon/__tests__/hookTranscriptRecovery.test.ts src/daemon/import/__tests__/progressiveImport.test.ts
git commit -m "feat: catch up visible transcripts from board refresh"
```

---

### Task 6: Remove Validation-Failed Status From Board Headline Surface

**Files:**
- Modify: `src/core/boardHeadlineEnricher.ts`
- Modify: `src/core/types.ts`
- Test: `src/core/__tests__/boardHeadlineEnricher.test.ts`
- Test: `src/ui/__tests__/observabilitySessionCard.test.tsx`

- [ ] **Step 1: Remove validation status mapping**

In `src/core/boardHeadlineEnricher.ts`, update `refreshStatusFromOpenAI` to remove the `validation_failed` branch:

```ts
function refreshStatusFromOpenAI(status: OpenAIBoardHeadlineFrameResult["status"]): BoardHeadlineRefreshState["status"] {
  switch (status) {
    case "timeout":
      return "timeout";
    case "invalid_output":
      return "invalid_output";
    case "not_configured":
      return "not_configured";
    case "api_error":
    case "disabled":
    case "llm":
      return "api_error";
  }
}
```

- [ ] **Step 2: Search and remove old status usage**

Run:

```bash
rg -n "validation_failed|AI headline failed|headline failed" src
```

Expected after edits: no product-code references to `validation_failed`; no rendered card copy saying `AI headline failed`.

- [ ] **Step 3: Update card tests if needed**

If `src/ui/__tests__/observabilitySessionCard.test.tsx` has any snapshots or assertions for `validation_failed`, replace them with `invalid_output` or remove them if the card does not render refresh failures.

- [ ] **Step 4: Run headline and UI tests**

Run:

```bash
vitest --run src/core/__tests__/boardHeadlineEnricher.test.ts src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/core/boardHeadlineEnricher.ts src/core/types.ts src/core/__tests__/boardHeadlineEnricher.test.ts src/ui/__tests__/observabilitySessionCard.test.tsx
git commit -m "fix: remove validation failed board headline state"
```

---

### Task 7: Integration Verification And Product Acceptance

**Files:**
- No required product-code edits.
- Optional closeout: GBrain page under `sessions/YYYY/MM/`.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
vitest --run \
  src/daemon/db/__tests__/liveTranscriptFactsRepository.test.ts \
  src/daemon/__tests__/hookTranscriptRecovery.test.ts \
  src/daemon/import/__tests__/progressiveImport.test.ts \
  src/core/__tests__/boardHeadlineRefreshKey.test.ts \
  src/core/__tests__/boardHeadlineFacts.test.ts \
  src/core/__tests__/boardHeadlineInput.test.ts \
  src/core/__tests__/boardHeadlineFrame.test.ts \
  src/core/__tests__/openaiBoardHeadlineFrame.test.ts \
  src/core/__tests__/boardHeadlineEnricher.test.ts \
  src/core/__tests__/liveProjection.test.ts \
  src/core/__tests__/projection.test.ts \
  src/core/__tests__/ingestServer.test.ts \
  src/ui/__tests__/observabilitySessionCard.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run static checks**

Run:

```bash
npm run typecheck
npm run check:surface-contract
npm run verify:no-citations
```

Expected: all checks pass.

- [ ] **Step 3: Optional live verification without stealing Electron port**

If live verification is needed, do not start a browser-only Vite UI on port `5173`. Use the project launcher:

```bash
npm run dev
```

Expected: the launcher chooses a safe port or a bridge when a primary connector already exists. Verify the rendered Board, not only process output.

Acceptance checks:

- Active sessions with hook `transcriptPath` show transcript/token updates after Board polling.
- Cards do not get stuck indefinitely on `Generating headline...` when no LLM request is in flight.
- LLM headline requests happen when `recentTranscriptMessages` changes.
- LLM headline requests do not happen when only hook/tool placeholder data changes.
- The `5s` dropdown produces fast UI updates without repeated OpenAI calls for unchanged transcript evidence.
- The `10s` dropdown remains the default balanced mode.
- The `30s` and `1m` dropdown values reduce visible refresh frequency but do not prevent hook-driven transcript import.
- No card renders `AI headline failed` or `validation_failed`.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Write GBrain closeout**

Write a concise closeout recording the durable decision:

```text
Board headlines are now transcript-driven. The Board refresh dropdown controls projection polling and visible transcript catch-up cadence, while OpenAI headline requests are gated by normalized transcript evidence changes. Semantic headline validation was removed in favor of structural and unsafe-text guards.
```

Use slug:

```text
sessions/2026/07/transcript-driven-board-headlines
```

- [ ] **Step 6: Final commit**

```bash
git status --short
git add docs/superpowers/plans/2026-07-02-transcript-driven-board-headlines.md
git commit -m "docs: plan transcript driven board headlines"
```

If implementation edits are already committed task-by-task, this final commit should include only the plan and any closeout metadata that belongs in git. GBrain closeouts are not git artifacts in this repository.

---

## Self-Review

- Spec coverage: The plan covers transcript capture/catch-up, Board refresh interval semantics, transcript evidence extraction, LLM input hashing, provider payload, validator removal, UI status cleanup, and verification.
- Placeholder scan: The plan has concrete file paths, test snippets, implementation snippets, commands, and expected results.
- Type consistency: New names are `boardHeadlineRefreshKey`, `hasHeadlineTranscriptEvidence`, `buildWaitingForTranscriptBoardHeadlineView`, `recentHookEventsWithTranscriptPathsForSessions`, and `BoardHeadlineEnrichProjectionOptions`. The same names are used in tests and implementation steps.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-07-02-transcript-driven-board-headlines.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
