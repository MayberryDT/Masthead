import { describe, expect, test, vi } from "vitest";
import { createOpenAIEnrichmentProvider } from "../openAIProvider.ts";
import type { SessionFacts } from "../sessionCompiler.ts";

describe("OpenAI enrichment provider", () => {
  test("uses validated Responses output when enabled and configured", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string };
      expect(body.input).not.toContain("/home/tyler");
      expect(body.input).not.toContain("OPENAI_API_KEY");
      return responseWithOutput({
        liveSummary: "MCP launch config validation is being reviewed for Masthead.",
        outcome: "Added validation and tools-list coverage for MCP launch config.",
        searchSummary: "Masthead session for MCP launch config validation with tools-list coverage.",
        title: "MCP launch config validation"
      });
    });
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl,
      model: "test-model"
    });

    const capsule = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("openai");
    expect(provider.model).toBe("test-model");
    expect(capsule.title).toBe("MCP launch config validation");
    expect(capsule.titleSource).toBe("llm");
    expect(capsule.liveSummary).toBe("MCP launch config validation is being reviewed for Masthead.");
    expect(capsule.searchSummary).toContain("tools-list coverage");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("falls back to deterministic output when Responses output is invalid", async () => {
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: true,
      fetchImpl: vi.fn(async () =>
        responseWithOutput({
          liveSummary: "Updated files.",
          searchSummary: "Changed files were updated in this session.",
          title: "Codex session"
        })
      )
    });

    const capsule = await provider.enrich({ facts: facts() });

    expect(capsule.titleSource).toBe("deterministic");
    expect(capsule.title).toBe("MCP launch config validation");
  });

  test("does not call Responses when disabled", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAIEnrichmentProvider({
      apiKey: "test-key",
      enabled: false,
      fetchImpl
    });

    const capsule = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("deterministic");
    expect(capsule.titleSource).toBe("deterministic");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function facts(): SessionFacts {
  return {
    commands: ["npm test -- --run src/mcp/__tests__/toolsList.test.ts"],
    evidence: [],
    files: ["/home/tyler/.codex/worktrees/7c35/Masthead/src/ui/AgentAccessPanel.tsx"],
    messages: ["Fix MCP launch config validation before review."],
    narrative: {
      buildFailed: false,
      buildPassed: false,
      checkpointSummaries: [],
      commands: [{ category: "test", name: "npm test -- --run src/mcp/__tests__/toolsList.test.ts", status: "succeeded" }],
      deployMentioned: false,
      eventSummaries: [],
      fileBasenames: ["Agent Access Panel"],
      fileDirectories: ["src/ui"],
      files: [{ basename: "Agent Access Panel", directory: "src/ui", extension: "tsx", operation: "modified", path: "src/ui/AgentAccessPanel.tsx" }],
      finalAssistantMessage: "Added validation and tools-list coverage for MCP launch config.",
      firstUserPrompt: "Fix MCP launch config validation before review.",
      lastUserPrompt: "Fix MCP launch config validation before review.",
      objective: "Fix MCP launch config validation",
      project: "Masthead",
      runtime: "codex",
      sessionId: "session-openai-provider",
      sourceSessionId: "source-openai-provider",
      storedTitle: "Codex session",
      technologies: ["TypeScript"],
      testsFailed: false,
      testsPassed: true,
      topics: ["mcp"]
    },
    objective: "Fix MCP launch config validation",
    project: "Masthead",
    sessionId: "session-openai-provider",
    sourceSessionId: "source-openai-provider",
    title: "Codex session"
  };
}

function responseWithOutput(output: Record<string, string>): Response {
  return {
    ok: true,
    json: async () => ({
      output: [
        {
          content: [
            {
              text: JSON.stringify(output),
              type: "output_text"
            }
          ]
        }
      ]
    })
  } as Response;
}
