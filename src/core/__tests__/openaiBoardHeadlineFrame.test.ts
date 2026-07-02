import { describe, expect, test, vi } from "vitest";
import { toBoardHeadlineInput } from "../boardHeadlineInput";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";
import { rewriteBoardHeadlineFrameWithOpenAI } from "../openaiBoardHeadlineFrame";

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

describe("OpenAI board headline frame", () => {
  test("extracts a validated frame using the Responses API JSON schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      responseWithFrame({
        subject: "Board headlines",
        disposition: "structured around subject and disposition",
        state: "active",
        subjectKind: "component",
        confidence: "high",
        evidence: ["Use subject and disposition frames for Board headlines.", "SessionCard.tsx"]
      })
    );

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
    expect(JSON.parse(body.input)).toEqual(input());
    expect(body.input).not.toContain("OPENAI_API_KEY");
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
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    await expect(rewriteBoardHeadlineFrameWithOpenAI(input(), { enabled: true, apiKey: "key", fetchImpl })).resolves.toMatchObject({
      status: "timeout"
    });
  });
});
