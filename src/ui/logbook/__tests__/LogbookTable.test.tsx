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

  test("renders published artifacts as a semantic dense table without card grid classes", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="comfortable"
        selectedSessionId="artifact-1"
        sessions={[
          {
            errorCount: 0,
            fileCount: 0,
            hostId: "2 sessions",
            lastActivityAt: "2026-06-25T22:42:00.000Z",
            lifecycle: "runbook",
            models: ["high"],
            project: "Pip",
            runtime: "runbook",
            sessionId: "artifact-1",
            snippet: "Repair <mark>OAuth</mark> callback return path",
            sourceConfidence: "authoritative",
            sourceSessionId: "session:1",
            title: "Repair OAuth callback",
            toolCount: 2
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("KIND");
    expect(html).toContain("TITLE / HIGHLIGHT");
    expect(html).toContain("PROVENANCE");
    expect(html).toContain("PUBLISHED");
    expect(html).toContain("Repair OAuth callback");
    expect(html).toContain("OAuth");
    expect(html).toContain("Pip");
    expect(html).toContain("Runbook");
    expect(html).toContain("high");
    expect(html).toContain("2 sessions");
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
          runtime: "runbook",
          sessionId: `artifact-${index + 1}`,
          title: `Artifact ${index + 1}`
        }))}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("--logbook-row-index:0");
    expect(html).toContain("--logbook-row-index:12");
    expect(html).not.toContain("--logbook-row-index:13");
    expect(html).toContain("is-entering");
  });

  test("shows artifact highlight without lifecycle noise", () => {
    const html = renderToStaticMarkup(
      <LogbookTable
        density="compact"
        sessions={[
          {
            errorCount: 0,
            fileCount: 0,
            hostId: "1 session",
            lastActivityAt: "2026-07-01T10:38:00.000Z",
            lifecycle: "session_dossier",
            models: ["medium"],
            runtime: "session_dossier",
            sessionId: "artifact-weak",
            snippet: "Compiled session package for cache lock fix",
            sourceConfidence: "authoritative",
            sourceSessionId: "session narrative",
            title: "Cache lock dossier",
            toolCount: 1,
            topics: []
          }
        ]}
        onSelect={() => undefined}
      />
    );

    expect(html).toContain("Cache lock dossier");
    expect(html).toContain("Compiled session package for cache lock fix");
    expect(html).toContain("Dossier");
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

  test("opens the artifact when any non-control cell in the row is clicked", async () => {
    const onSelect = vi.fn();
    await renderTable(onSelect);

    const projectCell = currentContainer().querySelector<HTMLTableCellElement>("tbody .logbook-col-project");
    expect(projectCell).not.toBeNull();

    await act(async () => {
      projectCell?.click();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("artifact-1");
  });

  test("opens the artifact from keyboard row activation", async () => {
    const onSelect = vi.fn();
    await renderTable(onSelect);

    const row = currentContainer().querySelector<HTMLTableRowElement>("tbody .logbook-row");
    expect(row).not.toBeNull();

    await act(async () => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("artifact-1");
  });
});

async function renderTable(
  onSelect?: (sessionId: string) => void,
  options: {
    animateOnMount?: boolean;
  } = {}
): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LogbookTable
        animateOnMount={options.animateOnMount}
        density="compact"
        sessions={[sessionRow("artifact-1", "Repair OAuth callback")]}
        onSelect={onSelect ?? (() => undefined)}
      />
    );
  });
}

function sessionRow(sessionId: string, title: string) {
  return {
    errorCount: 0,
    fileCount: 0,
    hostId: "1 session",
    lastActivityAt: "2026-06-25T22:42:00.000Z",
    lifecycle: "runbook",
    models: ["high"],
    project: "Masthead",
    runtime: "runbook",
    sessionId,
    sourceConfidence: "authoritative" as const,
    sourceSessionId: sessionId,
    title,
    toolCount: 1
  };
}

function currentContainer(): HTMLDivElement {
  if (!container) throw new Error("container missing");
  return container;
}
