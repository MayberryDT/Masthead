// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { BoardHeadlineView } from "../../core/boardHeadlineFrame";
import type { SessionCardView } from "../../core/types";
import { SessionCard } from "../SessionCard";
import {
  SESSION_CARD_LAYOUT_COMPACT_PHASE_MS,
  SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS,
  SESSION_CARD_LAYOUT_DURATION_MS,
  SESSION_CARD_LAYOUT_EASING,
  SESSION_CARD_LAYOUT_EXPAND_DURATION_MS,
  SESSION_CARD_LAYOUT_STAGGER_MS,
  SessionBoard
} from "../SessionBoard";
import { stateClassName } from "../format";
import { sessionDemoTelemetry } from "../observabilityDemo";

describe("observability session card", () => {
  test("renders compact reference facts without prototype telemetry rows", () => {
    const referenceSession = session();
    const expectedHeaderTime = new Date(referenceSession.lastActivity).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const html = renderToStaticMarkup(
      <SessionCard session={referenceSession} onToggle={() => undefined} demoTelemetry={sessionDemoTelemetry("session-1", 0)} />
    );

    expect(html).toContain(`Masthead · ${expectedHeaderTime}`);
    expect(html).toContain("Board headlines: structured around subject and disposition.");
    expect(html).toContain("Active");
    expect(html).toContain("8m 42s");
    expect(html).toContain("Runtime");
    expect(html).toContain("Tokens");
    expect(html).toContain("126.7M");
    expect(html).toContain("Duration");
    expect(html).toContain("runtime-tag");
    expect(html).toContain("bottom-variant-card dovetail-card is-active tier-live");
    expect(html).toContain("bottom-signal");
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

  test("sets headline refresh stagger values without rendering legacy cursor chrome", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Magnetic slug lock copy")
        })}
        headlineUpdateIndex={2}
        onToggle={() => undefined}
      />
    );

    const card = host.querySelector<HTMLElement>(".session-card");
    expect(card?.classList.contains("is-headline-refreshing")).toBe(false);
    expect(card?.style.getPropertyValue("--headline-refresh-index")).toBe("2");
    expect(card?.querySelector(".headline-text.headline-current")?.textContent).toBe("Magnetic slug lock copy");
    expect(card?.querySelector(".card-headline-cursor")).toBeNull();
  });

  test("adds visual tier classes by operational state", () => {
    const active = renderToStaticMarkup(<SessionCard session={session({ lifecycle: "running", primaryStatus: "editing" })} />);
    const idle = renderToStaticMarkup(<SessionCard session={session({ lifecycle: "idle", primaryStatus: "stalled" })} />);
    const waiting = renderToStaticMarkup(
      <SessionCard session={session({ lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] })} />
    );
    const conflict = renderToStaticMarkup(
      <SessionCard session={session({ lifecycle: "running", primaryStatus: "editing", indicators: ["attention", "conflict"] })} />
    );

    expect(active).toContain("tier-live");
    expect(idle).toContain("tier-quiet");
    expect(waiting).toContain("is-waiting tier-action");
    expect(conflict).toContain("is-active tier-live");
    expect(conflict).not.toContain("tier-action");
  });

  test("orders headline source before runtime and state chips in the top line", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Local headline fallback.", { source: "offline" }),
          harness: "OpenCode",
          lifecycle: "idle",
          primaryStatus: "stalled",
          stateLabel: "Idle"
        })}
        onToggle={() => undefined}
      />
    );

    const chipText = Array.from(
      host.querySelectorAll(".card-topline .headline-source, .card-topline .runtime-tag, .card-topline .state-pill")
    ).map((chip) => chip.textContent);

    expect(chipText).toEqual(["Offline", "OpenCode", "Idle"]);
  });

  test("keeps stale attention on idle sessions visually quiet", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "idle",
          primaryStatus: "stalled",
          stateLabel: "Idle",
          indicators: ["attention"]
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("is-idle");
    expect(html).toContain("tier-quiet");
    expect(html).not.toContain("tier-action");
  });

  test("keeps true blockers in the blocked action visual tier", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({ lifecycle: "running", primaryStatus: "blocked", stateLabel: "Blocked", indicators: ["attention"] })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("is-blocked");
    expect(html).toContain("tier-action");
    expect(html).not.toContain("tier-quiet");
  });

  test.each([
    ["approval wait", "waiting_for_approval", "Needs approval"],
    ["user input wait", "waiting_for_user", "Needs input"]
  ] as const)("renders %s as waiting copy without blocked classes", (_name, primaryStatus, label) => {
    const html = renderToStaticMarkup(
      <SessionCard session={session({ lifecycle: "running", primaryStatus, stateLabel: label, indicators: ["attention"] })} onToggle={() => undefined} />
    );

    expect(html).toContain(`>${label}<`);
    expect(html).toContain("is-waiting");
    expect(html).toContain("tier-action");
    expect(html).not.toContain("is-active");
    expect(html).not.toContain("is-blocked");
    expect(html).not.toContain(">Blocked<");
    expect(html).not.toContain("tier-quiet");
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

  test("does not surface boilerplate OpenCode session titles or category labels as the header label", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          project: "Halla",
          title: "Halla OpenCode session",
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
    expect(html).toContain("Board headlines: structured around subject and disposition.");
    expect(html).not.toContain("Halla OpenCode session");
  });

  test("uses context in the header when the stored card title is a hook-event label", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Updated section auto-rotation stops.", { source: "enrichment" }),
          title: "OpenCode hook event",
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
    expect(html).not.toContain("OpenCode hook event");
  });

  test("uses work context as headline fallback when copy and title are weak", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Recent activity.", { source: "offline" }),
          title: "OpenCode hook event",
          workContext: {
            label: "Headline enrichment reliability",
            confidence: "event_summary",
            pathClusters: ["enrichment"],
            sourceSignals: ["event:headline"]
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Headline enrichment reliability");
    expect(html).not.toContain("Masthead session update");
  });

  test("uses context in the header when the stored card title is an opaque session id", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Added v2 session narrative facts, validator, deterministic draft.", { source: "enrichment" }),
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

    expect(html).toContain(">Idle<");
    expect(html).toContain("is-idle");
    expect(html).not.toContain(">Active<");
  });

  test("does not render failed running cards as blocked", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "running",
          primaryStatus: "failed",
          stateLabel: "Failed",
          indicators: ["attention"]
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain(">Active<");
    expect(html).not.toContain(">Blocked<");
    expect(html).not.toContain("needs-attention");
  });

  test("does not render conflict-only running cards as blocked", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          lifecycle: "running",
          primaryStatus: "editing",
          stateLabel: "Running",
          indicators: ["attention", "conflict"],
          attentionReason: "Same tracked path changed by 2 active sessions"
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain(">Active<");
    expect(html).not.toContain(">Blocked<");
    expect(html).not.toContain("needs-attention");
  });

  test("maps only real blockers to the blocked color class", () => {
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "editing", indicators: [] }))).toBe("running");
    expect(stateClassName(session({ lifecycle: "idle", primaryStatus: "stalled", indicators: [] }))).toBe("stalled");
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] }))).toBe("needs-attention");
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_user", indicators: ["attention"] }))).toBe("running");
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] }))).toBe("running");
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "editing", indicators: ["attention", "conflict"] }))).toBe(
      "running"
    );
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "failed", indicators: ["attention"] }))).toBe("running");
  });

  test("keeps exact mockup class names when a new-card hint is provided", () => {
    const html = renderToStaticMarkup(<SessionCard session={session()} isNew newCardIndex={2} onToggle={() => undefined} />);

    expect(html).toContain("session-card bottom-variant-card dovetail-card is-active tier-live is-new-card");
    expect(html).toContain("--new-card-index:2");
  });

  test("adds a new-card class only for newly appearing cards after the board has mounted", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" />);
    });

    expect(container.querySelector('[data-session-id="session-1"]')?.className).not.toContain("is-new-card");

    await act(async () => {
      root.render(
        <SessionBoard
          cards={[boardSession({ sessionId: "session-1" }), boardSession({ sessionId: "session-2", title: "Second session" })]}
          variant="observability"
        />
      );
    });

    expect(container.querySelector('[data-session-id="session-1"]')?.className).not.toContain("is-new-card");
    expect(container.querySelector('[data-session-id="session-2"]')?.className).toContain("is-new-card");
    expect(container.querySelector('[data-session-id="session-2"]')?.className).toContain("dovetail-card");

    await act(async () => root.unmount());
  });

  test("animates existing cards when their visible order changes", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const animations: Array<{
      sessionId: string;
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
      options?: number | KeyframeAnimationOptions;
    }> = [];
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
      options?: number | KeyframeAnimationOptions
    ) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push({ sessionId, keyframes, options });
      return { addEventListener: vi.fn() } as unknown as Animation;
    });

    try {
      const first = boardSession({ sessionId: "session-1", title: "First session" });
      const second = boardSession({ sessionId: "session-2", title: "Second session" });

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
      expect(animations.find((animation) => animation.sessionId === "session-2")?.options).toEqual(
        expect.objectContaining({
          delay: 0,
          duration: SESSION_CARD_LAYOUT_DURATION_MS,
          easing: SESSION_CARD_LAYOUT_EASING,
          fill: "both"
        })
      );
      expect(animations.find((animation) => animation.sessionId === "session-1")?.options).toEqual(
        expect.objectContaining({
          delay: SESSION_CARD_LAYOUT_STAGGER_MS,
          duration: SESSION_CARD_LAYOUT_DURATION_MS,
          easing: SESSION_CARD_LAYOUT_EASING,
          fill: "both"
        })
      );
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
    }
  });

  test("stages density shrink without scaling cards", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const animations: Array<{
      sessionId: string;
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
      options?: number | KeyframeAnimationOptions;
    }> = [];
    const animationFrames: FrameRequestCallback[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const isCompact = this.parentElement?.classList.contains("compact") === true;
      return testRect(0, 0, isCompact ? 240 : 320, isCompact ? 178 : 218);
    };
    HTMLElement.prototype.animate = vi.fn(function (
      this: HTMLElement,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push({ sessionId, keyframes, options });
      return { addEventListener: vi.fn() } as unknown as Animation;
    });
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="comfortable" />);
      });

      expect(animations).toEqual([]);

      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="compact" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      const keyframes = JSON.stringify(animations[0]?.keyframes);
      expect(animations.map((animation) => animation.sessionId)).toEqual(["session-1"]);
      expect(keyframes).toContain("translate(0px, 0px)");
      expect(keyframes).not.toContain("scale(");
      expect(card?.className).toContain("is-layout-compacting");
      expect(card?.style.width).toBe("320px");
      expect(card?.style.height).toBe("218px");
      expect(animations[0]?.options).toEqual(
        expect.objectContaining({
          delay: SESSION_CARD_LAYOUT_COMPACT_PHASE_MS,
          duration: SESSION_CARD_LAYOUT_DURATION_MS,
          easing: SESSION_CARD_LAYOUT_EASING,
          fill: "both"
        })
      );

      await act(async () => {
        for (const frame of animationFrames.splice(0)) frame(0);
      });

      expect(card?.style.transition).toContain(`width ${SESSION_CARD_LAYOUT_COMPACT_PHASE_MS}ms`);
      expect(card?.style.transition).toContain(`height ${SESSION_CARD_LAYOUT_COMPACT_PHASE_MS}ms`);
      expect(card?.style.transition).not.toContain("transform");
      expect(card?.style.width).toBe("240px");
      expect(card?.style.height).toBe("178px");
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  test("moves compact cards before expanding when card density grows", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const animations: Array<{
      sessionId: string;
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
      options?: number | KeyframeAnimationOptions;
    }> = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const isCompact = this.parentElement?.classList.contains("compact") === true;
      return testRect(0, 0, isCompact ? 240 : 320, isCompact ? 178 : 218);
    };
    HTMLElement.prototype.animate = vi.fn(function (
      this: HTMLElement,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions
    ) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push({ sessionId, keyframes, options });
      return { addEventListener: vi.fn() } as unknown as Animation;
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="compact" />);
      });

      expect(animations).toEqual([]);

      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="comfortable" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      const keyframes = JSON.stringify(animations[0]?.keyframes);
      expect(animations.map((animation) => animation.sessionId)).toEqual(["session-1"]);
      expect(keyframes).toContain("translate(0px, 0px)");
      expect(keyframes).not.toContain("scale(");
      expect(card?.className).toContain("is-layout-growing");
      expect(card?.className).toContain("is-layout-moving");
      expect(card?.style.width).toBe("240px");
      expect(card?.style.height).toBe("178px");
      expect(card?.style.transition).not.toContain("width");
      expect(card?.style.transition).not.toContain("height");
      expect(animations[0]?.options).toEqual(
        expect.objectContaining({
          delay: 0,
          duration: SESSION_CARD_LAYOUT_DURATION_MS,
          easing: SESSION_CARD_LAYOUT_EASING,
          fill: "both"
        })
      );
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
    }
  });

  test("cleans layout phase classes after card growth expands", async () => {
    vi.useFakeTimers();
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const animationListeners: Record<string, EventListenerOrEventListenerObject> = {};
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const isCompact = this.parentElement?.classList.contains("compact") === true;
      return testRect(0, 0, isCompact ? 240 : 320, 238);
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.dataset.sessionId ? 248 : 0;
      }
    });
    HTMLElement.prototype.animate = vi.fn(function () {
      return {
        addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          animationListeners[type] = listener;
        })
      } as unknown as Animation;
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="compact" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="comfortable" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      expect(card?.className).toContain("is-layout-growing");
      expect(card?.className).toContain("is-layout-moving");

      await act(async () => {
        const listener = animationListeners.finish;
        if (typeof listener === "function") listener(new Event("finish"));
      });

      expect(card?.className).toContain("is-layout-expanding");
      expect(card?.style.width).toBe("100%");
      expect(card?.style.height).toBe("238px");
      expect(card?.style.minHeight).toBe("238px");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_CARD_LAYOUT_EXPAND_DURATION_MS + SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS);
      });

      expect(card?.className).not.toContain("is-layout-animating");
      expect(card?.className).not.toContain("is-layout-growing");
      expect(card?.className).not.toContain("is-layout-expanding");
      expect(card?.style.width).toBe("");
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
      if (originalOffsetHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeightDescriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
      vi.useRealTimers();
    }
  });

  test("synchronizes staggered card growth expansions", async () => {
    vi.useFakeTimers();
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const animationListeners: Record<string, Record<string, EventListenerOrEventListenerObject>> = {};
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const siblings = Array.from(this.parentElement?.querySelectorAll<HTMLElement>(".session-card[data-session-id]") ?? []);
      const index = Math.max(0, siblings.indexOf(this));
      const isCompact = this.parentElement?.classList.contains("compact") === true;
      const width = isCompact ? 240 : 320;
      return testRect(index * (width + 12), 0, width, 238);
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.dataset.sessionId ? 248 : 0;
      }
    });
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement) {
      const sessionId = this.dataset.sessionId;
      return {
        addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          if (sessionId) {
            animationListeners[sessionId] ??= {};
            animationListeners[sessionId][type] = listener;
          }
        })
      } as unknown as Animation;
    });

    try {
      const first = boardSession({ sessionId: "session-1", title: "First session" });
      const second = boardSession({ sessionId: "session-2", title: "Second session" });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" density="compact" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" density="comfortable" />);
      });

      const firstCard = container.querySelector<HTMLElement>('[data-session-id="session-1"]');
      const secondCard = container.querySelector<HTMLElement>('[data-session-id="session-2"]');
      expect(firstCard?.className).toContain("is-layout-growing");
      expect(secondCard?.className).toContain("is-layout-growing");

      await act(async () => {
        const firstFinish = animationListeners["session-1"]?.finish;
        if (typeof firstFinish === "function") firstFinish(new Event("finish"));
      });

      expect(firstCard?.className).toContain("is-layout-moving");
      expect(firstCard?.className).not.toContain("is-layout-expanding");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_CARD_LAYOUT_STAGGER_MS - 1);
      });

      expect(firstCard?.className).not.toContain("is-layout-expanding");

      await act(async () => {
        const secondFinish = animationListeners["session-2"]?.finish;
        if (typeof secondFinish === "function") secondFinish(new Event("finish"));
      });

      expect(secondCard?.className).toContain("is-layout-expanding");
      expect(firstCard?.className).not.toContain("is-layout-expanding");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(firstCard?.className).toContain("is-layout-expanding");
      expect(firstCard?.style.height).toBe("238px");
      expect(secondCard?.style.height).toBe("238px");
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.animate = originalAnimate;
      if (originalOffsetHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeightDescriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
      vi.useRealTimers();
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
      const first = boardSession({ sessionId: "session-1", title: "First session" });
      const second = boardSession({ sessionId: "session-2", title: "Second session" });

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

  test("keeps fallback density shrink in a readable compact phase before moving", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const animationFrames: FrameRequestCallback[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      const isCompact = this.parentElement?.classList.contains("compact") === true;
      return testRect(0, 0, isCompact ? 240 : 320, isCompact ? 178 : 218);
    };
    (HTMLElement.prototype as { animate?: HTMLElement["animate"] }).animate = undefined;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="comfortable" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[boardSession({ sessionId: "session-1" })]} variant="observability" density="compact" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      expect(card?.className).toContain("is-layout-compacting");
      expect(card?.style.width).toBe("320px");
      expect(card?.style.height).toBe("218px");

      await act(async () => {
        animationFrames.shift()?.(0);
      });

      expect(card?.style.width).toBe("320px");
      expect(card?.style.height).toBe("218px");
      expect(card?.style.transition).not.toContain("transform");

      await act(async () => {
        animationFrames.shift()?.(SESSION_CARD_LAYOUT_COMPACT_PHASE_MS / 2);
      });

      const halfwayWidth = Number.parseFloat(card?.style.width ?? "");
      const halfwayHeight = Number.parseFloat(card?.style.height ?? "");
      expect(halfwayWidth).toBeGreaterThan(240);
      expect(halfwayWidth).toBeLessThan(320);
      expect(halfwayHeight).toBeGreaterThan(178);
      expect(halfwayHeight).toBeLessThan(218);
      expect(card?.className).toContain("is-layout-compacting");
      expect(card?.className).not.toContain("is-layout-moving");
      expect(card?.style.transition).not.toContain("transform");
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
      const first = boardSession({ sessionId: "session-1", headline: headlineView("First headline") });
      const second = boardSession({ sessionId: "session-2", headline: headlineView("Second headline") });

      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });

      await act(async () => {
        root.render(
          <SessionBoard
            cards={[
              boardHeadline(first, "First headline refreshed"),
              boardHeadline(second, "Second headline refreshed")
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

  test("does not animate same-order live content refreshes as card moves", async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const originalAnimate = HTMLElement.prototype.animate;
    const animations: string[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);
    let measuredHeight = 220;

    HTMLElement.prototype.getBoundingClientRect = function () {
      const sessionId = this.dataset.sessionId;
      if (!sessionId) return originalGetBoundingClientRect.call(this);
      return testRect(0, 0, 320, measuredHeight);
    };
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement) {
      const sessionId = this.dataset.sessionId;
      if (sessionId) animations.push(sessionId);
      return { addEventListener: vi.fn() } as unknown as Animation;
    });

    try {
      const original = boardSession({ sessionId: "session-1", title: "Short session title" });
      const updated = boardSession({ sessionId: "session-1", title: "Longer updated session title" });

      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" density="comfortable" />);
      });

      measuredHeight = 280;
      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" density="comfortable" />);
      });

      expect(animations).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
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
      const first = boardSession({ sessionId: "session-1", title: "First session" });
      const second = boardSession({ sessionId: "session-2", title: "Second session" });

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

  test("delays visible headline text until the refresh animation is nearly complete", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const first = boardSession({
      sessionId: "session-1",
      headline: headlineView("First old headline")
    });
    const second = boardSession({
      sessionId: "session-2",
      headline: headlineView("Second old headline")
    });

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[first, second]} variant="observability" />);
      });

      await act(async () => {
        root.render(
          <SessionBoard
            cards={[
              boardHeadline(first, "First updated headline"),
              boardHeadline(second, "Second updated headline")
            ]}
            variant="observability"
          />
        );
      });

      const headlines = Array.from(container.querySelectorAll<HTMLElement>(".headline"));
      expect(headlines[0]?.querySelector(".headline-text.headline-current")?.textContent).toBe("First old headline");
      expect(headlines[1]?.querySelector(".headline-text.headline-current")?.textContent).toBe("Second old headline");
      expect(container.querySelectorAll(".session-card.is-headline-refreshing")).toHaveLength(2);
      expect(headlines[0]?.querySelector(".headline-previous")?.textContent).toBe("First old headline");
      expect(container.querySelector(".card-headline-cursor")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_850);
      });

      expect(headlines[0]?.querySelector(".headline-text.headline-current")?.textContent).toBe("First updated headline");
      expect(headlines[1]?.querySelector(".headline-text.headline-current")?.textContent).toBe("Second updated headline");
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  test("keeps the outgoing headline layer during a refresh animation", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = boardSession({
      sessionId: "session-1",
      headline: headlineView("Outgoing board headline")
    });
    const updated = boardHeadline(original, "Incoming board headline");

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      const headline = card?.querySelector<HTMLElement>(".headline");
      expect(card?.classList.contains("is-headline-refreshing")).toBe(true);
      expect(headline?.querySelector(".headline-previous")?.textContent).toBe("Outgoing board headline");
      expect(headline?.querySelector(".headline-current")?.textContent).toBe("Outgoing board headline");
      expect(headline?.textContent).toContain("Outgoing board headline");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("does not run headline swap animation for idle cards", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = boardSession({
      sessionId: "session-idle",
      lifecycle: "ended",
      primaryStatus: "completed_unreviewed",
      headline: headlineView("Idle old headline")
    });
    const updated = boardHeadline(original, "Idle updated headline");

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      const headline = card?.querySelector<HTMLElement>(".headline");
      expect(card?.classList.contains("is-headline-refreshing")).toBe(false);
      expect(headline?.querySelector(".headline-previous")).toBeNull();
      expect(headline?.querySelector(".headline-current")?.textContent).toBe("Idle updated headline");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("uses a refresh pulse for same-text headline refreshes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const refreshed = session({ sessionId: "session-1", headline: headlineView("Stable refreshed headline") });

    try {
      await act(async () => {
        root.render(<SessionCard session={refreshed} refreshPulseIndex={0} />);
      });

      const card = container.querySelector<HTMLElement>(".session-card");
      const headline = card?.querySelector<HTMLElement>(".headline");
      expect(card?.classList.contains("is-headline-refreshing")).toBe(false);
      expect(card?.classList.contains("is-refresh-pulsing")).toBe(true);
      expect(card?.style.getPropertyValue("--refresh-pulse-index")).toBe("0");
      expect(headline?.querySelector(".headline-previous")).toBeNull();
      expect(headline?.querySelector(".headline-current")?.textContent).toBe("Stable refreshed headline");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("keeps the mockup headline stable after a same-text board refresh", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = boardSession({
      sessionId: "session-1",
      headline: headlineView("Old board headline")
    });
    const updated = boardHeadline(original, "Updated board headline");

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      expect(container.querySelector<HTMLElement>(".headline .headline-current")?.textContent).toBe("Old board headline");
      expect(container.querySelector(".card-headline-cursor")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_850);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      expect(container.querySelector<HTMLElement>(".headline")?.textContent).toContain("Updated board headline");
      expect(container.querySelector(".card-headline-cursor")).toBeNull();
      expect(container.querySelector(".session-card.is-headline-refreshing")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  test("does not pulse observability cards for same-text board refreshes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = boardSession({
      sessionId: "session-1",
      headline: headlineView("Stable board headline")
    });
    const refreshed = {
      ...original,
      headlineRefresh: {
        provider: "openai",
        requestedAt: "2026-06-23T02:04:00.000Z",
        status: "success" as const
      }
    };

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });
      await act(async () => {
        root.render(<SessionBoard cards={[refreshed]} variant="observability" />);
      });

      expect(container.querySelector(".session-card.is-refresh-pulsing")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("does not render a legacy headline cursor in the mockup card", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = boardSession({
      sessionId: "session-1",
      headline: headlineView("Old reduced headline")
    });
    const updated = boardHeadline(original, "Updated reduced headline");

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      expect(container.querySelector(".card-headline-cursor")).toBeNull();

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      const headline = container.querySelector<HTMLElement>(".headline");
      expect(headline?.textContent).toContain("Updated reduced headline");
      expect(container.querySelector(".card-headline-cursor")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      window.matchMedia = originalMatchMedia;
    }
  });

  test("falls back from raw serialized or command-like headlines", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("{\"type\":\"response_item\",\"payload\":{\"command\":\"npm test\"}}", { source: "offline" }),
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

  test("renders approval-pending sessions as needs-approval waiting copy", () => {
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

    expect(html).toContain(">Needs approval<");
    expect(html).toContain("is-waiting");
    expect(html).toContain("tier-action");
    expect(html).not.toContain("is-active");
    expect(html).not.toContain(">Blocked<");
    expect(html).not.toContain("is-blocked");
  });

  test("does not apply demo harness or model values to live observability cards", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[boardSession({ thinkingLevel: undefined })]} variant="observability" onOpenSession={() => undefined} />
    );

    expect(html).toContain("OpenCode");
    expect(html).toContain("Not captured");
    expect(html).not.toContain("High");
    expect(html).not.toContain("Claude Code");
    expect(html).not.toContain("Cursor");
    expect(html).not.toContain("Hermes");
    expect(html).not.toContain("gpt-5.5");
    expect(html).not.toContain("gpt-5.4");
  });

  test("applies compact density to the observability card grid", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[boardSession()]} variant="observability" density="compact" onOpenSession={() => undefined} />
    );

    expect(html).toContain("observability-card-grid compact");
  });

  test("renders captured live model values without demo telemetry", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[boardSession({ model: "gpt-5.5" })]} variant="observability" onOpenSession={() => undefined} />
    );

    expect(html).toContain("gpt-5.5");
    expect(html).not.toContain("Cursor");
    expect(html).not.toContain("Hermes");
  });

  test("renders pending headline state without an AI failure badge", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Generating headline...", { source: "pending", status: "pending" }),
          headlineRefresh: {
            provider: "openai",
            requestedAt: "2026-06-23T02:04:00.000Z",
            status: "pending"
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Generating headline...");
    expect(html).toContain("Pending");
    expect(html).not.toContain(["AI", "headline", "failed"].join(" "));
    expect(html).not.toContain(["AI", "headline", "not", "configured"].join(" "));
    expect(html).not.toContain("api_error");
    expect(html).not.toContain("source: llm");
  });

  test("renders offline headline source calmly without an AI failure badge", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          headline: headlineView("Board headlines: structured around subject and disposition.", { source: "offline" }),
          headlineRefresh: {
            provider: "openai",
            requestedAt: "2026-06-23T02:04:00.000Z",
            status: "not_configured"
          }
        })}
        onToggle={() => undefined}
      />
    );

    expect(html).toContain("Board headlines: structured around subject and disposition.");
    expect(html).toContain("Offline");
    expect(html).not.toContain(["AI", "headline", "failed"].join(" "));
    expect(html).not.toContain(["AI", "headline", "not", "configured"].join(" "));
  });

  test("does not render captured thinking values as a primary card fact", () => {
    const html = renderToStaticMarkup(
      <SessionBoard cards={[boardSession({ thinkingLevel: "Extra High" })]} variant="observability" onOpenSession={() => undefined} />
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
    headline: headlineView("Board headlines: structured around subject and disposition."),
    harness: "OpenCode",
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

function headlineView(headline: string, overrides: Partial<BoardHeadlineView> = {}): BoardHeadlineView {
  return {
    headline,
    source: "llm",
    status: "ready",
    ...overrides
  };
}

function boardSession(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return session(overrides);
}

function boardHeadline(session: SessionCardView, headline: string): SessionCardView {
  return { ...session, headline: { ...session.headline, headline } };
}

function testRect(left: number, top: number, width = 320, height = 218): DOMRect {
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
