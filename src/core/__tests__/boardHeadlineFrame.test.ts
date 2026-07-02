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
});
