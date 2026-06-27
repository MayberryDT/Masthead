import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { UsageStatsDto } from "../../../app/daemonClient";
import { UsagePanel } from "../UsagePanel";

describe("UsagePanel", () => {
  test("renders ready state with model, project, runtime, activity, and coverage rows", () => {
    const html = renderToStaticMarkup(<UsagePanel stats={stats()} window="today" onWindowChange={() => undefined} onRetry={() => undefined} />);

    expect(html).not.toContain("Session usage");
    expect(html).toContain("Total tokens");
    expect(html).toContain("Tokens/m");
    expect(html).toContain("12.5K");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("Masthead");
    expect(html).toContain("codex");
    expect(html).toContain("Data coverage");
    expect(html).not.toContain("Cost");
  });

  test("renders empty and no-token states", () => {
    expect(renderToStaticMarkup(<UsagePanel stats={stats({ sessions: 0, tokenRows: 0, totalTokens: 0 })} window="today" onWindowChange={() => undefined} onRetry={() => undefined} />)).toContain("No usage records yet");
    expect(renderToStaticMarkup(<UsagePanel stats={stats({ sessions: 2, tokenRows: 0, totalTokens: 0 })} window="today" onWindowChange={() => undefined} onRetry={() => undefined} />)).toContain("Token usage is not imported yet");
  });

  test("renders loading and retryable error states", () => {
    expect(renderToStaticMarkup(<UsagePanel window="today" loading onWindowChange={() => undefined} onRetry={() => undefined} />)).toContain("Loading usage");
    expect(renderToStaticMarkup(<UsagePanel window="today" error="offline" onWindowChange={() => undefined} onRetry={() => undefined} />)).toContain("Usage unavailable");
  });

  test("renders window controls without changing selection during server render", () => {
    const onWindowChange = vi.fn();
    const html = renderToStaticMarkup(<UsagePanel stats={stats()} window="today" onWindowChange={onWindowChange} onRetry={() => undefined} />);

    expect(html).toContain("Today");
    expect(html).toContain("24h");
    expect(onWindowChange).not.toHaveBeenCalled();
  });
});

function stats(overrides: Partial<UsageStatsDto["totals"]> = {}): UsageStatsDto {
  const totals = {
    fileEffects: 4,
    inputTokens: 8_000,
    mcpQueries: 3,
    messages: 9,
    models: 1,
    outputTokens: 4_500,
    projects: 1,
    runtimes: 1,
    sessions: 2,
    tokenCoverageSessions: 2,
    tokenRows: 2,
    tokensPerMinute: 17,
    toolCalls: 5,
    totalTokens: 12_500,
    ...overrides
  };
  return {
    activity: [{ bucketStart: "2026-06-26T12:00:00.000Z", fileEffects: 4, messages: 9, sessions: 2, toolCalls: 5, totalTokens: totals.totalTokens }],
    byModel: [{ inputTokens: totals.inputTokens, model: "gpt-5.5", outputTokens: totals.outputTokens, provider: "openai", sessions: 2, totalTokens: totals.totalTokens }],
    byProject: [{ fileEffects: 4, messages: 9, project: "Masthead", sessions: 2, toolCalls: 5, totalTokens: totals.totalTokens }],
    byRuntime: [{ fileEffects: 4, messages: 9, runtime: "codex", sessions: 2, toolCalls: 5, totalTokens: totals.totalTokens }],
    coverage: {
      currentEnrichments: 2,
      importedSessions: 2,
      mcpQueries: 3,
      sessionsWithTokenUsage: totals.tokenCoverageSessions,
      sessionsWithoutTokenUsage: Math.max(0, totals.sessions - totals.tokenCoverageSessions),
      sources: 1
    },
    generatedAt: "2026-06-26T12:00:00.000Z",
    range: { from: "2026-06-26T00:00:00.000Z", to: "2026-06-26T12:00:00.000Z" },
    totals,
    window: "today"
  };
}
