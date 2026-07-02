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
      transcriptExcerpt: [
        {
          observedAt: "2026-07-01T12:00:00.000Z",
          role: "user",
          text: "Board headlines should refresh from transcript messages."
        }
      ],
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
            transcriptExcerpt: [],
            recentTranscriptMessages: []
          }
        })
      )
    ).toBe(false);
  });

  test("returns undefined without transcript evidence", () => {
    const key = boardHeadlineRefreshKey("gpt-test", input({ facts: { ...input().facts, transcriptExcerpt: [], recentTranscriptMessages: [] } }));

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
          transcriptExcerpt: [
            {
              observedAt: "2026-07-01T12:01:00.000Z",
              role: "assistant",
              text: "Use the last assistant answer as headline evidence."
            }
          ],
          recentTranscriptMessages: ["Use the last assistant answer as headline evidence."]
        }
      })
    );

    expect(second).not.toBe(first);
  });

  test("changes when the transcript role changes even if the text is the same", () => {
    const first = boardHeadlineRefreshKey("gpt-test", input());
    const second = boardHeadlineRefreshKey(
      "gpt-test",
      input({
        facts: {
          ...input().facts,
          transcriptExcerpt: [
            {
              observedAt: "2026-07-01T12:00:00.000Z",
              role: "assistant",
              text: "Board headlines should refresh from transcript messages."
            }
          ]
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
