import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { UsageStatsDto } from "../../app/daemonClient";
import { SidebarUsageStats } from "../SidebarUsageStats";

describe("SidebarUsageStats", () => {
  test("renders compact today usage stats", () => {
    const html = renderToStaticMarkup(<SidebarUsageStats stats={stats({ sessions: 18, totalTokens: 184_000, toolCalls: 231, mcpQueries: 7 })} />);

    expect(html).toContain("Today");
    expect(html).toContain("Sessions");
    expect(html).toContain("18");
    expect(html).toContain("Tokens");
    expect(html).toContain("184K");
    expect(html).toContain("Tools");
    expect(html).toContain("231");
    expect(html).toContain("MCP");
    expect(html).toContain("7");
  });

  test("uses a dash when no tokens are present", () => {
    const html = renderToStaticMarkup(<SidebarUsageStats stats={stats({ totalTokens: 0 })} />);

    expect(html).toContain("Tokens");
    expect(html).toContain("<strong>-</strong>");
  });

  test("renders loading and unavailable states", () => {
    expect(renderToStaticMarkup(<SidebarUsageStats loading />)).toContain("Loading...");
    expect(renderToStaticMarkup(<SidebarUsageStats error="offline" />)).toContain("Usage unavailable");
  });
});

function stats(overrides: Partial<UsageStatsDto["totals"]> = {}): UsageStatsDto {
  return {
    activity: [],
    byModel: [],
    byProject: [],
    byRuntime: [],
    coverage: {
      currentEnrichments: 0,
      importedSessions: 0,
      mcpQueries: overrides.mcpQueries ?? 0,
      sessionsWithTokenUsage: 0,
      sessionsWithoutTokenUsage: 0,
      sources: 0
    },
    generatedAt: "2026-06-26T12:00:00.000Z",
    range: { from: "2026-06-26T00:00:00.000Z", to: "2026-06-26T12:00:00.000Z" },
    totals: {
      fileEffects: 0,
      inputTokens: 0,
      mcpQueries: 0,
      messages: 0,
      models: 0,
      outputTokens: 0,
      projects: 0,
      runtimes: 0,
      sessions: 0,
      tokenCoverageSessions: 0,
      tokenRows: 0,
      toolCalls: 0,
      totalTokens: 0,
      ...overrides
    },
    window: "today"
  };
}
