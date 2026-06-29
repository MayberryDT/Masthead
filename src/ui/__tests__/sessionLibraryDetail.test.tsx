import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { LogbookExcerpt, LogbookSessionDetail } from "../../app/daemonClient";
import type { SessionDossierDto } from "../../shared/sessionDossier";
import { SessionLibraryDetail } from "../SessionLibraryDetail";

describe("SessionLibraryDetail", () => {
  test("renders Logbook session detail in the shared modal shell", () => {
    const html = renderToStaticMarkup(
      <SessionLibraryDetail dossier={dossier()} excerpts={excerpts()} session={session()} onClose={() => undefined} />
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("modal-backdrop");
    expect(html).toContain("session-detail-modal logbook-detail-modal");
    expect(html).toContain("modal-scroll-frame");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("Session dossier");
    expect(html).toContain("Copy canonical ID");
    expect(html).toContain("Enrichment");
    expect(html).toContain("Transcript");
    expect(html).toContain("Advanced details");
    expect(html).toContain("OAuth route still fails");
    expect(html).not.toContain("src/app/App.tsx");
    expect(html).not.toContain("<h4>Files</h4>");
    expect(html).toContain('class="icon-button"');
    expect(html).not.toContain("surface-inline-action");
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

function dossier(): SessionDossierDto {
  return {
    attention: [],
    coverage: {
      level: "partial",
      transcript: {
        assistantMessages: 0,
        checkpoints: 0,
        fileEffects: 1,
        hasUsableTranscript: false,
        lowValueItems: 0,
        messages: 0,
        runtimeSignals: 0,
        toolCalls: 0,
        toolResults: 0,
        userMessages: 0
      },
      warnings: []
    },
    excerpts: [],
    files: [
      {
        basename: "App.tsx",
        displayPath: "src/app/App.tsx",
        effectKind: "modified",
        fileEffectId: "file-1",
        observedAt: "2026-06-25T23:05:00.000Z",
        path: "src/app/App.tsx",
        sourceRef: {},
        staged: false
      }
    ],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-06-25T23:12:00.000Z",
      lifecycle: "needs_attention",
      model: "gpt-5",
      models: ["gpt-5"],
      project: "Masthead",
      runtime: "codex",
      sessionId: "session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      startedAt: "2026-06-25T22:42:00.000Z",
      title: "Repair OAuth callback"
    },
    narrative: {
      objective: "Fix the OAuth return path.",
      outcome: "OAuth route still fails in one edge case.",
      technologies: ["vite"],
      topics: ["auth"],
      unresolved: ["verification missing"]
    },
    reuse: {
      canonicalSessionId: "session-1",
      copyableContext: "# Masthead Session Context",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source-session-1"
    },
    timeline: [],
    tools: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageRows: 0
    },
    verification: {
      commands: [],
      status: "missing",
      summary: "Changed files are present but no verification command was captured."
    }
  };
}
