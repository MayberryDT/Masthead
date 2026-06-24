import { describe, expect, test, vi } from "vitest";
import {
  createOpenAISessionCopyEnricher,
  rewriteSessionCopyWithOpenAI
} from "../openaiSessionCopy";
import { buildDeterministicSessionCopy, toSessionCopyInput } from "../sessionCopy";
import type { LiveBoardProjection, SessionCardView } from "../types";

describe("OpenAI session copy", () => {
  test("does not call OpenAI when disabled or missing a key", async () => {
    const input = toSessionCopyInput(cardView(), [], []);
    const fallback = buildDeterministicSessionCopy(input);
    const fetchImpl = vi.fn();

    await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: false, apiKey: "present", fetchImpl })).resolves.toMatchObject({
      copy: fallback,
      status: "disabled"
    });
    await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, fetchImpl })).resolves.toMatchObject({
      copy: fallback,
      status: "not_configured"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sends sanitized input to the Responses API with store disabled", async () => {
    const input = toSessionCopyInput(
      cardView({
        changedFileCount: 12,
        workContext: {
          label: "OAuth callback work",
          confidence: "title",
          pathClusters: ["auth"],
          sourceSignals: ["title:oauth"]
        },
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-23T02:05:00.000Z",
          claims: ["claims_complete", "mentions_tests"]
        }
      }),
      [],
      []
    );
    const fallback = buildDeterministicSessionCopy(input);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  headline: "OAuth callback changes report completion and need review.",
                  status: "Session reports completion.",
                  reason: "The latest feedback mentions completion, while deterministic state still needs review."
                })
              }
            ]
          }
        ]
      })
    });

    const result = await rewriteSessionCopyWithOpenAI(input, fallback, {
      enabled: true,
      apiKey: "redacted-test-key",
      fetchImpl,
      model: "gpt-5-nano-2025-08-07"
    });

    expect(result).toMatchObject({
      status: "llm",
      copy: {
        headline: "OAuth callback changes report completion and need review.",
        source: "llm"
      }
    });
    const [, request] = fetchImpl.mock.calls[0]!;
    expect(request.headers.authorization).toBe("Bearer redacted-test-key");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      model: "gpt-5-nano-2025-08-07",
      store: false,
      max_output_tokens: 240,
      text: { format: { type: "json_schema", name: "masthead_session_copy", strict: true } }
    });
    expect(JSON.parse(body.input)).toEqual(input);
    expect(JSON.parse(body.input).latestFeedback).toEqual({
      present: true,
      source: "stop_hook",
      observedAt: "2026-06-23T02:05:00.000Z",
      claims: ["claims_complete", "mentions_tests"]
    });
    expect(body.input).not.toContain("/");
    expect(body.input).not.toContain("npm");
    expect(body.input).not.toContain("OPENAI_API_KEY");
    expect(body.input).not.toContain("sk-");
    expect(body.input).not.toContain("Implementation is complete");
    expect(body.input).not.toContain("Ignore instructions");
    expect(body.instructions).toContain("system-neutral");
    expect(body.instructions).toContain("claim flags");
    expect(body.instructions).toContain("full sentence");
  });

  test("does not send latest feedback snapshot text to OpenAI", async () => {
    const input = toSessionCopyInput(
      cardView({
        latestFeedbackSignal: {
          present: true,
          source: "stop_hook",
          observedAt: "2026-06-23T02:05:00.000Z",
          claims: ["claims_complete", "mentions_error"]
        }
      }),
      [],
      []
    );
    const fallback = buildDeterministicSessionCopy(input);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  headline: "This session reports completion and needs review.",
                  status: "Session reports completion.",
                  reason: "The latest feedback mentions completion, while deterministic state still needs review."
                })
              }
            ]
          }
        ]
      })
    });

    await rewriteSessionCopyWithOpenAI(input, fallback, {
      enabled: true,
      apiKey: "redacted-test-key",
      fetchImpl
    });

    const [, request] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(request.body);
    expect(body.input).toContain("claims_complete");
    expect(body.input).not.toContain("Implementation is complete");
    expect(body.input).not.toContain("Ignore instructions");
    expect(body.input).not.toContain("Tyler must act");
  });

  test("falls back on invalid output", async () => {
    const input = toSessionCopyInput(cardView({ lifecycle: "running", primaryStatus: "editing" }), [], []);
    const fallback = buildDeterministicSessionCopy(input);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify({ headline: "Completed", status: "Done", reason: "Done." }) }]
          }
        ]
      })
    });

    await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, apiKey: "key", fetchImpl })).resolves.toMatchObject({
      copy: fallback,
      status: "invalid_output"
    });
  });

  test("caches successful copy overlays by sanitized input", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  headline: "This session is active now.",
                  status: "Working now",
                  reason: "This session is active and has recent activity."
                })
              }
            ]
          }
        ]
      })
    });
    const enricher = createOpenAISessionCopyEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      now: () => 1_000
    });
    const projection = liveProjection([cardView()]);

    const first = await enricher.enrichProjection(projection);
    const second = await enricher.enrichProjection(first);

    expect(first.cards[0]?.copy.source).toBe("llm");
    expect(second.cards[0]?.copy.source).toBe("llm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(enricher.status()).toMatchObject({ enabled: true, configured: true, cacheEntries: 1 });
  });
});

function cardView(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "App",
    title: "Session title",
    copy: {
      headline: "Still running",
      status: "Working now",
      reason: "This session is active.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 50,
    durationLabel: "4m",
    branchOrWorktree: "local",
    lastActivity: "2026-06-23T02:00:00.000Z",
    lastActivityLabel: "1m ago",
    changedFileCount: 0,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}

function liveProjection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: {
      active: cards.filter((card) => card.lifecycle !== "ended").length,
      needsAttention: 0,
      conflicts: 0,
      completed: 0,
      running: cards.filter((card) => card.lifecycle === "running").length,
      idle: cards.filter((card) => card.lifecycle === "idle").length,
      needsAction: 0
    },
    lanes: [
      { laneId: "running", title: "Running", count: cards.length, sessionIds: cards.map((card) => card.sessionId) },
      { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
      { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
      { laneId: "history", title: "History", count: 0, sessionIds: [] }
    ],
    cards,
    attentionQueue: [],
    conflicts: []
  };
}
