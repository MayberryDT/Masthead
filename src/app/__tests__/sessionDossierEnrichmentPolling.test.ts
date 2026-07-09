import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import { pollDossierEnrichment } from "../sessionDossierEnrichmentPolling";

vi.mock("../daemonClient", () => ({
  getSessionDossier: vi.fn()
}));

import { getSessionDossier } from "../daemonClient";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("pollDossierEnrichment", () => {
  test("polls until enrichment leaves the enriching state", async () => {
    vi.useFakeTimers();
    const enriching = dossier("enriching");
    const current = dossier("current");
    vi.mocked(getSessionDossier).mockResolvedValueOnce(enriching).mockResolvedValueOnce(current);
    const seen: string[] = [];

    const resultPromise = pollDossierEnrichment({
      baseUrl: "http://127.0.0.1:17373",
      intervalMs: 10,
      onDossier: (next) => seen.push(next.enrichment.status),
      sessionId: "session-1"
    });
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toBe(current);
    expect(seen).toEqual(["enriching", "current"]);
  });
});

function dossier(status: SessionDossierDto["enrichment"]["status"]): SessionDossierDto {
  return {
    attention: [],
    artifacts: [],
    coverage: {
      level: "partial",
      transcript: {
        assistantMessages: 1,
        checkpoints: 0,
        fileEffects: 0,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 2,
        runtimeSignals: 0,
        toolCalls: 0,
        toolResults: 0,
        userMessages: 1
      },
      warnings: []
    },
    enrichment: { status },
    excerpts: [],
    files: [],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-07-03T18:00:00.000Z",
      lifecycle: "ended",
      models: [],
      runtime: "opencode",
      sessionId: "session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      title: "Session"
    },
    narrative: { technologies: [], topics: [], unresolved: [] },
    reuse: {
      canonicalSessionId: "session-1",
      copyableContext: "",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "opencode",
      sourceSessionId: "source-session-1"
    },
    timeline: [],
    tools: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 },
    verification: { commands: [], status: "unknown", summary: "No verification signal captured." }
  };
}
