import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
    expect(html).toContain("modal-backdrop session-dossier-backdrop t-modal-backdrop is-opening");
    expect(html).toContain("session-detail-modal session-dossier-modal logbook-detail-modal t-modal is-opening");
    expect(html).not.toContain("is-closing");
    expect(html).toContain("modal-scroll-frame");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("Session dossier");
    expect(html).toContain("meta-rail");
    expect(html).toContain("Enrichment summary");
    expect(html).toContain("Transcript");
    expect(html).toContain("Advanced details");
    expect(html).toContain("OAuth route still fails");
    expect(html).not.toContain("src/app/App.tsx");
    expect(html).not.toContain("<h4>Files</h4>");
    expect(html).toContain("app-button-icon");
    expect(html).toContain("close");
    expect(html).not.toContain("surface-inline-action");
  });

  test("keeps dossier modal motion snappy and separate from the hinge modal animation", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");
    const openRule = cssRuleBody(css, ".session-detail-modal.session-dossier-modal.t-modal.is-open");
    const closingRule = cssRuleBody(css, ".session-detail-modal.session-dossier-modal.t-modal.is-closing");
    const backdropRule = cssRuleBody(css, ".session-dossier-backdrop.t-modal-backdrop.is-open,\n.session-dossier-backdrop.t-modal-backdrop.is-closing");
    const reducedMotionRule = cssRuleBodyContaining(
      css,
      "@media (prefers-reduced-motion: reduce)",
      ".session-detail-modal.session-dossier-modal.t-modal.is-closing"
    );

    expect(css).toContain("--modal-open-dur: 400ms;");
    expect(css).toContain("--modal-close-dur: 400ms;");
    expect(openRule).toContain("transform: translateY(0) scale(1);");
    expect(openRule).toContain("animation: usage-card-enter var(--modal-open-dur) cubic-bezier(0.17, 0.78, 0.13, 1) both;");
    expect(closingRule).toContain("transform: translateY(9px) scale(var(--modal-scale-close));");
    expect(closingRule).toContain("animation: session-dossier-card-exit var(--modal-close-dur) cubic-bezier(0.17, 0.78, 0.13, 1) both;");
    expect(backdropRule).toContain("animation: none;");
    expect(reducedMotionRule).toContain("transform: none !important;");
    expect(css).toMatch(/@keyframes session-dossier-card-exit\s*\{[\s\S]*transform: translateY\(0\) scale\(1\);[\s\S]*transform: translateY\(1px\) scale\(0\.999\);[\s\S]*transform: translateY\(-1px\) scale\(1\.004\);[\s\S]*transform: translateY\(9px\) scale\(0\.968\);/);
  });
});

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = css.indexOf(`${selector} {`);
  if (selectorIndex === -1) throw new Error(`Expected CSS rule for ${selector}`);
  const openBraceIndex = css.indexOf("{", selectorIndex + selector.length);
  if (openBraceIndex === -1) throw new Error(`Expected CSS rule for ${selector} to have a body`);
  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBraceIndex + 1, index);
    }
  }
  throw new Error(`Expected CSS rule for ${selector} to close`);
}

function cssRuleBodyContaining(css: string, ancestor: string, selector: string): string {
  const ancestorIndex = css.indexOf(ancestor);
  if (ancestorIndex === -1) throw new Error(`Expected CSS ancestor ${ancestor}`);
  const selectorIndex = css.indexOf(selector, ancestorIndex);
  if (selectorIndex === -1) throw new Error(`Expected CSS rule for ${selector} inside ${ancestor}`);
  const openBraceIndex = css.indexOf("{", selectorIndex + selector.length);
  if (openBraceIndex === -1) throw new Error(`Expected CSS rule for ${selector} to have a body`);
  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBraceIndex + 1, index);
    }
  }
  throw new Error(`Expected CSS rule for ${selector} to close`);
}

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
      narrativeDebug: {
        promptVersion: "session-capsule-v4",
        provider: "openai",
        sourceRefs: []
      },
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
