import { describe, expect, test, vi } from "vitest";
import { createBoardHeadlineEnricher } from "../boardHeadlineEnricher";
import type { BoardHeadlineFrame, BoardHeadlineView } from "../boardHeadlineFrame";
import type { BoardHeadlineInput } from "../boardHeadlineInput";
import type { LiveBoardProjection, SessionCardView } from "../types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function input(overrides: Partial<BoardHeadlineInput> = {}): BoardHeadlineInput {
  return {
    lifecycle: "running",
    primaryStatus: "editing",
    stateHint: "active",
    signals: [],
    subjectCandidates: ["Board headlines"],
    dispositionHints: ["structured around subject and disposition"],
    evidence: ["Use subject and disposition frames for Board headlines."],
    facts: {
      sessionId: "session-1",
      project: "Masthead",
      lifecycle: "running",
      primaryStatus: "editing",
      recentTranscriptMessages: ["Use subject and disposition frames for Board headlines."],
      recentFileBasenames: ["SessionCard.tsx"],
      changedFileCount: 1,
      recentEvents: [],
      recentToolNames: [],
      recentCommandFailures: [],
      attentionTitles: [],
      conflictTitles: []
    },
    ...overrides
  };
}

function pendingHeadline(): BoardHeadlineView {
  return {
    headline: "Generating headline...",
    source: "pending",
    status: "pending"
  };
}

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Board headline frame rebuild",
    headline: pendingHeadline(),
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 1,
    durationLabel: "1m",
    lastActivity: "2026-07-01T12:00:00.000Z",
    lastActivityLabel: "now",
    changedFileCount: 1,
    indicators: [],
    identityConfidence: "direct",
    safeActions: [],
    isExpanded: false,
    headlineInput: input(),
    ...overrides
  };
}

function projection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: {
      active: cards.length,
      needsAttention: 0,
      conflicts: 0,
      completed: 0
    },
    cards,
    attentionQueue: [],
    conflicts: []
  };
}

function validFrame(overrides: Partial<BoardHeadlineFrame> = {}): BoardHeadlineFrame {
  return {
    subject: "Board headlines",
    disposition: "structured around subject and disposition",
    state: "active",
    subjectKind: "component",
    confidence: "high",
    evidence: ["Use subject and disposition frames for Board headlines."],
    ...overrides
  };
}

function responseWithFrame(frame: BoardHeadlineFrame): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(frame) }]
        }
      ]
    }),
    { status: 200 }
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("board headline enricher", () => {
  test("LLM mode returns immediately without offline fallback while a frame is in flight", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    const result = await enricher.enrichProjection(projection([card()]));

    expect(result.cards[0]?.headline).toEqual({
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
    expect(result.cards[0]?.headline.headline).not.toBe("Board headlines: waiting for LLM headline access.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 1,
      succeeded: 0,
      failed: 0,
      pending: 1
    });

    response.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
  });

  test("applies completed LLM frame on a later projection", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    await enricher.enrichProjection(projection([card()]));
    response.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();

    const result = await enricher.enrichProjection(projection([card()]));

    expect(result.cards[0]?.headline).toMatchObject({
      headline: "Board headlines: structured around subject and disposition.",
      source: "llm",
      status: "ready",
      model: "gpt-5-nano-2025-08-07",
      provider: "openai"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 1,
      succeeded: 1,
      failed: 0,
      pending: 0
    });
  });

  test("uses offline headline only when live headline copy is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: false, fetchImpl });

    const result = await enricher.enrichProjection(projection([card()]));

    expect(result.cards[0]?.headline).toMatchObject({
      headline: "Board headlines: waiting for LLM headline access.",
      source: "offline",
      status: "ready"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("uses offline headline when LLM mode is enabled but missing an API key", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, fetchImpl });

    const result = await enricher.enrichProjection(projection([card()]));

    expect(result.cards[0]?.headline.source).toBe("offline");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("does not schedule non-active running cards in LLM mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const waitingInput = input({
      primaryStatus: "waiting_for_user",
      stateHint: "waiting",
      signals: ["user_reply_waiting"]
    });

    const result = await enricher.enrichProjection(
      projection([
        card({
          primaryStatus: "waiting_for_user",
          headlineInput: waitingInput
        })
      ])
    );

    expect(result.cards[0]?.headline).toEqual(pendingHeadline());
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 0,
      succeeded: 0,
      failed: 0,
      pending: 0
    });
  });
});
