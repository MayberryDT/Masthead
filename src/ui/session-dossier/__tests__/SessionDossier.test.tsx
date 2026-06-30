// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionDetailView } from "../../../core/types";
import type { SessionDossierDto } from "../../../shared/sessionDossier";
import { DossierTranscript } from "../DossierTranscript";
import { SessionDossier } from "../SessionDossier";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SessionDossier", () => {
  test("lays out the first advanced detail cards in one desktop row", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const advancedDetailsRule = css.match(/\.dossier-advanced-details\s*\{[^}]+\}/)?.[0] ?? "";
    const advancedPanelRule = css.match(/\.dossier-advanced-details\s*>\s*\.dossier-panel\s*\{[^}]+\}/)?.[0] ?? "";

    expect(advancedDetailsRule).toContain("grid-template-columns: repeat(6, minmax(0, 1fr));");
    expect(advancedPanelRule).toContain("grid-column: span 2;");
  });

  test("keeps token stats in the identity card and omits redundant advanced cards", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const identityCard = host.querySelector(".dossier-hero");
    expect(identityCard?.textContent).toContain("Total tokens");
    expect(identityCard?.textContent).toContain("Input tokens");
    expect(identityCard?.textContent).toContain("Output tokens");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const advancedHeadings = [...host.querySelectorAll(".dossier-advanced-details .dossier-panel h4")].map((heading) => heading.textContent);
    expect(advancedHeadings).not.toContain("Token usage");
    expect(advancedHeadings).not.toContain("Review actions");
    root.unmount();
  });

  test("makes the transcript panel tall without adding an outer panel scrollbar", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const transcriptRule = css.match(/\.dossier-panel-transcript\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptBodyRule = css.match(/\.dossier-panel-transcript\s+\.dossier-panel-body\s*\{[^}]+\}/)?.[0] ?? "";
    const transcriptResultsRule = css.match(/\.dossier-transcript-results\s*\{[^}]+\}/)?.[0] ?? "";

    expect(transcriptRule).toContain("max-height:");
    expect(transcriptBodyRule).toContain("overflow: visible;");
    expect(transcriptResultsRule).toContain("min-height:");
  });

  test("centers the timeline load-more action at the bottom of its panel", async () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const footerActionRule = css.match(/\.dossier-panel-body\s*>\s*\.dossier-panel-footer-action\s*\{[^}]+\}/)?.[0] ?? "";
    const host = document.createElement("div");
    const root = createRoot(host);
    const currentDossier = dossier();
    currentDossier.timeline = Array.from({ length: 32 }, (_, index) => ({
      eventId: `event-${index}`,
      kind: "tool" as const,
      label: "tool",
      observedAt: `2026-06-25T23:${String(index % 60).padStart(2, "0")}:00.000Z`,
      summary: `Command ${index}`
    }));

    await act(async () => {
      root.render(<SessionDossier dossier={currentDossier} />);
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const showMore = [...host.querySelectorAll("button")].find((item) => item.textContent === "Show 2 more");
    expect(showMore?.classList.contains("dossier-panel-footer-action")).toBe(true);
    expect(footerActionRule).toContain("justify-self: center;");
    root.unmount();
  });

  test("caps dossier panels and scrolls panel bodies", () => {
    const css = readFileSync("src/styles/session-dossier.css", "utf8");
    const panelRules = [...css.matchAll(/\.dossier-panel\s*\{[^}]+\}/g)].map((match) => match[0]);
    const panelBodyRule = css.match(/\.dossier-panel-body\s*\{[^}]+\}/)?.[0] ?? "";

    expect(panelRules.some((rule) => rule.includes("max-height:"))).toBe(true);
    expect(panelRules.some((rule) => rule.includes("overflow: hidden;"))).toBe(true);
    expect(panelBodyRule).toContain("overflow: auto;");
  });

  test("keeps panel headers outside the scrollable panel body", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const panels = [...host.querySelectorAll(".dossier-panel")];
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((panel) => panel.children[0]?.tagName === "H4")).toBe(true);
    expect(panels.every((panel) => panel.children[1]?.classList.contains("dossier-panel-body"))).toBe(true);
    root.unmount();
  });

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
    expect(html).toContain("Total tokens");
    expect(html).toContain("Input tokens");
    expect(html).toContain("Output tokens");
    expect(html).toContain("Session summary");
    expect(html).toContain("dossier-panel-primary");
    expect(html).toContain("Transcript summary");
    expect(html).toContain("OAuth route still fails for missing state.");
    expect(html).not.toContain("Objective:");
    expect(html).not.toContain("Outcome:");
    expect(html).not.toContain(">Objective<");
    expect(html).not.toContain(">Outcome<");
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

  test("keeps copy actions in the identity card and centers advanced details below the dossier", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<SessionDossier dossier={dossier()} />);
    });

    expect(host.textContent).not.toContain("Copies canonical session context for reuse.");
    const copyActions = host.querySelector(".dossier-hero-actions");
    expect(copyActions?.textContent).toContain("Copy context");
    expect(copyActions?.textContent).toContain("Copy canonical ID");
    expect(copyActions?.textContent).toContain("Copy source ID");
    expect(copyActions?.textContent).not.toContain("Advanced details");

    const advancedButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Advanced details");
    expect(advancedButton).toBeTruthy();
    expect(advancedButton?.closest(".dossier-hero")).toBeNull();
    expect(advancedButton?.closest(".dossier-advanced-footer")).toBeTruthy();
    root.unmount();
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

  test("does not render review actions in advanced details", async () => {
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

    expect(host.textContent).not.toContain("Dismiss");
    expect(host.textContent).not.toContain("Mark reviewed");
    expect(host.textContent).not.toContain("Marked reviewed.");
    expect(host.textContent).not.toContain("Review actions");
    expect(host.textContent).not.toContain("Open source");
    expect(host.textContent).not.toContain("Open repo");
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

    expect(writeText).toHaveBeenCalledWith("# Masthead Session Context\nSummary: OAuth route still fails in one edge case.\nAgent retrieval: included");
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

  test("loads more transcript items from the scroll sentinel instead of a button", async () => {
    const onLoadMore = vi.fn();
    const OriginalIntersectionObserver = globalThis.IntersectionObserver;
    const observers: MockIntersectionObserver[] = [];
    const host = document.createElement("div");
    const root = createRoot(host);
    globalThis.IntersectionObserver = class extends MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        observers.push(this);
      }
    } as typeof IntersectionObserver;

    try {
      await act(async () => {
        root.render(
          <DossierTranscript
            filter="all"
            query=""
            onFilterChange={() => undefined}
            onLoadMore={onLoadMore}
            onQueryChange={() => undefined}
            onRetry={() => undefined}
            sessionId="canonical-session-1"
            transcript={{
              coverage: dossier().coverage.transcript,
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
                }
              ],
              nextCursor: "cursor-2",
              total: 2
            }}
          />
        );
      });

      expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Load more")).toBe(false);
      expect(host.querySelector(".dossier-transcript-sentinel")).toBeTruthy();
      expect(observers.length).toBe(1);

      await act(async () => {
        observers[0]?.trigger(true);
      });

      expect(onLoadMore).toHaveBeenCalledTimes(1);
    } finally {
      root.unmount();
      globalThis.IntersectionObserver = OriginalIntersectionObserver;
    }
  });
});

class MockIntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  private callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? "";
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
  }

  disconnect() {
    this.target = undefined;
  }

  observe(target: Element) {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    if (this.target === target) this.target = undefined;
  }

  trigger(isIntersecting: boolean) {
    if (!this.target) return;
    this.callback([{ isIntersecting, target: this.target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

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
      copyableContext: "# Masthead Session Context\nSummary: OAuth route still fails in one edge case.\nAgent retrieval: included",
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
