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
            runtime: "opencode",
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
    expect(html).toContain("OpenCode");
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

  test("suppresses weak source ids and lifecycle words in the session subtitle", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="compact"
        sessions={[
          {
            errorCount: 0,
            fileCount: 0,
            hostId: "host:test",
            lastActivityAt: "2026-07-01T10:38:00.000Z",
            lifecycle: "ended",
            models: [],
            outcome: "completed",
            runtime: "codex",
            sessionId: "session-weak-source",
            sourceConfidence: "authoritative",
            sourceSessionId: "session narrative",
            title: "Codex session · 2026-07-01 10:38",
            toolCount: 0,
            topics: []
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("Codex session · 2026-07-01 10:38");
    expect(html).not.toContain("session narrative");
    expect(html).not.toContain("<span>completed</span>");
  });

  test("renders durable title, archival summary, and enrichment chips", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="compact"
        sessions={[
          {
            enrichmentStatus: "current",
            errorCount: 0,
            fileCount: 0,
            hostId: "host:test",
            lastActivityAt: "2026-07-01T10:38:00.000Z",
            lifecycle: "ended",
            models: [],
            runtime: "codex",
            sessionId: "session-durable-row",
            sessionSummary: {
              confidence: "high",
              evidenceRefs: [],
              state: "completed",
              text: "Added durable Logbook title selection while keeping live summary separate."
            },
            sessionTitle: {
              basis: "dominant_work",
              confidence: "high",
              evidenceRefs: [],
              text: "Durable Logbook title selection"
            },
            sourceConfidence: "authoritative",
            sourceSessionId: "source-durable-row",
            title: "Legacy compatible title",
            toolCount: 0,
            topics: []
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("Durable Logbook title selection");
    expect(html).toContain("Added durable Logbook title selection");
    expect(html).toContain("Completed");
    expect(html).toContain("High confidence");
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

  test("marks selected bulk rows and toggles the checkbox without opening the session", async () => {
    const onSelect = vi.fn();
    const onToggleBulkSelect = vi.fn();
    await renderTable(onSelect, { onToggleBulkSelect, selectedSessionIds: ["session-1"] });

    const checkbox = checkboxByLabel("Select Repair OAuth callback for bulk enrich");
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      checkbox.click();
    });

    expect(onToggleBulkSelect).toHaveBeenCalledTimes(1);
    expect(onToggleBulkSelect).toHaveBeenCalledWith("session-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("keeps outgoing transition rows from exposing a stale selected bulk checkbox", async () => {
    vi.useFakeTimers();
    const onToggleBulkSelect = vi.fn();
    await renderTable(vi.fn(), { onToggleBulkSelect, selectedSessionIds: ["session-1"] });

    await act(async () => {
      root?.render(
        <LogbookTable
          density="compact"
          selectedSessionIds={["session-2"]}
          sessions={[sessionRow("session-2", "New visible session")]}
          onSelect={() => undefined}
          onToggleBulkSelect={onToggleBulkSelect}
        />
      );
    });

    const outgoing = currentContainer().querySelector<HTMLTableElement>(".logbook-table-outgoing");
    const current = currentContainer().querySelector<HTMLTableElement>(".logbook-table-current");
    expect(outgoing?.getAttribute("aria-hidden")).toBe("true");
    expect(current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(outgoing?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);

    await act(async () => {
      outgoing?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });

    expect(onToggleBulkSelect).not.toHaveBeenCalled();
  });
});

function sessionRow(sessionId: string, title: string) {
  return {
    project: "Masthead",
    runtime: "codex",
    sessionId,
    title
  };
}

async function renderTable(
  onSelect: (sessionId: string) => void = () => undefined,
  options: { animateOnMount?: boolean; onToggleBulkSelect?: (sessionId: string) => void; selectedSessionIds?: string[] } = {}
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LogbookTable
        animateOnMount={options.animateOnMount}
        density="compact"
        sessions={[sessionRow("session-1", "Repair OAuth callback")]}
        selectedSessionIds={options.selectedSessionIds}
        onToggleBulkSelect={options.onToggleBulkSelect}
        onSelect={onSelect}
      />
    );
  });
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}

function checkboxByLabel(label: string): HTMLInputElement {
  const checkbox = Array.from(currentContainer().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
    (candidate) => candidate.getAttribute("aria-label") === label
  );
  expect(checkbox).toBeDefined();
  return checkbox as HTMLInputElement;
}
