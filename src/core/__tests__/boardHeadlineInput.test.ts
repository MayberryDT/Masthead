import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";

function facts(overrides: Partial<BoardLiveCopyFacts> = {}): BoardLiveCopyFacts {
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
  test("builds compact subject candidates and evidence from live copy facts", () => {
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
});
