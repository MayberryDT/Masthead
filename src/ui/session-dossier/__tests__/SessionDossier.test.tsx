// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionDetailView } from "../../../core/types";
import type { SessionDossierDto } from "../../../shared/sessionDossier";
import { SessionDossier } from "../SessionDossier";

describe("SessionDossier", () => {
  test("renders canonical session evidence and copy actions", () => {
    const html = renderToStaticMarkup(<SessionDossier dossier={dossier()} />);

    expect(html).toContain("Session dossier");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("Fix the OAuth return path.");
    expect(html).toContain("npm test");
    expect(html).toContain("src/app/App.tsx");
    expect(html).toContain("tests passed");
    expect(html).toContain("Transcript excerpts");
    expect(html).toContain("Transcript");
    expect(html).toContain("Please repair the OAuth callback.");
    expect(html).toContain("First prompt");
    expect(html).toContain("OAuth route still fails for missing state.");
    expect(html).toContain("Input tokens");
    expect(html).toContain("Narrative evidence");
    expect(html).toContain("session-capsule-v2");
    expect(html).toContain("codex · event · source-ref-1");
    expect(html).toContain("timeline · tool · event-1");
    expect(html).toContain("User");
    expect(html).toContain("Assistant");
    expect(html).toContain("Copy context");
    expect(html).toContain("Canonical ID");
    expect(html).toContain("source-session-1");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("Open repo");
  });

  test("renders coverage warning and sparse transcript CTA", () => {
    const openSources = vi.fn();
    const sparse = dossier();
    sparse.coverage = {
      level: "hook_only",
      transcript: {
        assistantMessages: 0,
        checkpoints: 0,
        fileEffects: 0,
        hasUsableTranscript: false,
        lowValueItems: 4,
        messages: 1,
        runtimeSignals: 2,
        toolCalls: 1,
        toolResults: 0,
        userMessages: 1
      },
      warnings: [
        {
          action: { label: "Import transcripts in Sources", target: "sources" },
          code: "transcript_missing",
          message: "Full transcript messages are not available for this session."
        }
      ]
    };

    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={sparse}
        onOpenSources={openSources}
        transcript={{
          coverage: sparse.coverage.transcript,
          items: [
            {
              itemId: "m1",
              kind: "message",
              label: "user",
              lowValue: true,
              observedAt: "2026-06-25T23:01:00.000Z",
              role: "user",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "Codex hook event"
            }
          ],
          total: 1
        }}
      />
    );

    expect(html).toContain("Hook events only");
    expect(html).toContain("No usable transcript messages imported.");
    expect(html).toContain("Import transcripts in Sources");
  });

  test("groups repeated low-value transcript rows", () => {
    const transcriptItems = Array.from({ length: 4 }, (_, index) => ({
      itemId: `low-${index}`,
      kind: "message" as const,
      label: "user",
      lowValue: true,
      observedAt: `2026-06-25T23:0${index}:00.000Z`,
      role: "user" as const,
      sessionId: "canonical-session-1",
      sourceRef: {},
      text: "Codex hook event"
    }));
    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={dossier()}
        transcript={{
          coverage: {
            assistantMessages: 0,
            checkpoints: 0,
            fileEffects: 0,
            hasUsableTranscript: false,
            lowValueItems: 4,
            messages: 4,
            runtimeSignals: 0,
            toolCalls: 0,
            toolResults: 0,
            userMessages: 4
          },
          items: transcriptItems,
          total: 4
        }}
      />
    );

    expect(html).toContain("4 low-value Codex hook event events captured");
  });

  test("limits live-only actions to safe review actions", () => {
    const html = renderToStaticMarkup(
      <SessionDossier live={liveSession()} onAction={() => undefined} actionStatus="Marked reviewed." />
    );

    expect(html).toContain("Canonical details unavailable");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Mark reviewed");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("Open repo");
    expect(html).toContain("Marked reviewed.");
  });

  test("copies the canonical context packet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Copy context");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith("# Masthead Session Context\nMCP included: yes");
    expect(host.textContent).toContain("Copied.");
    root.unmount();
  });
});

