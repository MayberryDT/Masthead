import { describe, expect, test, vi } from "vitest";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";
import { rewriteBoardHeadlineFrameWithOpenAI } from "../openaiBoardHeadlineFrame";
import type { BoardHeadlineFrame } from "../boardHeadlineFrame";

function facts(overrides: Partial<BoardLiveCopyFacts> = {}): BoardLiveCopyFacts {
  return {
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
    conflictTitles: [],
    ...overrides
  };
}

function input() {
  return toBoardHeadlineInput({
    lifecycle: "running",
    primaryStatus: "editing",
    signals: [],
    facts: facts()
  });
}

function responseWithFrame(frame: unknown) {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(frame) }]
        }
      ]
    })
  };
}

function validFrame(overrides: Partial<BoardHeadlineFrame> = {}): BoardHeadlineFrame {
  return {
    subject: "Board headlines",
    disposition: "structured around subject and disposition",
    state: "active",
    subjectKind: "component",
    confidence: "high",
    evidence: ["Use subject and disposition frames for Board headlines.", "SessionCard.tsx"],
    ...overrides
  };
}

describe("OpenAI board headline frame", () => {
  test("extracts a validated frame using the Responses API JSON schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseWithFrame(validFrame()));

    const result = await rewriteBoardHeadlineFrameWithOpenAI(input(), {
      enabled: true,
      apiKey: "key",
      fetchImpl,
      model: "gpt-5-nano-2025-08-07"
    });

    expect(result).toMatchObject({
      status: "llm",
      frame: {
        subject: "Board headlines",
        disposition: "structured around subject and disposition"
      }
    });

    const [, request] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String(request.body));

    expect(body).toMatchObject({
      model: "gpt-5-nano-2025-08-07",
      store: false,
      max_output_tokens: 500,
      reasoning: { effort: "minimal" },
      text: { format: { type: "json_schema", name: "masthead_board_headline_frame", strict: true } }
    });
    expect(body.text.format.schema.required).toEqual(["subject", "disposition", "state", "subjectKind", "confidence", "evidence"]);
    expect(body.instructions).toContain("Do not summarize the session");
    expect(body.instructions).toContain("smallest concrete work object");
    const expectedInput = input();
    expect(JSON.parse(body.input)).toEqual({
      lifecycle: expectedInput.lifecycle,
      primaryStatus: expectedInput.primaryStatus,
      stateHint: expectedInput.stateHint,
      signals: expectedInput.signals,
      subjectCandidates: expectedInput.subjectCandidates,
      dispositionHints: expectedInput.dispositionHints,
      evidence: expectedInput.evidence,
      facts: {
        changedFileCount: 1,
        recentFileBasenames: ["SessionCard.tsx"],
        recentToolNames: []
      }
    });
    expect(body.input).not.toContain("OPENAI_API_KEY");
  });

  test("sends a sanitized compact provider payload without full facts", async () => {
    const unsafeInput = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: ["command_failed"],
      facts: facts({
        title: "OPENAI_API_KEY",
        project: "https://example.com",
        recentTranscriptMessages: [
          "Board headline frame keeps concrete subject evidence.",
          '::git-stage{cwd="/tmp"}',
          "[url]",
          "sk-proj-secret"
        ],
        recentFileBasenames: ["SessionCard.tsx", "/home/tyler/secret/path"],
        recentEvents: [
          { type: "session.started", summary: "Headline work started", occurredAt: "2026-07-01T19:00:00.000Z" },
          { type: "tool.call", summary: "OPENAI_API_KEY", occurredAt: "2026-07-01T19:00:01.000Z" },
          { type: "tool.call", summary: "https://example.com", occurredAt: "2026-07-01T19:00:02.000Z" },
          { type: "tool.call", summary: '::git-stage{cwd="/tmp"}', occurredAt: "2026-07-01T19:00:03.000Z" },
          { type: "tool.call", summary: "[url]", occurredAt: "2026-07-01T19:00:04.000Z" },
          { type: "tool.call", summary: "sk-proj-secret", occurredAt: "2026-07-01T19:00:05.000Z" },
          { type: "tool.call", summary: "/home/tyler/secret/path", occurredAt: "2026-07-01T19:00:06.000Z" }
        ],
        recentCommandFailures: ["OPENAI_API_KEY"],
        attentionTitles: ["https://example.com"],
        conflictTitles: ['::git-stage{cwd="/tmp"}'],
        recentToolNames: ["apply_patch"]
      })
    });
    const fetchImpl = vi.fn().mockResolvedValue(responseWithFrame(validFrame()));

    await rewriteBoardHeadlineFrameWithOpenAI(unsafeInput, { enabled: true, apiKey: "key", fetchImpl });

    const [, request] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String(request.body));
    const providerInput = JSON.parse(body.input);
    expect(providerInput).toMatchObject({
      lifecycle: "running",
      primaryStatus: "editing",
      stateHint: "blocked",
      signals: ["command_failed"]
    });
    expect(providerInput).not.toHaveProperty("facts.sessionId");
    expect(providerInput).not.toHaveProperty("facts.project");
    expect(providerInput).not.toHaveProperty("facts.recentTranscriptMessages");
    expect(providerInput).not.toHaveProperty("facts.recentEvents");
    expect(providerInput.facts).toEqual({
      changedFileCount: 1,
      recentFileBasenames: ["SessionCard.tsx"],
      recentToolNames: ["apply_patch"]
    });

    expect(body.input).toContain("Headline work started");
    expect(body.input).not.toContain("OPENAI_API_KEY");
    expect(body.input).not.toContain("https://example.com");
    expect(body.input).not.toContain("::git-stage");
    expect(body.input).not.toContain("[url]");
    expect(body.input).not.toContain("sk-proj-");
    expect(body.input).not.toContain("/home/tyler/secret/path");
  });

  test("extracts top-level Responses API output_text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(validFrame()) })
    });

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
        subject: "Board headlines",
        disposition: "structured around subject and disposition"
      }
    });
  });

  test("returns validation_failed for weak model frames", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      responseWithFrame({
        subject: "UI changes",
        disposition: "has recent activity",
        state: "active",
        subjectKind: "component",
        confidence: "low",
        evidence: ["Use subject and disposition frames for Board headlines."]
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
      status: "validation_failed",
      validationReason: "weak_subject"
    });
  });

  test("does not call OpenAI when disabled or missing a key", async () => {
    const fetchImpl = vi.fn();

    await expect(rewriteBoardHeadlineFrameWithOpenAI(input(), { enabled: false, apiKey: "key", fetchImpl })).resolves.toMatchObject({
      status: "disabled"
    });
    await expect(rewriteBoardHeadlineFrameWithOpenAI(input(), { enabled: true, apiKey: "  ", fetchImpl })).resolves.toMatchObject({
      status: "not_configured"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("returns invalid_output when the model response is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }]
      })
    });

    await expect(rewriteBoardHeadlineFrameWithOpenAI(input(), { enabled: true, apiKey: "key", fetchImpl })).resolves.toMatchObject({
      status: "invalid_output"
    });
  });

  test("returns timeout when the OpenAI request is aborted", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: Parameters<typeof fetch>[0], request?: RequestInit): Promise<Response> => {
      capturedSignal = request?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    });

    try {
      const resultPromise = rewriteBoardHeadlineFrameWithOpenAI(input(), { enabled: true, apiKey: "key", fetchImpl, timeoutMs: 25 });
      await vi.advanceTimersByTimeAsync(25);

      await expect(resultPromise).resolves.toMatchObject({
        status: "timeout"
      });
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
