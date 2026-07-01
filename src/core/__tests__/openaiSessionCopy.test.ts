import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createOpenAISessionCopyEnricher,
  rewriteSessionCopyWithOpenAI
} from "../openaiSessionCopy";
import { createEnrichmentAuditLogger } from "../../enrichment/enrichmentAudit";
import { buildDeterministicSessionCopy, toSessionCopyInput } from "../sessionCopy";
import type { LiveBoardProjection, SessionCardView } from "../types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("OpenAI session copy", () => {
  test("does not call OpenAI when disabled or missing a key", async () => {
    const input = toSessionCopyInput(cardView(), [], []);
    const fallback = buildDeterministicSessionCopy(input);
    const fetchImpl = vi.fn();

    await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: false, apiKey: "present", fetchImpl })).resolves.toMatchObject({
      status: "disabled"
    });
    await expect(rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, fetchImpl })).resolves.toMatchObject({
      failureMessage: expect.stringContaining("not configured"),
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
                  headline: "OAuth callback changes have a recent completion note.",
                  status: "Session reports completion.",
                  reason: "The latest feedback mentions completion evidence."
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
        headline: "OAuth callback changes have a recent completion note.",
        source: "llm"
      }
    });
    const [, request] = fetchImpl.mock.calls[0]!;
    expect(request.headers.authorization).toBe("Bearer redacted-test-key");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      model: "gpt-5-nano-2025-08-07",
      store: false,
      max_output_tokens: 600,
      reasoning: { effort: "minimal" },
      text: { format: { type: "json_schema", name: "masthead_session_copy", strict: true } }
    });
    expect(body.text.format.schema.required).toEqual(["headline", "status", "reason", "nextStep"]);
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
    expect(body.instructions).toContain("headlineEvidence");
    expect(body.instructions).toContain("file, domain, tool, task, or action");
    expect(body.instructions).toContain("claim flags");
    expect(body.instructions).toContain("full sentence");
    expect(body.instructions).toContain("snake_case tokens");
    expect(body.instructions).toContain("must not be a single enum-like word");
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

  test("returns validation failure without fallback copy on invalid output", async () => {
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

    const result = await rewriteSessionCopyWithOpenAI(input, fallback, { enabled: true, apiKey: "key", fetchImpl });

    expect(result).toMatchObject({
      status: "validation_failed",
      validationReason: "invalid_shape"
    });
    expect(result.copy).toBeUndefined();
  });

  test("rewrites every projection by default instead of using a 10 minute cache", async () => {
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
                  headline: "This work is in progress.",
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.cards[0]?.copyRefresh).toMatchObject({ status: "success" });
    expect(second.cards[0]?.copyRefresh).toMatchObject({ status: "success" });
    expect(enricher.status()).toMatchObject({ enabled: true, configured: true, cacheEntries: 0 });
  });

  test("uses the card copy input evidence when refreshing live copy", async () => {
    const copyInput = toSessionCopyInput(cardView(), [], [], {
      facts: {
        attentionTitles: [],
        changedFileCount: 0,
        conflictTitles: [],
        lifecycle: "running",
        primaryStatus: "editing",
        project: "Masthead",
        recentCommandFailures: [],
        recentEvents: [
          {
            occurredAt: "2026-06-30T10:00:00.000Z",
            summary: "Moved the File button to the far right of the Logbook toolbar.",
            type: "session.completed"
          }
        ],
        recentFileBasenames: ["LogbookToolbar.tsx"],
        recentToolNames: [],
        sessionId: "session-1"
      }
    });
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
                  headline: "This work is in progress.",
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
    const projection = liveProjection([{ ...cardView(), copyInput } as SessionCardView & { copyInput: typeof copyInput }]);

    await enricher.enrichProjection(projection);

    const [, request] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(request.body).input).toContain("Moved the File button to the far right of the Logbook toolbar.");
    expect(JSON.parse(JSON.parse(request.body).input).headlineEvidence).toEqual(
      expect.arrayContaining(["Moved the File button to the far right of the Logbook toolbar.", "LogbookToolbar.tsx"])
    );
  });

  test("uses the refresh cadence to avoid normal 10 second board refresh timeouts", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true }
        );
      });
    });
    const input = toSessionCopyInput(cardView(), [], []);
    const fallback = buildDeterministicSessionCopy(input);
    const pending = rewriteSessionCopyWithOpenAI(input, fallback, {
      enabled: true,
      apiKey: "key",
      fetchImpl,
      refreshIntervalMs: 10_000
    });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result).toMatchObject({
      failureMessage: "OpenAI live copy timed out after 8000ms.",
      status: "timeout"
    });
    expect(signals[0]?.aborted).toBe(true);
    vi.useRealTimers();
  });

  test("cache is opt-in for successful copy overlays", async () => {
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
                  headline: "This work is in progress.",
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
      now: () => 1_000,
      ttlMs: 10 * 60_000
    });
    const projection = liveProjection([cardView()]);

    const first = await enricher.enrichProjection(projection);
    const second = await enricher.enrichProjection(first);

    expect(first.cards[0]?.copy.source).toBe("llm");
    expect(second.cards[0]?.copy.source).toBe("llm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(enricher.status()).toMatchObject({ enabled: true, configured: true, cacheEntries: 1 });
  });

  test("provider failure keeps baseline copy and surfaces refresh metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const enricher = createOpenAISessionCopyEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      now: () => 1_000
    });
    const projection = liveProjection([cardView()]);

    const enriched = await enricher.enrichProjection(projection);

    expect(enriched.cards[0]?.copy).toEqual(projection.cards[0]?.copy);
    expect(enriched.cards[0]?.copy.source).toBe("deterministic");
    expect(enriched.cards[0]?.copyRefresh).toMatchObject({
      failureMessage: "OpenAI live copy request failed with HTTP 500.",
      provider: "openai",
      status: "api_error"
    });
    expect(enriched.copyRefreshSummary).toMatchObject({
      requested: 1,
      succeeded: 0,
      failed: 1,
      disabled: 0
    });
  });

  test("keeps the last successful live copy when a later refresh fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    headline: "This session is active with GPT copy.",
                    status: "Work is active.",
                    reason: "This running session has recent activity.",
                    nextStep: ""
                  })
                }
              ]
            }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const enricher = createOpenAISessionCopyEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      now: () => 1_000
    });
    const projection = liveProjection([cardView()]);

    const first = await enricher.enrichProjection(projection);
    const second = await enricher.enrichProjection(projection);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.cards[0]?.copy).toMatchObject({
      headline: "This session is active with GPT copy.",
      source: "llm"
    });
    expect(second.cards[0]?.copy).toMatchObject({
      headline: "This session is active with GPT copy.",
      source: "llm"
    });
    expect(second.cards[0]?.copyRefresh).toMatchObject({ status: "api_error" });
    expect(second.copyRefreshSummary).toMatchObject({ requested: 1, succeeded: 0, failed: 1 });
  });

  test("only refreshes active non-blocked running cards and leaves idle, ended, and blocked cards unmarked", async () => {
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
                  headline: "This work is in progress.",
                  status: "Work is active.",
                  reason: "This running session has recent activity.",
                  nextStep: ""
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
      maxConcurrent: 1,
      now: () => 1_000
    });
    const runningCard = cardView({ sessionId: "running-session", lifecycle: "running", primaryStatus: "editing" });
    const idleCard = cardView({ sessionId: "idle-session", lifecycle: "idle", primaryStatus: "stalled" });
    const endedCard = cardView({ sessionId: "ended-session", lifecycle: "ended", primaryStatus: "completed_unreviewed" });
    const blockedCard = cardView({ sessionId: "blocked-session", lifecycle: "running", primaryStatus: "blocked" });
    const approvalCard = cardView({ sessionId: "approval-session", lifecycle: "running", primaryStatus: "waiting_for_approval" });
    const userCard = cardView({ sessionId: "user-session", lifecycle: "running", primaryStatus: "waiting_for_user" });

    const enriched = await enricher.enrichProjection(liveProjection([idleCard, endedCard, blockedCard, approvalCard, userCard, runningCard]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input).lifecycle).toBe("running");
    expect(enriched.cards.find((card) => card.sessionId === "running-session")?.copyRefresh).toMatchObject({ status: "success" });
    expect(enriched.cards.find((card) => card.sessionId === "idle-session")?.copyRefresh).toBeUndefined();
    expect(enriched.cards.find((card) => card.sessionId === "ended-session")?.copyRefresh).toBeUndefined();
    expect(enriched.cards.find((card) => card.sessionId === "blocked-session")?.copyRefresh).toBeUndefined();
    expect(enriched.cards.find((card) => card.sessionId === "approval-session")?.copyRefresh).toBeUndefined();
    expect(enriched.cards.find((card) => card.sessionId === "user-session")?.copyRefresh).toBeUndefined();
    expect(enriched.copyRefreshSummary).toMatchObject({ requested: 1, succeeded: 1, failed: 0 });
  });

  test("spends a short projection budget on running cards before ended cards", async () => {
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
                  headline: "This work is in progress.",
                  status: "Work is active.",
                  reason: "This running session has recent activity.",
                  nextStep: ""
                })
              }
            ]
          }
        ]
      })
    });
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(2);
    const enricher = createOpenAISessionCopyEnricher({
      enabled: true,
      apiKey: "key",
      fetchImpl,
      maxConcurrent: 1,
      now,
      projectionBudgetMs: 1
    });
    const endedCard = cardView({ sessionId: "ended-session", lifecycle: "ended", primaryStatus: "completed_unreviewed" });
    const runningCard = cardView({ sessionId: "running-session", lifecycle: "running", primaryStatus: "editing" });

    const enriched = await enricher.enrichProjection(liveProjection([endedCard, runningCard]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.parse(fetchImpl.mock.calls[0]![1].body).input).lifecycle).toBe("running");
    expect(enriched.cards.find((card) => card.sessionId === "running-session")?.copyRefresh).toMatchObject({ status: "success" });
    expect(enriched.cards.find((card) => card.sessionId === "ended-session")?.copyRefresh).toBeUndefined();
  });

  test("writes board audit events for each refresh when enabled", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-board-audit-"));
    tempDirs.push(tempDir);
    const auditFile = join(tempDir, "audit.jsonl");
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
                  headline: "This work is in progress.",
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
      auditLogger: createEnrichmentAuditLogger({
        MASTHEAD_ENRICHMENT_AUDIT: "1",
        MASTHEAD_ENRICHMENT_AUDIT_FILE: auditFile
      }),
      enabled: true,
      apiKey: "key",
      fetchImpl,
      now: (() => {
        let value = 1_000;
        return () => {
          value += 1;
          return value;
        };
      })()
    });
    const projection = liveProjection([cardView()]);

    await enricher.enrichProjection(projection);
    await enricher.enrichProjection(projection);

    const events = (await readFile(auditFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { kind: string });
    expect(events.filter((event) => event.kind === "board.started")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "board.applied")).toHaveLength(2);
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
