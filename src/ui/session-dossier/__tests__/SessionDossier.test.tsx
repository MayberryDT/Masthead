// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionDetailView } from "../../../core/types";
import type { SessionDossierDto } from "../../../shared/sessionDossier";
import { SessionDossier } from "../SessionDossier";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SessionDossier", () => {
  test("renders canonical session evidence and copy actions", () => {
    const currentDossier = dossier();
    const html = renderToStaticMarkup(
      <SessionDossier
        dossier={currentDossier}
        transcript={{
          coverage: currentDossier.coverage.transcript,
          items: [
            {
              itemId: "message-1",
              kind: "message",
              label: "user",
              lowValue: false,
              observedAt: "2026-06-25T23:01:00.000Z",
              role: "user",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "Please repair the OAuth callback."
            },
            {
              itemId: "file-effect-1",
              kind: "file_effect",
              label: "src/app/App.tsx",
              lowValue: false,
              observedAt: "2026-06-25T23:04:00.000Z",
              role: "tool",
              sessionId: "canonical-session-1",
              sourceRef: {},
              text: "src/app/App.tsx"
            }
          ],
          total: 2
        }}
      />
    );

    expect(html).toContain("Session identity");
    expect(html).not.toContain("<h3>Repair OAuth callback</h3>");
    expect(html).toContain("Tokens");
    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("Enrichment");
    expect(html).toContain("dossier-panel-primary");
    expect(html).toContain("Objective: Fix the OAuth return path. Outcome: OAuth route still fails in one edge case.");
    expect(html).toContain("Fix the OAuth return path.");
    expect(html).toContain("Transcript");
    expect(html).toContain("dossier-panel-transcript");
    expect(html).toContain("dossier-transcript-results");
    expect(html).toContain("Please repair the OAuth callback.");
    expect(html).toContain("Advanced details");
    expect(html).toContain("dossier-hero-actions");
    expect(html).toContain("Copy context");
    expect(html).toContain("Copy canonical ID");
    expect(html).toContain("Copy source ID");
    expect(html).not.toContain("<h4>Context packet</h4>");
    expect(html).not.toContain("<h4>Files</h4>");
    expect(html).not.toContain("<h4>Tools</h4>");
    expect(html).not.toContain("<h4>Timeline</h4>");
    expect(html).not.toContain("<h4>Verification</h4>");
    expect(html).not.toContain("<h4>Needs attention</h4>");
    expect(html).not.toContain("src/app/App.tsx");
    expect(html).not.toContain("File ");
    expect(html).not.toContain("Open source");
    expect(html).not.toContain("Open repo");
  });

  test("hides raw system and bracket metadata from the default transcript but keeps raw access in advanced details", async () => {
    const rawPrompt = [
      "# AGENTS.md instructions for /tmp/Masthead",
      "<INSTRUCTIONS>",
      "# Codex Behavioral Guidelines",
      "Do not show this repository instruction block by default.",
      "</INSTRUCTIONS>",
      "<environment_context>",
      "<cwd>/tmp/Masthead</cwd>",
      "</environment_context>",
      "Please repair [system: hidden metadata] the OAuth callback and keep array[index] readable."
    ].join("\n");
    const rawPermissions = "Filesystem sandboxing defines which files can be read or written. Network access is restricted.";
    const currentDossier = dossier();
    currentDossier.narrative.firstUserPrompt = rawPrompt;
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SessionDossier
          dossier={currentDossier}
          transcript={{
            coverage: currentDossier.coverage.transcript,
            items: [
              {
                itemId: "message-raw",
                kind: "message",
                label: "user",
                lowValue: false,
                observedAt: "2026-06-25T23:01:00.000Z",
                role: "user",
                sessionId: "canonical-session-1",
                sourceRef: {},
                text: rawPrompt
              },
              {
                itemId: "message-permissions",
                kind: "message",
                label: "unknown",
                lowValue: false,
                observedAt: "2026-06-25T23:02:00.000Z",
                role: "unknown",
                sessionId: "canonical-session-1",
                sourceRef: {},
                text: rawPermissions
              }
            ],
            total: 2
          }}
        />
      );
    });

    expect(host.textContent).toContain("Please repair the OAuth callback and keep array[index] readable.");
    expect(host.textContent).not.toContain("AGENTS.md");
    expect(host.textContent).not.toContain("Codex Behavioral Guidelines");
    expect(host.textContent).not.toContain("system: hidden metadata");
    expect(host.textContent).not.toContain("Filesystem sandboxing defines");

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Raw transcript");
    expect(host.textContent).toContain("AGENTS.md");
    expect(host.textContent).toContain("system: hidden metadata");
    expect(host.textContent).toContain("Filesystem sandboxing defines");
    root.unmount();
  });

  test("opens advanced evidence on demand", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    expect(host.textContent).not.toContain("Narrative evidence");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Verification");
    expect(host.textContent).toContain("Tools");
    expect(host.textContent).toContain("Timeline");
    expect(host.textContent).toContain("Narrative evidence");
    expect(host.textContent).not.toContain("Files");
    expect(host.textContent).not.toContain("File ");
    expect(host.textContent).not.toContain("src/app/App.tsx");
    root.unmount();
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

  test("limits live-only actions to safe review actions", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier live={liveSession()} onAction={() => undefined} actionStatus="Marked reviewed." />);
    });

    expect(host.textContent).toContain("Canonical details unavailable");
    expect(host.textContent).not.toContain("Dismiss");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("Dismiss");
    expect(host.textContent).toContain("Mark reviewed");
    expect(host.textContent).not.toContain("Open source");
    expect(host.textContent).not.toContain("Open repo");
    expect(host.textContent).toContain("Marked reviewed.");
    root.unmount();
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

  test("wires transcript search input to the caller", async () => {
    const onQueryChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SessionDossier
          dossier={dossier()}
          onTranscriptQueryChange={onQueryChange}
          transcript={{
            coverage: dossier().coverage.transcript,
            items: [],
            total: 0
          }}
          transcriptQuery=""
        />
      );
    });

    const input = host.querySelector("input[type='search']");
    expect(input).toBeTruthy();
    await act(async () => {
      setNativeInputValue(input as HTMLInputElement, "OAuth");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

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
      },
      {
        eventId: "event-file",
        kind: "file",
        label: "file changed",
        observedAt: "2026-06-25T23:06:00.000Z",
        sourceRef: { id: "event-file", kind: "file", source: "timeline" },
        summary: "src/app/App.tsx"
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
