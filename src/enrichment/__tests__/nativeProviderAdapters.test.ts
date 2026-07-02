import { describe, expect, test, vi } from "vitest";
import { createAnthropicEnrichmentProvider } from "../anthropicProvider.ts";
import { createGeminiEnrichmentProvider } from "../geminiProvider.ts";
import type { SessionFacts } from "../sessionCompiler.ts";

describe("native LLM enrichment providers", () => {
  test("uses Anthropic Messages structured outputs when enabled and configured", async () => {
    const requests: Array<{ body: Record<string, unknown>; headers: HeadersInit | undefined; url: string; method?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)), headers: init?.headers, method: init?.method, url: String(url) });
      return anthropicResponse({
        action: "add",
        confidence: "high",
        liveSummary: "Anthropic provider settings have native Messages API coverage.",
        missingEvidence: [],
        object: "provider settings",
        outcome: "Added native Anthropic request coverage.",
        searchSummary: "Masthead session for native Anthropic provider settings.",
        title: "Anthropic provider settings"
      });
    });
    const provider = createAnthropicEnrichmentProvider({
      apiKey: "anthropic-test-key",
      enabled: true,
      fetchImpl,
      model: "claude-sonnet-4-6"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("anthropic");
    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.capsule?.title).toBe("Anthropic provider settings");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers).toMatchObject({
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": "anthropic-test-key"
    });
    const body = requests[0]?.body as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      model: string;
      output_config: { format: { type: string; schema: { required: string[] } } };
      system: string;
    };
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(360);
    expect(body.system).toContain("You are writing session metadata for Masthead.");
    expect(body.messages[0]?.role).toBe("user");
    expect(body.messages[0]?.content).not.toContain("/home/tyler");
    expect(body.messages[0]?.content).not.toContain("OPENAI_API_KEY");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toEqual([
      "title",
      "liveSummary",
      "outcome",
      "searchSummary",
      "action",
      "object",
      "confidence",
      "missingEvidence"
    ]);
  });

  test("uses Gemini generateContent structured output when enabled and configured", async () => {
    const requests: Array<{ body: Record<string, unknown>; headers: HeadersInit | undefined; url: string; method?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)), headers: init?.headers, method: init?.method, url: String(url) });
      return geminiResponse({
        action: "add",
        confidence: "medium",
        liveSummary: "Gemini provider settings have native generateContent coverage.",
        missingEvidence: [],
        object: "provider settings",
        outcome: "Added native Gemini request coverage.",
        searchSummary: "Masthead session for native Gemini provider settings.",
        title: "Gemini provider settings"
      });
    });
    const provider = createGeminiEnrichmentProvider({
      apiKey: "gemini-test-key",
      enabled: true,
      fetchImpl,
      model: "gemini-3.5-flash"
    });

    const result = await provider.enrich({ facts: facts() });

    expect(provider.id).toBe("gemini");
    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-3.5-flash");
    expect(result.capsule?.title).toBe("Gemini provider settings");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requests[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=gemini-test-key");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers).toMatchObject({
      "content-type": "application/json"
    });
    const body = requests[0]?.body as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: {
        maxOutputTokens: number;
        responseMimeType: string;
        responseSchema: { required: string[] };
        temperature: number;
      };
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.systemInstruction.parts[0]?.text).toContain("You are writing session metadata for Masthead.");
    expect(body.contents[0]?.role).toBe("user");
    expect(body.contents[0]?.parts[0]?.text).not.toContain("/home/tyler");
    expect(body.contents[0]?.parts[0]?.text).not.toContain("OPENAI_API_KEY");
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 360,
      responseMimeType: "application/json",
      temperature: 0
    });
    expect(body.generationConfig.responseSchema.required).toEqual([
      "title",
      "liveSummary",
      "outcome",
      "searchSummary",
      "action",
      "object",
      "confidence",
      "missingEvidence"
    ]);
  });
});

function facts(): SessionFacts {
  return {
    commands: ["npm test -- --run src/enrichment/__tests__/nativeProviderAdapters.test.ts"],
    evidence: [],
    files: ["/home/tyler/.codex/worktrees/1750/Masthead/src/ui/settings/EnrichmentSettings.tsx"],
    messages: ["Add Anthropic and Gemini native providers without leaking API keys."],
    narrative: {
      buildFailed: false,
      buildPassed: false,
      checkpointSummaries: [],
      commands: [
        {
          category: "test",
          exitCode: 0,
          name: "npm test -- --run src/enrichment/__tests__/nativeProviderAdapters.test.ts",
          outputPreview: "provider tests passed with OPENAI_API_KEY=sk-secret",
          status: "succeeded"
        }
      ],
      coverage: {
        assistantMessages: 1,
        fileEffects: 1,
        hasUsableTranscript: true,
        level: "complete",
        messageCount: 2,
        toolCalls: 1,
        tokenUsageRows: 0,
        userMessages: 1
      },
      deployMentioned: false,
      eventSummaries: [],
      fileBasenames: ["Enrichment Settings"],
      fileDirectories: ["src/ui/settings"],
      files: [{ basename: "Enrichment Settings", directory: "src/ui/settings", extension: "tsx", operation: "modified", path: "src/ui/settings/EnrichmentSettings.tsx" }],
      finalAssistantMessage: "Added native provider settings.",
      firstUserPrompt: "Add Anthropic and Gemini native providers.",
      lastUserPrompt: "Add Anthropic and Gemini native providers.",
      objective: "Add native LLM providers",
      project: "Masthead",
      runtime: "codex",
      sessionId: "session-native-provider",
      sourceSessionId: "source-native-provider",
      storedTitle: "Codex session",
      technologies: ["TypeScript"],
      testsFailed: false,
      testsPassed: true,
      topics: ["settings", "llm"]
    },
    objective: "Add native LLM providers",
    project: "Masthead",
    sessionId: "session-native-provider",
    sourceSessionId: "source-native-provider",
    title: "Codex session"
  };
}

function anthropicResponse(output: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => ({
      content: [
        {
          text: JSON.stringify(output),
          type: "text"
        }
      ]
    })
  } as Response;
}

function geminiResponse(output: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(output)
              }
            ]
          }
        }
      ]
    })
  } as Response;
}
