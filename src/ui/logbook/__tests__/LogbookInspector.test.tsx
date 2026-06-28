import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { LogbookExcerpt, LogbookSessionDetail } from "../../../app/daemonClient";
import { LogbookInspector } from "../LogbookInspector";

describe("LogbookInspector", () => {
  test("renders session details, provenance, unresolved work, and excerpts", () => {
    const html = renderToStaticMarkup(
      <LogbookInspector excerpts={excerpts()} session={session()} onClose={() => undefined} />
    );

    expect(html).toContain("Session detail");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("Masthead");
    expect(html).toContain("Codex");
    expect(html).toContain("Lifecycle");
    expect(html).toContain("Needs Attention");
    expect(html).toContain("Source provenance");
    expect(html).toContain("host:test");
    expect(html).toContain("source-session-1");
    expect(html).toContain("Repo: /home/tyler/Documents/Masthead");
    expect(html).toContain("Worktree: /home/tyler/Documents/Masthead");
    expect(html).toContain("Included");
    expect(html).toContain("Authoritative");
    expect(html).not.toContain("Files");
    expect(html).not.toContain("src/app/App.tsx");
    expect(html).toContain("npm");
    expect(html).toContain("verification missing");
    expect(html).toContain("Relevant excerpts");
    expect(html).toContain("OAuth route still fails");
  });

  test("renders loading state while detail request is in flight", () => {
    const html = renderToStaticMarkup(<LogbookInspector excerpts={[]} loading onClose={() => undefined} />);

    expect(html).toContain("Loading session");
    expect(html).toContain("Loading session detail");
  });
});

function session(): LogbookSessionDetail {
  return {
    branch: "agent/logbook",
    durationMs: 1_800_000,
    endedAt: "2026-06-25T23:12:00.000Z",
    enrichmentStatus: "current",
    errorCount: 1,
    fileCount: 2,
    files: ["src/app/App.tsx", "src/ui/logbook/LogbookInspector.tsx"],
    hostId: "host:test",
    lastActivityAt: "2026-06-25T23:12:00.000Z",
    lifecycle: "needs_attention",
    mcpIncluded: true,
    models: ["gpt-5"],
    objective: "Fix the OAuth return path.",
    outcome: "OAuth route still fails in one edge case.",
    project: "Masthead",
    repoRoot: "/home/tyler/Documents/Masthead",
    runtime: "codex",
    sessionId: "session-1",
    sourceConfidence: "authoritative",
    sourceProvenance: {
      hostId: "host:test",
      runtime: "codex",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1"
    },
    sourceSessionId: "source-session-1",
    startedAt: "2026-06-25T22:42:00.000Z",
    title: "Repair OAuth callback",
    toolCount: 7,
    tools: ["npm", "vite"],
    topics: ["auth", "oauth"],
    unresolved: ["verification missing"],
    worktreePath: "/home/tyler/Documents/Masthead"
  };
}

function excerpts(): LogbookExcerpt[] {
  return [
    {
      excerptId: "excerpt-1",
      kind: "message",
      observedAt: "2026-06-25T23:00:00.000Z",
      role: "assistant",
      sourceRef: { line: 42 },
      text: "OAuth route still fails for missing state."
    }
  ];
}