function dossier(): SessionDossierDto {
  return {
    attention: [
      {
        kind: "missing_verification",
        severity: "P2",
        sourceRefs: [],
        title: "Verification not captured"
      }
    ],
    coverage: {
      level: "complete",
      transcript: {
        assistantMessages: 1,
        checkpoints: 0,
        fileEffects: 1,
        hasUsableTranscript: true,
        lowValueItems: 0,
        messages: 2,
        runtimeSignals: 0,
        toolCalls: 1,
        toolResults: 1,
        userMessages: 1
      },
      warnings: []
    },
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
      lifecycle: "idle",
      model: "gpt-5",
      models: ["gpt-5"],
      project: "Masthead",
      runtime: "codex",
      sessionId: "canonical-session-1",
      sourceConfidence: "authoritative",
      sourceSessionId: "source-session-1",
      startedAt: "2026-06-25T22:42:00.000Z",
      title: "Repair OAuth callback"
    },
    narrative: {
      finalAssistantMessage: "OAuth route still fails for missing state.",
      firstUserPrompt: "Please repair the OAuth callback.",
      latestUserPrompt: "Can you verify the missing state edge case?",
      liveSummary: "Callback repair is being verified.",
      narrativeDebug: {
        model: "gpt-5-nano",
        promptVersion: "session-capsule-v2",
        provider: "openai",
        sourceRefs: [{ id: "source-ref-1", kind: "event", observedAt: "2026-06-25T23:00:00.000Z", source: "codex" }],
        subjectConfidence: "high",
        subjectSource: "message",
        titleSource: "objective",
        validationWarnings: []
      },
      objective: "Fix the OAuth return path.",
      outcome: "OAuth route still fails in one edge case.",
      technologies: ["vite"],
      topics: ["auth"],
      unresolved: ["missing state"]
    },
    excerpts: [
      {
        excerptId: "excerpt-1",
        kind: "message",
        observedAt: "2026-06-25T23:01:00.000Z",
        role: "user",
        sourceRef: {},
        text: "Please repair the OAuth callback."
      },
      {
        excerptId: "excerpt-2",
        kind: "message",
        observedAt: "2026-06-25T23:08:00.000Z",
        role: "assistant",
        sourceRef: {},
        text: "OAuth route still fails for missing state."
      }
    ],
    reuse: {
      canonicalSessionId: "canonical-session-1",
      copyableContext: "# Masthead Session Context\nMCP included: yes",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source-session-1"
    },
    timeline: [
      {
        eventId: "event-user",
        kind: "user",
        label: "user",
        observedAt: "2026-06-25T23:01:00.000Z",
        summary: "Please repair the OAuth callback."
      },
      {
        eventId: "event-assistant",
        kind: "assistant",
        label: "assistant",
        observedAt: "2026-06-25T23:08:00.000Z",
        summary: "OAuth route still fails for missing state."
      },
      {
        eventId: "event-1",
        kind: "tool",
        label: "succeeded",
        observedAt: "2026-06-25T23:07:00.000Z",
        sourceRef: { id: "event-1", kind: "tool", source: "timeline" },
        summary: "npm test"
      }
    ],
    tools: [
      {
        completedAt: "2026-06-25T23:07:00.000Z",
        outputPreview: "tests passed",
        sourceRef: {},
        status: "succeeded",
        toolCallId: "tool-1",
        toolName: "npm test"
      }
    ],
    usage: {
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
      usageRows: 1
    },
    verification: {
      commands: [
        {
          completedAt: "2026-06-25T23:07:00.000Z",
          outputPreview: "tests passed",
          sourceRef: {},
          status: "succeeded",
          toolCallId: "tool-1",
          toolName: "npm test"
        }
      ],
      status: "passed",
      summary: "Verification commands passed."
    }
  };
}

function liveSession(): SessionDetailView {
  return {
    attentionItems: [],
    changedFileCount: 1,
    conflicts: [],
    copy: {
      headline: "Live session title",
      reason: "Work is active.",
      source: "deterministic",
      status: "Review shared edits"
    },
    currentActivity: "Editing files",
    durationLabel: "4m",
    evidence: { inferred: [], missing: [], observed: [] },
    identityConfidence: "direct",
    indicators: [],
    isExpanded: true,
    lastActivity: "2026-06-25T23:12:00.000Z",
    lastActivityLabel: "0s ago",
    lifecycle: "running",
    primaryStatus: "editing",
    priorityRank: 10,
    project: "Masthead",
    reviewAnnotations: [],
    safeActions: ["open_source_session", "open_repo", "dismiss", "mark_reviewed"],
    sessionId: "live-session-1",
    stateLabel: "Editing",
    timeline: [],
    title: "Raw live title"
  };
}
