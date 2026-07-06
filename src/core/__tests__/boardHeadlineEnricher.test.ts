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

function responseWithChatFrame(frame: BoardHeadlineFrame): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(frame)
          }
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
    expect(result.cards[0]?.headlineRefresh).toMatchObject({
      provider: "openai",
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
    expect(result.cards[0]?.headlineRefresh).toMatchObject({
      model: "gpt-5-nano-2025-08-07",
      provider: "openai",
      status: "success"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 0,
      succeeded: 1,
      failed: 0,
      pending: 0
    });
  });

  test("reports compatible provider identity in status, refresh state, and generation events", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const onFrameApplied = vi.fn();
    const onGenerationFinished = vi.fn();
    const now = vi.fn(() => new Date("2026-07-01T12:34:56.000Z"));
    const config = {
      enabled: true,
      apiKey: "compatible-key",
      apiKeyRequired: true,
      apiStyle: "chat_completions" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      fetchImpl,
      model: "llama-3.1",
      now,
      onFrameApplied,
      onGenerationFinished,
      provider: "openai_compatible"
    };
    const enricher = createBoardHeadlineEnricher(config);

    expect(enricher.status()).toMatchObject({
      configured: true,
      enabled: true,
      model: "llama-3.1",
      provider: "openai_compatible"
    });

    const pending = await enricher.enrichProjection(projection([card()]));

    expect(pending.cards[0]?.headlineRefresh).toMatchObject({
      model: "llama-3.1",
      provider: "openai_compatible",
      status: "pending"
    });
    expect(pending.cards[0]?.headlineRefresh?.provider).not.toBe("openai");

    const frame = validFrame({ subject: "Compatible headlines" });
    response.resolve(responseWithChatFrame(frame));
    await flushMicrotasks();

    expect(onGenerationFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "llama-3.1",
        provider: "openai_compatible",
        sessionId: "session-1",
        status: "success"
      })
    );
    expect(onFrameApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        headline: expect.objectContaining({
          model: "llama-3.1",
          provider: "openai_compatible"
        }),
        model: "llama-3.1",
        provider: "openai_compatible",
        sessionId: "session-1"
      })
    );

    const completed = await enricher.enrichProjection(projection([card()]));
    expect(completed.cards[0]?.headline).toMatchObject({
      headline: "Compatible headlines: structured around subject and disposition.",
      model: "llama-3.1",
      provider: "openai_compatible",
      source: "llm",
      status: "ready"
    });
    expect(completed.cards[0]?.headlineRefresh).toMatchObject({
      model: "llama-3.1",
      provider: "openai_compatible",
      status: "success"
    });
  });

  test("preserves card lifecycle and primary status while overlaying remote headline state", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const sourceCard = card({
      lifecycle: "running",
      primaryStatus: "waiting_for_user",
      stateLabel: "Needs input",
      headlineInput: input({
        primaryStatus: "waiting_for_user",
        stateHint: "waiting",
        signals: ["user_reply_waiting"],
        facts: {
          ...input().facts,
          primaryStatus: "waiting_for_user"
        }
      })
    });

    const pending = await enricher.enrichProjection(projection([sourceCard]));

    expect(pending.cards[0]).toMatchObject({
      lifecycle: "running",
      primaryStatus: "waiting_for_user"
    });

    response.resolve(responseWithFrame(validFrame({ disposition: "claims active work from model output", state: "active" })));
    await flushMicrotasks();
    const completed = await enricher.enrichProjection(projection([sourceCard]));

    expect(completed.cards[0]).toMatchObject({
      lifecycle: "running",
      primaryStatus: "waiting_for_user"
    });
    expect(completed.cards[0]?.headline).toMatchObject({
      headline: "Board headlines: claims active work from model output.",
      source: "llm",
      status: "ready"
    });
  });

  test("calls onFrameApplied when a background LLM frame completes", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const onFrameApplied = vi.fn();
    const now = vi.fn(() => new Date("2026-07-01T12:34:56.000Z"));
    const frame = validFrame();
    const enricher = createBoardHeadlineEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      model: "gpt-test",
      now,
      onFrameApplied
    });

    await enricher.enrichProjection(projection([card()]));
    response.resolve(responseWithFrame(frame));
    await flushMicrotasks();

    expect(onFrameApplied).toHaveBeenCalledTimes(1);
    expect(onFrameApplied).toHaveBeenCalledWith({
      sessionId: "session-1",
      frame,
      headline: {
        headline: "Board headlines: structured around subject and disposition.",
        frame,
        source: "llm",
        status: "ready",
        generatedAt: "2026-07-01T12:34:56.000Z",
        model: "gpt-test",
        provider: "openai"
      },
      provider: "openai",
      model: "gpt-test",
      generatedAt: "2026-07-01T12:34:56.000Z"
    });
  });

  test("does not call onFrameApplied when the provider returns an invalid frame", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const onFrameApplied = vi.fn();
    const enricher = createBoardHeadlineEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      onFrameApplied
    });

    await enricher.enrichProjection(projection([card()]));
    response.resolve(responseWithFrame({ ...validFrame(), confidence: "certain" } as unknown as BoardHeadlineFrame));
    await flushMicrotasks();

    expect(onFrameApplied).not.toHaveBeenCalled();
  });

  test("reports failed provider attempts for durable generation logging", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 500 }));
    const onGenerationFinished = vi.fn();
    const now = vi.fn(() => new Date("2026-07-01T12:34:56.000Z"));
    const headlineInput = input();
    const enricher = createBoardHeadlineEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      model: "gpt-test",
      now,
      onGenerationFinished
    });

    await enricher.enrichProjection(projection([card({ headlineInput })]));
    await flushMicrotasks();

    expect(onGenerationFinished).toHaveBeenCalledTimes(1);
    expect(onGenerationFinished).toHaveBeenCalledWith(
      expect.objectContaining({
        completedAt: "2026-07-01T12:34:56.000Z",
        failureMessage: "OpenAI board headline frame request failed with HTTP 500.",
        input: headlineInput,
        model: "gpt-test",
        provider: "openai",
        requestedAt: "2026-07-01T12:34:56.000Z",
        sessionId: "session-1",
        status: "api_error"
      })
    );
    expect(onGenerationFinished.mock.calls[0]?.[0].refreshKey).toEqual(expect.any(String));
  });

  test("calls onFrameApplied for each card sharing an in-flight frame request", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const onFrameApplied = vi.fn();
    const frame = validFrame();
    const enricher = createBoardHeadlineEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      onFrameApplied
    });

    await enricher.enrichProjection(projection([card({ sessionId: "session-1" }), card({ sessionId: "session-2" })]));
    response.resolve(responseWithFrame(frame));
    await flushMicrotasks();

    expect(onFrameApplied).toHaveBeenCalledTimes(2);
    expect(onFrameApplied).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionId: "session-1", frame }));
    expect(onFrameApplied).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionId: "session-2", frame }));
  });

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

  test("does not call OpenAI when transcript excerpt contains only hook placeholders", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    const result = await enricher.enrichProjection(
      projection([
        card({
          headlineInput: input({
            subjectCandidates: ["Settings UI", "SettingsPanel.tsx"],
            evidence: ["SettingsPanel.tsx", "Codex hook event"],
            facts: {
              ...input().facts,
              transcriptExcerpt: [
                {
                  observedAt: "2026-07-01T12:00:00.000Z",
                  role: "assistant",
                  text: "Codex hook event"
                }
              ],
              recentTranscriptMessages: ["Codex hook event"],
              recentFileBasenames: ["SettingsPanel.tsx"]
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

  test("does not leave ended cards waiting for transcript evidence", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    const result = await enricher.enrichProjection(
      projection([
        card({
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          headlineInput: input({
            lifecycle: "ended",
            primaryStatus: "completed_unreviewed",
            stateHint: "completed",
            facts: {
              ...input().facts,
              lifecycle: "ended",
              primaryStatus: "completed_unreviewed",
              recentTranscriptMessages: []
            }
          })
        })
      ])
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.cards[0]?.headline).toMatchObject({
      source: "offline",
      status: "ready"
    });
    expect(result.cards[0]?.headline.headline).not.toBe("Waiting for transcript...");
    expect(result.cards[0]?.headlineRefresh).toBeUndefined();
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 0,
      pending: 0
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

  test("does not request a replacement headline for ended cards that already have LLM copy", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const readyHeadline: BoardHeadlineView = {
      headline: "Board headlines: structured around subject and disposition.",
      frame: validFrame(),
      source: "llm",
      status: "ready",
      generatedAt: "2026-07-01T12:00:00.000Z",
      model: "gpt-5-nano-2025-08-07",
      provider: "openai"
    };
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });

    const result = await enricher.enrichProjection(
      projection([
        card({
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          headline: readyHeadline,
          headlineInput: input({
            lifecycle: "ended",
            primaryStatus: "completed_unreviewed",
            stateHint: "completed",
            facts: {
              ...input().facts,
              lifecycle: "ended",
              primaryStatus: "completed_unreviewed",
              recentTranscriptMessages: ["A later projection has terminal session details."]
            }
          })
        })
      ])
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.cards[0]?.headline).toBe(readyHeadline);
    expect(result.cards[0]?.headlineRefresh).toBeUndefined();
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 0,
      pending: 0
    });
  });

  test("requests an initial headline for ended cards with transcript while keeping stable copy visible", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const endedCard = card({
      lifecycle: "ended",
      primaryStatus: "completed_unreviewed",
      headlineInput: input({
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        stateHint: "completed",
        facts: {
          ...input().facts,
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          recentTranscriptMessages: ["The portfolio deployment was restored from the known-good artifact."]
        }
      })
    });

    const first = await enricher.enrichProjection(projection([endedCard]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.cards[0]?.headline).toMatchObject({
      source: "offline",
      status: "ready"
    });
    expect(first.cards[0]?.headline.headline).not.toBe("Generating headline...");
    expect(first.cards[0]?.headlineRefresh).toBeUndefined();

    response.resolve(responseWithFrame(validFrame({ disposition: "restored from the known-good artifact", state: "completed" })));
    await flushMicrotasks();

    const second = await enricher.enrichProjection(projection([endedCard]));

    expect(second.cards[0]?.headline).toMatchObject({
      headline: "Board headlines: restored from the known-good artifact.",
      source: "llm",
      status: "ready"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("requests a new headline when transcript evidence changes", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    let nowMs = Date.parse("2026-07-01T12:00:00.000Z");
    const now = vi.fn<() => Date>(() => new Date(nowMs));
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl, now });

    await enricher.enrichProjection(projection([card()]));
    first.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();
    nowMs = Date.parse("2026-07-01T12:00:05.000Z");
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

  test("counts requested only for newly scheduled provider requests", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const enricher = createBoardHeadlineEnricher({ enabled: true, apiKey: "key", fetchImpl });
    const firstCard = card();
    const duplicateCard = card({ sessionId: "session-2" });

    const inFlightResult = await enricher.enrichProjection(projection([firstCard, duplicateCard]));
    const duplicateInFlightResult = await enricher.enrichProjection(projection([firstCard, duplicateCard]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inFlightResult.headlineRefreshSummary).toMatchObject({
      requested: 1,
      succeeded: 0,
      failed: 0,
      pending: 2
    });
    expect(duplicateInFlightResult.headlineRefreshSummary).toMatchObject({
      requested: 0,
      succeeded: 0,
      failed: 0,
      pending: 2
    });

    response.resolve(responseWithFrame(validFrame()));
    await flushMicrotasks();

    const cachedResult = await enricher.enrichProjection(projection([firstCard, duplicateCard]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cachedResult.headlineRefreshSummary).toMatchObject({
      requested: 0,
      succeeded: 2,
      failed: 0,
      pending: 0
    });
    expect(cachedResult.cards.map((card) => card.headlineRefresh?.status)).toEqual(["success", "success"]);
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

  test("preserves an existing ready LLM headline when live headline copy is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: false, fetchImpl });
    const readyHeadline: BoardHeadlineView = {
      headline: "Board headlines: structured around subject and disposition.",
      frame: validFrame(),
      source: "llm",
      status: "ready",
      generatedAt: "2026-07-01T12:00:00.000Z",
      model: "gpt-5-nano-2025-08-07",
      provider: "openai"
    };

    const result = await enricher.enrichProjection(projection([card({ headline: readyHeadline })]));

    expect(result.cards[0]?.headline).toBe(readyHeadline);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("uses offline headline when LLM mode is enabled but missing an API key", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const enricher = createBoardHeadlineEnricher({ enabled: true, fetchImpl });

    const result = await enricher.enrichProjection(projection([card()]));

    expect(result.cards[0]?.headline.source).toBe("offline");
    expect(result.cards[0]?.headlineRefresh).toMatchObject({
      provider: "openai",
      status: "not_configured"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("schedules non-active running cards in LLM mode", async () => {
    const response = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.headlineRefreshSummary).toMatchObject({
      requested: 1,
      succeeded: 0,
      failed: 0,
      pending: 1
    });

    response.resolve(responseWithFrame(validFrame({ state: "waiting" })));
    await flushMicrotasks();
  });
});
