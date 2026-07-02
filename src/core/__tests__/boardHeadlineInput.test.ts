import { describe, expect, expectTypeOf, test } from "vitest";
import type { BoardHeadlineState } from "../boardHeadlineFrame";
import { toBoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput";
import type { BoardHeadlineFacts } from "../boardHeadlineFacts";

function facts(overrides: Partial<BoardHeadlineFacts> = {}): BoardHeadlineFacts {
  return {
    sessionId: "session-1",
    project: "Masthead",
    lifecycle: "running",
    primaryStatus: "editing",
    workContext: {
      label: "Settings UI work",
      confidence: "path_cluster",
      pathClusters: ["settings"],
      sourceSignals: ["path:settings"]
    },
    recentTranscriptMessages: ["Fix the Settings danger zone delete preview copy."],
    recentFileBasenames: ["SettingsPanel.tsx", "DangerZone.tsx"],
    changedFileCount: 2,
    recentEvents: [],
    recentToolNames: [],
    recentCommandFailures: [],
    attentionTitles: [],
    conflictTitles: [],
    ...overrides
  };
}

describe("board headline input", () => {
  test("builds compact subject candidates and evidence from headline facts", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts()
    });

    expect(input.subjectCandidates).toContain("Settings danger zone");
    expect(input.subjectCandidates).toContain("Settings UI");
    expect(input.subjectCandidates).toContain("DangerZone.tsx");
    expect(input.evidence).toContain("Fix the Settings danger zone delete preview copy.");
  });

  test("extracts lowercase transcript task subjects", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts({
        recentTranscriptMessages: ["work on the headline refreshes and data enrichment"],
        recentFileBasenames: []
      })
    });

    expect(input.subjectCandidates).toContain("headline refreshes");
    expect(input.subjectCandidates).toContain("data enrichment");
  });

  test("strips leading transcript filler before extracting product subjects", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts({
        recentTranscriptMessages: ["Investigate why Board headlines stopped refreshing from transcript updates."],
        recentFileBasenames: []
      })
    });

    expect(input.subjectCandidates).toContain("Board headlines");
    expect(input.subjectCandidates).not.toContain("Investigate why Board");
  });

  test("maps known UI file basenames to domain subjects", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts({
        recentTranscriptMessages: [],
        recentFileBasenames: ["SessionCard.tsx", "DangerZone.tsx", "CustomWidget.tsx"]
      })
    });

    expect(input.subjectCandidates).toContain("Board cards");
    expect(input.subjectCandidates).toContain("Settings danger zone");
    expect(input.subjectCandidates).toContain("CustomWidget.tsx");
  });

  test("marks blocked input and carries failure disposition evidence", () => {
    const signals: BoardHeadlineSignal[] = ["command_failed"];

    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "blocked",
      signals,
      facts: facts({
        primaryStatus: "blocked",
        recentCommandFailures: ["vitest failed on Settings danger zone tests"],
        attentionTitles: ["Settings delete flow failed verification"]
      })
    });

    expect(input.stateHint).toBe("blocked");
    expect(input.dispositionHints).toContain("vitest failed on Settings danger zone tests");
  });

  test("preserves terminal failed state when ended sessions carry command failure signals", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "ended",
      primaryStatus: "failed",
      signals: ["command_failed"],
      facts: facts({
        lifecycle: "ended",
        primaryStatus: "failed"
      })
    });

    expect(input.stateHint).toBe("failed");
  });

  test("preserves terminal blocked state for ended sessions", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "ended",
      primaryStatus: "blocked",
      signals: [],
      facts: facts({
        lifecycle: "ended",
        primaryStatus: "blocked"
      })
    });

    expect(input.stateHint).toBe("blocked");
  });

  test("uses board headline frame state values for state hints", () => {
    const waiting = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "waiting for user",
      signals: [],
      facts: facts()
    });
    const needsVerification = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: ["verification_missing"],
      facts: facts()
    });
    const completed = toBoardHeadlineInput({
      lifecycle: "ended",
      primaryStatus: "completed",
      signals: [],
      facts: facts()
    });
    const failed = toBoardHeadlineInput({
      lifecycle: "ended",
      primaryStatus: "failed",
      signals: [],
      facts: facts()
    });

    expectTypeOf(waiting.stateHint).toEqualTypeOf<BoardHeadlineState>();
    expect(waiting.stateHint).toBe("waiting");
    expect(needsVerification.stateHint).toBe("needs_verification");
    expect(completed.stateHint).toBe("completed");
    expect(failed.stateHint).toBe("failed");
  });

  test("maps running editing sessions to active", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts()
    });

    expect(input.stateHint).toBe("active");
  });

  test("maps running sessions with unknown primary status to active", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "unknown",
      signals: [],
      facts: facts({ primaryStatus: "unknown" })
    });

    expect(input.stateHint).toBe("active");
  });

  test("maps idle and stalled sessions to paused", () => {
    const idle = toBoardHeadlineInput({
      lifecycle: "idle",
      primaryStatus: "editing",
      signals: [],
      facts: facts({ lifecycle: "idle" })
    });
    const stalled = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: ["stalled"],
      facts: facts()
    });

    expect(idle.stateHint).toBe("paused");
    expect(stalled.stateHint).toBe("paused");
  });

  test("maps unrecognized lifecycle and status combinations to unknown", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "launching",
      primaryStatus: "warming",
      signals: [],
      facts: facts({
        lifecycle: "launching",
        primaryStatus: "warming"
      })
    });

    expect(input.stateHint).toBe("unknown");
  });

  test("dedupes and caps subject candidates and evidence", () => {
    const input = toBoardHeadlineInput({
      lifecycle: "running",
      primaryStatus: "editing",
      signals: [],
      facts: facts({
        recentTranscriptMessages: [
          "work on headline refreshes",
          "work on headline refreshes",
          "work on data enrichment"
        ],
        recentFileBasenames: ["SessionCard.tsx", "SessionCard.tsx", "DangerZone.tsx"],
        recentEvents: Array.from({ length: 25 }, (_, index) => ({
          type: "event",
          summary: `event ${index + 1}`,
          occurredAt: `2026-07-01T12:${index.toString().padStart(2, "0")}:00.000Z`
        })),
        recentToolNames: ["shell"],
        attentionTitles: ["attention"]
      })
    });

    expect(input.subjectCandidates.length).toBeLessThanOrEqual(12);
    expect(input.evidence).toHaveLength(20);
    expect(input.subjectCandidates.filter((subject) => subject === "headline refreshes")).toHaveLength(1);
    expect(input.evidence.filter((evidence) => evidence === "work on headline refreshes")).toHaveLength(1);
  });
});
