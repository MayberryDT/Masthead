// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionCardView } from "../../core/types";
import { SessionCard } from "../SessionCard";
import { SessionBoard } from "../SessionBoard";
import { sessionDemoTelemetry } from "../observabilityDemo";

describe("observability session card", () => {
  test("renders compact reference facts without prototype telemetry rows", () => {
    const html = renderToStaticMarkup(
      <SessionCard session={session()} onToggle={() => undefined} demoTelemetry={sessionDemoTelemetry("session-1", 0)} />
    );

    expect(html).toContain("Masthead · 08:04 PM");
    expect(html).toContain("Refactor auth flow");
    expect(html).toContain("Active");
    expect(html).toContain("8m 42s");
    expect(html).toContain("Runtime");
    expect(html).toContain("Tokens");
    expect(html).toContain("126.7M");
    expect(html).toContain("Duration");
    expect(html).toContain("card-harness");
    expect(html).toContain("Model");
    expect(html).toContain("Worktree");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("High");
    expect(html).toContain("Last activity");
    expect(html).not.toContain("Started");
    expect(html).not.toContain("5 files");
    expect(html).not.toContain("Commands / Tests");
    expect(html).not.toContain("Files Changed");
    expect(html).not.toContain("Progress");
    expect(html).not.toContain("Host");
    expect(html).not.toContain("file-bars");
    expect(html).not.toContain("Demo data");
  });

  test("uses a project and work-area label in the header without synthetic id chrome", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          sessionId: "019ef651-e3bf-7000-a123-123456789abc",
          title: "Build SEO system on Halla",
          workContext: {
            label: "SEO system work",
            confidence: "event_summary",
            pathClusters: ["content"],
            sourceSignals: ["event:seo"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Masthead · SEO system work");
    expect(html).not.toContain("s-019ef651");
    expect(html).not.toContain("⇄");
    expect(html).not.toContain("☆");
  });

  test("does not surface boilerplate Codex session titles or category labels as the header label", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          project: "Halla",
          title: "Halla Codex session",
          workContext: {
            label: "SEO system work",
            confidence: "event_summary",
            pathClusters: ["content"],
            sourceSignals: ["event:seo"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Halla · SEO system work");
    expect(html).toContain("Refactor auth flow");
    expect(html).not.toContain("Halla Codex session");
  });

  test("uses context in the header when the stored card title is a hook-event label", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          copy: {
            headline: "Updated section auto-rotation stops.",
            reason: "This summary is persisted with the canonical Masthead session record.",
            source: "enrichment",
            status: "Review is pending."
          },
          title: "Codex hook event",
          workContext: {
            label: "UI polish",
            confidence: "path_cluster",
            pathClusters: ["ui"],
            sourceSignals: ["path:ui"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Masthead · UI polish");
    expect(html).toContain("Updated section auto-rotation stops.");
    expect(html).not.toContain("Codex hook event");
  });

  test("uses context in the header when the stored card title is an opaque session id", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          copy: {
            headline: "Added v2 session narrative facts, validator, deterministic draft.",
            reason: "This summary is persisted with the canonical Masthead session record.",
            source: "enrichment",
            status: "Work is active."
          },
          title: "019f0626-012e-7251-aaa6-e5aedba59bf3 session",
          workContext: {
            label: "Narrative quality",
            confidence: "event_summary",
            pathClusters: ["enrichment"],
            sourceSignals: ["event:narrative"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Masthead · Narrative quality");
    expect(html).toContain("Added v2 session narrative facts, validator, deterministic draft.");
    expect(html).not.toContain("019f0626-012e-7251-aaa6-e5aedba59bf3 session");
  });

  test("renders blocked badge without redundant blocked fields", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "ended",
          primaryStatus: "blocked",
          stateLabel: "Blocked",
          indicators: ["attention"],
          attentionReason: "Timeout waiting for response"
        })}
        onToggle={() => undefined}
        demoTelemetry={sessionDemoTelemetry("session-blocked", 1)}
      />
    );

    expect(html).toContain("Blocked");
    expect(html).not.toContain("Blocked Reason");
    expect(html).not.toContain("Blocked At");
    expect(html).not.toContain("Timeout waiting for response");
  });

  test("does not label ended sessions as active", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          outcomeLabel: "completed",
          stateLabel: "Completed",
          indicators: []
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Turn complete");
    expect(html).not.toContain(">Active<");
  });

  test("marks newly created cards for entry animation", () => {
    const html = renderToStaticMarkup(<SessionCard session={session()} isNew newCardIndex={2} onToggle={() => undefined} />);

    expect(html).toContain("is-new-card");
    expect(html).toContain("--new-card-index:2");
  });

  test("only marks cards added after the board has mounted as new", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SessionBoard cards={[session({ sessionId: "session-1" })]} variant="observability" />);
    });

    expect(container.querySelector('[data-session-id="session-1"]')?.className).not.toContain("is-new-card");

    await act(async () => {
      root.render(
        <SessionBoard
          cards={[session({ sessionId: "session-1" }), session({ sessionId: "session-2", title: "Second session" })]}
          variant="observability"
        />
      );
    });

    expect(container.querySelector('[data-session-id="session-1"]')?.className).not.toContain("is-new-card");
    expect(container.querySelector('[data-session-id="session-2"]')?.className).toContain("is-new-card");

    await act(async () => root.unmount());
  });

  test("animates existing cards when their visible order changes", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const animations: Array<{ sessionId: string; keyframes: Keyframe[] | PropertyIndexedKeyframes | null }> = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const siblings = Array.from(this.parentElement?.querySelectorAll<HTMLElement>(".session-card[data-session-id]") ?? []);
      const index = Math.max(0, siblings.indexOf(this));
      return testRect(0, index * 240);
    };
    HTMLElement.prototype.animate = vi.fn(function (
      this: HTMLElement,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      _options?: number | KeyframeAnimationOptions
    ) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push({ sessionId, keyframes });
      return { addEventListener: vi.fn() } as unknown as Animation;
    });

    try {
      const first = session({ sessionId: "session-1", title: "First session" });
      const second = session({ sessionId: "session-2", title: "Second session" });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });

      expect(animations).toEqual([]);

      await act(async () => {
        root.render(<SessionBoard cards={[second, first]} variant="observability" />);
      });

      expect(animations.map((animation) => animation.sessionId).sort()).toEqual(["session-1", "session-2"]);
      expect(JSON.stringify(animations.find((animation) => animation.sessionId === "session-2")?.keyframes)).toContain(
        "translate(0px, 240px)"
      );
      expect(JSON.stringify(animations.find((animation) => animation.sessionId === "session-1")?.keyframes)).toContain(
        "translate(0px, -240px)"
      );
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
    }
  });

  test("falls back to inline transform animation when Element.animate is unavailable", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const siblings = Array.from(this.parentElement?.querySelectorAll<HTMLElement>(".session-card[data-session-id]") ?? []);
      const index = Math.max(0, siblings.indexOf(this));
      return testRect(0, index * 240);
    };
    (HTMLElement.prototype as { animate?: HTMLElement["animate"] }).animate = undefined;
    window.requestAnimationFrame = vi.fn(() => 1);

    try {
      const first = session({ sessionId: "session-1", title: "First session" });
      const second = session({ sessionId: "session-2", title: "Second session" });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[second, first]} variant="observability" />);
      });

      const movedCard = container.querySelector<HTMLElement>('[data-session-id="session-2"]');
      expect(movedCard?.className).toContain("is-layout-animating");
      expect(movedCard?.style.transform).toContain("translate(0px, 240px)");
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  test("does not animate same-order headline refreshes as card moves", async () => {
    const originalAnimate = HTMLElement.prototype.animate;
    const animations: string[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push(sessionId);
      return { addEventListener: vi.fn() } as unknown as Animation;
    });

    try {
      const first = session({ sessionId: "session-1", copy: { ...session().copy, headline: "First headline" } });
      const second = session({ sessionId: "session-2", copy: { ...session().copy, headline: "Second headline" } });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });

      await act(async () => {
        root.render(
          <SessionBoard
            cards={[
              { ...first, copy: { ...first.copy, headline: "First headline refreshed" } },
              { ...second, copy: { ...second.copy, headline: "Second headline refreshed" } }
            ]}
            variant="observability"
          />
        );
      });

      expect(animations).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.animate = originalAnimate;
    }
  });

  test("skips reorder animation when reduced motion is requested", async () => {
    const originalAnimate = HTMLElement.prototype.animate;
    const originalMatchMedia = window.matchMedia;
    const animate = vi.fn(function () {
      return { addEventListener: vi.fn() } as unknown as Animation;
    });
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.animate = animate;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      })
    });

    try {
      const first = session({ sessionId: "session-1", title: "First session" });
      const second = session({ sessionId: "session-2", title: "Second session" });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[second, first]} variant="observability" />);
      });

      expect(animate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.animate = originalAnimate;
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia
      });
    }
  });

  test("stagger-types changed headlines on existing cards", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const first = session({
      sessionId: "session-1",
      copy: { ...session().copy, headline: "First old headline" }
    });
    const second = session({
      sessionId: "session-2",
      copy: { ...session().copy, headline: "Second old headline" }
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });

      await act(async () => {
        root.render(
          <SessionBoard
            cards={[
              { ...first, copy: { ...first.copy, headline: "First updated headline" } },
              { ...second, copy: { ...second.copy, headline: "Second updated headline" } }
            ]}
            variant="observability"
          />
        );
      });

      const headlines = Array.from(container.querySelectorAll<HTMLElement>(".card-headline"));
      expect(headlines[0]?.textContent).toContain("First old headline");
      expect(headlines[1]?.textContent).toContain("Second old headline");

      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(headlines[0]?.className).toContain("is-headline-typing");
      expect(headlines[1]?.textContent).toContain("Second old headline");

      await act(async () => {
        vi.advanceTimersByTime(80);
      });

      expect(headlines[1]?.className).toContain("is-headline-typing");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(headlines[0]?.textContent).toContain("First updated headline");
      expect(headlines[1]?.textContent).toContain("Second updated headline");
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  test("falls back from raw serialized or command-like headlines", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          copy: {
            headline: "{\"type\":\"response_item\",\"payload\":{\"command\":\"npm test\"}}",
            reason: "Raw event text should not be used as card copy.",
            source: "deterministic",
            status: "Captured"
          },
          project: "Masthead",
          title: "Import correctness"
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Import correctness");
    expect(html).not.toContain("response_item");
    expect(html).not.toContain("npm test");
  });

  test("does not render approval-pending sessions as blocked", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "running",
          primaryStatus: "waiting_for_approval",
          stateLabel: "Needs approval",
          indicators: ["attention"]
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain(">Active<");
    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("needs-attention");
  });

  test("does not apply demo harness or model values to live observability cards", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[session({ thinkingLevel: undefined })]} variant="observability" onOpenSession={() => undefined} />
    );

    expect(html).toContain("Codex");
    expect(html).toContain("Not captured");
    expect(html).not.toContain("High");
    expect(html).not.toContain("Claude Code");
    expect(html).not.toContain("OpenClaw");
    expect(html).not.toContain("Hermes");
    expect(html).not.toContain("gpt-5.5");
    expect(html).not.toContain("gpt-5.4");
  });

  test("applies compact density to the observability card grid", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[session()]} variant="observability" density="compact" onOpenSession={() => undefined} />
    );

    expect(html).toContain("observability-card-grid compact");
  });

  test("renders captured live model values without demo telemetry", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[session({ model: "gpt-5.5" })]} variant="observability" onOpenSession={() => undefined} />
    );

    expect(html).toContain("gpt-5.5");
    expect(html).not.toContain("OpenClaw");
    expect(html).not.toContain("Hermes");
  });

  test("does not render captured thinking values as a primary card fact", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[session({ thinkingLevel: "Extra High" })]} variant="observability" onOpenSession={() => undefined} />
    );

    expect(html).not.toContain("Extra High");
  });

  test("uses the actual branch or none for the worktree fact instead of the summary label", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          branchOrWorktree: undefined,
          project: "Masthead",
          workContext: {
            label: "UI work",
            confidence: "path_cluster",
            pathClusters: ["ui"],
            sourceSignals: ["path:ui"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("None");
    expect(html).not.toContain("UI work</dd>");
    expect(html).not.toContain("Masthead</dd>");
  });
});

function session(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Raw title",
    copy: {
      headline: "Refactor auth flow",
      status: "Added token refresh logic",
      reason: "Work is moving through implementation.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 10,
    durationLabel: "8m 42s",
    totalTokens: 126_700_000,
    branchOrWorktree: "local",
    thinkingLevel: "High",
    lastActivity: "2026-06-23T02:04:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 5,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}

function testRect(left: number, top: number): DOMRect {
  const width = 320;
  const height = 218;
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect;
}
