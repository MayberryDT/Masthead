// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { LogbookFilterState } from "../../HistoryPanel";
import { LogbookToolbar } from "../LogbookToolbar";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

describe("LogbookToolbar", () => {
  test("renders Logbook filters as primary toolbar controls", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex", "claude"] }}
        filters={{ dateFrom: "2026-06-01", dateTo: "2026-06-25", file: "src/app", model: "gpt-5", project: "Masthead", runtime: "codex" }}
        query="oauth"
        sort="files_desc"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search all session history");
    expect(html).toContain("Search sessions");
    expect(html.indexOf("Date 2")).toBeLessThan(html.indexOf("Runtime filter"));
    expect(html).toContain("Date 2");
    expect(html).toContain("File 1");
    expect(html).toContain("Runtime filter");
    expect(html).toContain("Project filter");
    expect(html).toContain("Model filter");
    expect(html).toContain("Open file filter");
    expect(html).toContain("Masthead");
    expect(html).toContain("gpt-5");
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-25");
    expect(html).toContain("Changed file path");
    expect(html).toContain("Files changed");
    expect(html.indexOf("Search sessions")).toBeLessThan(html.indexOf("Date 2"));
    expect(html.indexOf("Project filter")).toBeLessThan(html.indexOf("Model filter"));
    expect(html.indexOf("Runtime filter")).toBeLessThan(html.indexOf("Files changed"));
    expect(html.indexOf("Files changed")).toBeLessThan(html.indexOf("Open file filter"));
    expect(html).not.toContain("Filters");
    expect(html).not.toContain("Lifecycle filter");
    expect(html).not.toContain("Compact rows");
    expect(html).not.toContain("<select");
  });

  test("keeps secondary Logbook filters visible without active filters", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex"] }}
        filters={{}}
        query=""
        sort="recent"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain('class="logbook-toolbar observability-toolbar metal-toolbar"');
    expect(html).toContain("Project filter");
    expect(html).toContain("Model filter");
    expect(html).toContain("Open file filter");
    expect(html).not.toContain("Filters");
    expect(html).not.toContain("File 1");
  });

  test("opens a compact date popover and updates typed date filters", async () => {
    const onFilterChange = vi.fn();
    renderToolbar({ onFilterChange });

    await act(async () => {
      buttonByLabel("Open date filter").click();
    });

    const from = inputByLabel("From date");
    await act(async () => {
      from.value = "2026-06-10";
      from.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: "2026-06-10" }));
    expect(container?.querySelector(".logbook-date-popover")).not.toBeNull();
  });
});

function renderToolbar({ onFilterChange }: { onFilterChange: (filters: LogbookFilterState) => void }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex"] }}
        filters={{}}
        query=""
        sort="recent"
        onFilterChange={onFilterChange}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((candidate) => candidate.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function inputByLabel(label: string): HTMLInputElement {
  const input = Array.from(container?.querySelectorAll("input") ?? []).find((candidate) => candidate.getAttribute("aria-label") === label);
  expect(input).toBeDefined();
  return input as HTMLInputElement;
}
