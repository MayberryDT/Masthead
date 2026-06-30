import { describe, expect, test } from "vitest";
import { deterministicCapsuleFromFacts, type SessionFacts } from "../sessionCompiler.ts";
import { draftNarrativeFromFacts } from "../sessionNarrativeDraft.ts";
import type { SessionNarrativeFacts } from "../sessionNarrativeFacts.ts";

describe("session narrative draft", () => {
  test("turns session facts into stable card and search copy", () => {
    const draft = draftNarrativeFromFacts(narrativeFacts());

    expect(draft.title).toBe("MCP launch config validation");
    expect(draft.liveSummary).toBe("Added validation and tools-list test for MCP launch config.");
    expect(draft.outcome).toBe("Added validation and tools-list test for MCP launch config.");
    expect(draft.searchSummary).toContain("Masthead session for MCP launch config validation.");
    expect(draft.filesChangedSummary).toContain("Agent Access Panel");
    expect(draft.commandsSummary).toContain("tools-list test");
    expect(draft.verificationSummary).toBe("tests passed");
    expect(draft.validationWarnings).toEqual([]);
  });

  test("deterministic capsules prefer narrative fields when available", () => {
    const capsule = deterministicCapsuleFromFacts(sessionFacts());

    expect(capsule.title).toBe("MCP launch config validation");
    expect(capsule.titleSource).toBe("deterministic");
    expect(capsule.liveSummary).toBe("Added validation and tools-list test for MCP launch config.");
    expect(capsule.searchSummary).toContain("Verification: tests passed.");
    expect(capsule.searchPhrases).toEqual(expect.arrayContaining(["MCP launch config validation", "Agent Access Panel"]));
    expect(capsule.searchPhrases.join(" ")).not.toContain("src/ui/AgentAccessPanel.tsx");
    expect(capsule.searchPhrases.join(" ")).not.toContain("npm test");
  });
});

function sessionFacts(): SessionFacts {
  return {
    commands: ["npm test -- --run src/mcp/__tests__/toolsList.test.ts"],
    evidence: [],
    files: ["src/ui/AgentAccessPanel.tsx", "src/daemon/mcpStatusService.ts"],
    messages: ["Fix MCP launch config validation before review."],
    narrative: narrativeFacts(),
    objective: "Fix MCP launch config validation",
    project: "Masthead",
    sessionId: "session-narrative-draft",
    sourceSessionId: "source-narrative-draft",
    title: "Codex session"
  };
}

function narrativeFacts(): SessionNarrativeFacts {
  return {
    buildFailed: false,
    buildPassed: false,
    checkpointSummaries: [],
    commands: [
      {
        category: "test",
        name: "npm test -- --run src/mcp/__tests__/toolsList.test.ts",
        status: "succeeded"
      }
    ],
    coverage: {
      assistantMessages: 1,
      fileEffects: 2,
      hasUsableTranscript: true,
      level: "complete",
      messageCount: 2,
      tokenUsageRows: 0,
      toolCalls: 1,
      userMessages: 1
    },
    deployMentioned: false,
    eventSummaries: [],
    fileBasenames: ["Agent Access Panel", "mcp Status Service"],
    fileDirectories: ["src/ui", "src/daemon"],
    files: [
      {
        basename: "Agent Access Panel",
        directory: "src/ui",
        extension: "tsx",
        operation: "modified",
        path: "src/ui/AgentAccessPanel.tsx"
      },
      {
        basename: "mcp Status Service",
        directory: "src/daemon",
        extension: "ts",
        operation: "modified",
        path: "src/daemon/mcpStatusService.ts"
      }
    ],
    finalAssistantMessage: "Added validation and tools-list test for MCP launch config.",
    firstUserPrompt: "Fix MCP launch config validation before review.",
    lastUserPrompt: "Fix MCP launch config validation before review.",
    objective: "Fix MCP launch config validation",
    project: "Masthead",
    runtime: "codex",
    sessionId: "session-narrative-draft",
    sourceSessionId: "source-narrative-draft",
    storedTitle: "Codex session",
    technologies: ["TypeScript"],
    testsFailed: false,
    testsPassed: true,
    topics: ["mcp", "ui"]
  };
}
