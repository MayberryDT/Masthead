// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { SessionCardView } from "../../core/types";
import { SessionCard } from "../SessionCard";
import { SessionBoard } from "../SessionBoard";
import { stateClassName } from "../format";
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
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_user", indicators: ["attention"] }))).toBe(
      "needs-attention"
    );
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] }))).toBe(
      "needs-attention"
    );
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "editing", indicators: ["attention", "conflict"] }))).toBe(
      "running"
    );
    expect(stateClassName(session({ lifecycle: "running", primaryStatus: "failed", indicators: ["attention"] }))).toBe("running");
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
      expect(headlines[0]?.textContent).toBe("");
      expect(headlines[1]?.textContent).toContain("Second old headline");

      await act(async () => {
        vi.advanceTimersByTime(16);
      });

      expect(headlines[0]?.textContent).toBe("F");

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

  test("keeps typing after a same-text board refresh clears the transient stagger index", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const original = session({
      sessionId: "session-1",
      copy: { ...session().copy, headline: "Old board headline" }
    });
    const updated = { ...original, copy: { ...original.copy, headline: "Updated board headline" } };

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      await act(async () => {
        vi.advanceTimersByTime(16);
      });

      const headline = container.querySelector<HTMLElement>(".card-headline");
      expect(headline?.textContent).toBe("U");
      expect(headline?.querySelector(".card-headline-cursor")).not.toBeNull();

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      await act(async () => {
        vi.advanceTimersByTime(64);
      });

      expect(headline?.textContent).toBe("Updat");
      expect(headline?.className).toContain("is-headline-typing");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(headline?.textContent).toContain("Updated board headline");
      expect(headline?.className).not.toContain("is-headline-typing");
      expect(headline?.querySelector(".card-headline-cursor")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });

  test("does not render an idle headline cursor or animate when reduced motion is requested", async () => {
    vi.useFakeTimers();
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
    const original = session({
      sessionId: "session-1",
      copy: { ...session().copy, headline: "Old reduced headline" }
    });
    const updated = { ...original, copy: { ...original.copy, headline: "Updated reduced headline" } };

    try {
      await act(async () => {
        root.render(<SessionBoard cards={[original]} variant="observability" />);
      });

      expect(container.querySelector(".card-headline-cursor")).toBeNull();

      await act(async () => {
        root.render(<SessionBoard cards={[updated]} variant="observability" />);
      });

      const headline = container.querySelector<HTMLElement>(".card-headline");
      expect(headline?.textContent).toContain("Updated reduced headline");
      expect(headline?.className).not.toContain("is-headline-typing");
      expect(container.querySelector(".card-headline-cursor")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      window.matchMedia = originalMatchMedia;
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

  test("renders approval-pending sessions as blocked", () => {
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

    expect(html).toContain(">Blocked<");
    expect(html).toContain("needs-attention");
    expect(html).not.toContain(">Active<");
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
