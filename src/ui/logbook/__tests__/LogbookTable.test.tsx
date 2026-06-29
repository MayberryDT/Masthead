// @vitest-environment happy-dom

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

async function renderTable(onSelect: (sessionId: string) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LogbookTable
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
