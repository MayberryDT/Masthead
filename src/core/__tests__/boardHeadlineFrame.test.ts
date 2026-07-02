import { describe, expect, test } from "vitest";
import {
  renderBoardHeadlineFrame,
  validateBoardHeadlineFrame,
  type BoardHeadlineFrame
} from "../boardHeadlineFrame";

function frame(overrides: Partial<BoardHeadlineFrame> = {}): BoardHeadlineFrame {
  return {
    subject: "Board card headlines",
    disposition: "structured around subject and outcome",
    state: "active",
    subjectKind: "component",
    confidence: "high",
    evidence: ["Board headline prompt asks for concrete subject and outcome"],
    ...overrides
  };
}

function candidate(overrides: Record<string, unknown> = {}): unknown {
  return {
    ...frame(),
    ...overrides
  };
}

describe("board headline frame contract", () => {
  test("renders subject and disposition as a Board headline", () => {
    expect(renderBoardHeadlineFrame(frame())).toBe(
      "Board card headlines: structured around subject and outcome."
    );
  });

  test("normalizes subject trailing colon and disposition trailing punctuation", () => {
    expect(
      renderBoardHeadlineFrame(
        frame({
          subject: "Board card headlines:",
          disposition: "Structured around subject and outcome!!!"
        })
      )
    ).toBe("Board card headlines: structured around subject and outcome.");
  });

  test("accepts useful concrete subject and disposition", () => {
    const result = validateBoardHeadlineFrame(frame());

    expect(result.ok).toBe(true);
  });

  test("rejects weak generic subjects", () => {
    expect(validateBoardHeadlineFrame(frame({ subject: "UI changes" }))).toEqual({
      ok: false,
      reason: "weak_subject"
    });
  });

  test("rejects weak generic dispositions", () => {
    expect(validateBoardHeadlineFrame(frame({ disposition: "has recent activity" }))).toEqual({
      ok: false,
      reason: "weak_disposition"
    });
  });

  test("rejects unsafe text in subject and disposition", () => {
    expect(validateBoardHeadlineFrame(frame({ subject: "https://example.com/task" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
    expect(validateBoardHeadlineFrame(frame({ disposition: "see https://example.com/task" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
  });

  test("allows concrete OpenAI live copy refresh frame", () => {
    const result = validateBoardHeadlineFrame(
      frame({
        subject: "OpenAI live copy refresh",
        disposition: "scheduled in the background without blocking Board projection"
      })
    );

    expect(result.ok).toBe(true);
  });

  test("allows ordinary product language that contains key-like substrings", () => {
    expect(validateBoardHeadlineFrame(frame({ disposition: "adds keyboard navigation for settings rows" })).ok).toBe(
      true
    );
    expect(validateBoardHeadlineFrame(frame({ disposition: "documents key settings row behavior" })).ok).toBe(
      true
    );
    expect(validateBoardHeadlineFrame(frame({ disposition: "keeps monkey patch risk visible for review" })).ok).toBe(
      true
    );
  });

  test("rejects unsupported state values", () => {
    expect(validateBoardHeadlineFrame(candidate({ state: "reviewing" }))).toEqual({
      ok: false,
      reason: "unsupported_state"
    });
  });

  test("rejects unsupported subject kind values", () => {
    expect(validateBoardHeadlineFrame(candidate({ subjectKind: "workflow" }))).toEqual({
      ok: false,
      reason: "unsupported_state"
    });
  });

  test("rejects unsupported confidence values as invalid shape", () => {
    expect(validateBoardHeadlineFrame(candidate({ confidence: "certain" }))).toEqual({
      ok: false,
      reason: "invalid_shape"
    });
  });

  test("cleans valid string evidence and caps it at six entries", () => {
    const result = validateBoardHeadlineFrame(
      frame({
        evidence: [
          " first evidence item ",
          "",
          "second  evidence item",
          " third evidence item ",
          "fourth evidence item",
          "fifth evidence item",
          "sixth evidence item",
          "seventh evidence item"
        ]
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame.evidence).toEqual([
        "first evidence item",
        "second evidence item",
        "third evidence item",
        "fourth evidence item",
        "fifth evidence item",
        "sixth evidence item"
      ]);
    }
  });

  test("rejects unsafe secrets, API keys, Codex directives, and URL placeholders", () => {
    expect(validateBoardHeadlineFrame(frame({ disposition: "uses OPENAI_API_KEY during testing" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
    expect(validateBoardHeadlineFrame(frame({ disposition: "stores sk-proj-example123" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
    expect(validateBoardHeadlineFrame(frame({ disposition: "emits ::git-stage{cwd=\"/tmp\"} after staging" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
    expect(validateBoardHeadlineFrame(frame({ disposition: "links to [url] during summary" }))).toEqual({
      ok: false,
      reason: "unsafe_text"
    });
  });

  test("rejects non-string evidence entries as invalid shape", () => {
    expect(validateBoardHeadlineFrame(candidate({ evidence: [123] }))).toEqual({
      ok: false,
      reason: "invalid_shape"
    });
  });
});
