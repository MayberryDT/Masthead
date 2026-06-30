// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LogbookTable } from "../LogbookTable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

describe("LogbookTable", () => {
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    vi.useRealTimers();
    container?.remove();
    container = undefined;
    root = undefined;
  });

  test("renders canonical sessions as a semantic dense table without card grid classes", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="comfortable"
        selectedSessionId="session-1"
        sessions={[
          {
            endedAt: "2026-06-25T22:52:00.000Z",
            errorCount: 0,
            fileCount: 9,
            hostId: "host:test",
            lastActivityAt: "2026-06-25T22:42:00.000Z",
            lifecycle: "ended",
            model: "gpt-5",
            models: ["gpt-5"],
            project: "Pip",
            runtime: "codex",
            sessionId: "session-1",
            snippet: "Repair <mark>OAuth</mark> callback return path",
            sourceConfidence: "authoritative",
            sourceSessionId: "source-session-1",
            startedAt: "2026-06-25T22:12:00.000Z",
            title: "Repair OAuth callback",
            toolCount: 14
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain("SESSION / MATCH");
    expect(html).toContain("SOURCE");
    expect(html).not.toContain("FILES");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("<mark>OAuth</mark>");
    expect(html).toContain("Pip");
    expect(html).toContain("Codex");
    expect(html).toContain("Authoritative");
    expect(html).toContain("host:test");
    expect(html).toContain("14");
    expect(html).toContain("40m");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("surface-card-grid");
    expect(html).not.toContain("surface-data-card");
    expect(html).not.toContain("logbook-card");
  });

  test("adds capped row stagger indices for page entry animations", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        animateOnMount
        density="compact"
        sessions={Array.from({ length: 16 }, (_, index) => ({
          project: "Masthead",
          runtime: "codex",
          sessionId: `session-${index + 1}`,
          title: `Session ${index + 1}`
        }))}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("--logbook-row-index:0");
    expect(html).toContain("--logbook-row-index:12");
    expect(html).not.toContain("--logbook-row-index:13");
    expect(html).toContain("is-entering");
  });

  test("starts row entry cascade promptly enough to be visible", () => {
    const css = readFileSync("src/styles/logbook.css", "utf8");

    expect(css).toContain("--logbook-row-entry-delay: 40ms");
    expect(css).toContain("calc(var(--logbook-row-entry-delay) + var(--logbook-row-index) * 14ms)");
  });

  test("keeps the entering class until the staggered cascade has time to run", async () => {
    vi.useFakeTimers();
    await renderTable(undefined, { animateOnMount: true });

    expect(currentContainer().querySelector(".logbook-table-wrap")?.className).toContain("is-entering");

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(currentContainer().querySelector(".logbook-table-wrap")?.className).toContain("is-entering");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(currentContainer().querySelector(".logbook-table-wrap")?.className).not.toContain("is-entering");
  });

  test("renders lifecycle state tokens with explicit semantic classes", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="compact"
        sessions={[
          { lifecycle: "running", project: "Masthead", runtime: "codex", sessionId: "running-session", title: "Running session" },
          { lifecycle: "ended", project: "Masthead", runtime: "codex", sessionId: "ended-session", title: "Ended session" },
          { lifecycle: "unknown", project: "Masthead", runtime: "codex", sessionId: "unknown-session", title: "Unknown session" },
          { lifecycle: "blocked", project: "Masthead", runtime: "codex", sessionId: "blocked-session", title: "Blocked session" }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain('class="state-token running"');
    expect(html).toContain('class="state-token ended"');
    expect(html).toContain('class="state-token unknown"');
    expect(html).toContain('class="state-token blocked"');
  });

  test("uses folded metal lifecycle chips with ended mapped to blue", () => {
    const css = readFileSync("src/styles/logbook.css", "utf8");

    expect(css).toMatch(/\.logbook-col-state \.state-token\s*\{[\s\S]*border-radius: 1px;[\s\S]*clip-path: var\(--folded-control-clip/);
    expect(css).toMatch(/\.logbook-col-state \.state-token\.ended\s*\{[\s\S]*border-color: rgba\(46, 167, 255, 0\.34\);[\s\S]*color: #a9d7ff;/);
  });

  test("opens the session when any non-control cell in the row is clicked", async () => {
    const onSelect = vi.fn();
    await renderTable(onSelect);

    const projectCell = currentContainer().querySelector<HTMLTableCellElement>("tbody .logbook-col-project");
    expect(projectCell).not.toBeNull();

    await act(async () => {
      projectCell?.click();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  test("opens the session from keyboard row activation", async () => {
    const onSelect = vi.fn();
    await renderTable(onSelect);

    const row = currentContainer().querySelector<HTMLTableRowElement>("tbody .logbook-row");
    expect(row).not.toBeNull();

    await act(async () => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });
});

async function renderTable(onSelect: (sessionId: string) => void = () => undefined, options: { animateOnMount?: boolean } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LogbookTable
        animateOnMount={options.animateOnMount}
        density="compact"
        sessions={[
          {
            project: "Masthead",
            runtime: "codex",
            sessionId: "session-1",
            title: "Repair OAuth callback"
          }
        ]}
        onSelect={onSelect}
      />
    );
  });
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}
