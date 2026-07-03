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
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--dropdown-close-dur");
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
        sort="duration_desc"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search all session history");
    expect(html).toContain("Search sessions");
    expect(html.indexOf("Date 2")).toBeLessThan(html.indexOf("Runtime filter"));
    expect(html).toContain("Date 2");
    expect(html).toContain("Runtime filter");
    expect(html).toContain("Project filter");
    expect(html).toContain("Model filter");
    expect(html).toContain("Masthead");
    expect(html).toContain("gpt-5");
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-25");
    expect(html).toContain("Duration");
    expect(html.indexOf("Search sessions")).toBeLessThan(html.indexOf("Date 2"));
    expect(html.indexOf("Project filter")).toBeLessThan(html.indexOf("Model filter"));
    expect(html.indexOf("Runtime filter")).toBeLessThan(html.indexOf("Duration"));
    expect(html).not.toContain("Files changed");
    expect(html).not.toContain("Changed file path");
    expect(html).not.toContain("Open file filter");
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
    expect(html).toContain("Recent");
    expect(html).not.toContain("Files changed");
    expect(html).not.toContain("Changed file path");
    expect(html).not.toContain("Open file filter");
    expect(html).not.toContain("Filters");
    expect(html).not.toContain("File 1");
  });

  test("renders Runtime as a searchable dropdown like Project and Model", async () => {
    renderToolbar({ onFilterChange: vi.fn() });

    const runtimeTrigger = buttonByLabel("Runtime filter");
    expect(runtimeTrigger.className).toContain("filterable-select-trigger");

    await act(async () => {
      runtimeTrigger.click();
    });

    expect(document.body.querySelector(".filterable-select-menu")).not.toBeNull();
    expect(inputByPlaceholder("Type or choose runtime")).not.toBeNull();
    expect(document.body.querySelector(".filterable-select-options")).not.toBeNull();
    expect(document.body.textContent).toContain("All runtimes");
    expect(document.body.textContent).toContain("Codex");
  });

  test("manages selected filter values inside the dropdown", async () => {
    const onFilterChange = vi.fn();
    renderToolbar({ filters: { project: "Masthead", runtime: "codex" }, onFilterChange });

    await act(async () => {
      buttonByLabel("Project filter").click();
    });

    expect(document.body.querySelector(".filterable-select-selection")?.textContent).toContain("Selected");
    expect(document.body.querySelector(".filterable-select-selection")?.textContent).toContain("Masthead");

    await act(async () => {
      buttonByDocumentLabel("Clear Project filter").click();
    });

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ project: undefined, runtime: "codex" }));
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

  test("animates the date popover with the shared toolbar dropdown motion", async () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--dropdown-close-dur", "150ms");
    renderToolbar({ onFilterChange: vi.fn() });

    await act(async () => {
      buttonByLabel("Open date filter").click();
    });

    expect(datePopover().className).toContain("t-dropdown");
    expect(datePopover().className).toContain("is-open");

    await act(async () => {
      buttonByLabel("Open date filter").click();
    });

    expect(datePopover().className).toContain("is-closing");
    expect(datePopover().hidden).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(datePopover().className).toContain("is-closing");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container?.querySelector(".logbook-date-popover")).toBeNull();
  });

  test("dismisses the date popover like the shared toolbar dropdowns", async () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--dropdown-close-dur", "150ms");
    renderToolbar({ onFilterChange: vi.fn() });

    await act(async () => {
      buttonByLabel("Open date filter").click();
    });

    const outside = document.createElement("button");
    document.body.append(outside);

    await act(async () => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(datePopover().className).toContain("is-closing");

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(container?.querySelector(".logbook-date-popover")).toBeNull();

    await act(async () => {
      buttonByLabel("Open date filter").click();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(datePopover().className).toContain("is-closing");

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(container?.querySelector(".logbook-date-popover")).toBeNull();
    outside.remove();
  });
});

function renderToolbar({
  filters = {},
  onFilterChange
}: {
  filters?: LogbookFilterState;
  onFilterChange: (filters: LogbookFilterState) => void;
}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex"] }}
        filters={filters}
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

function buttonByDocumentLabel(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find((candidate) => candidate.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function inputByLabel(label: string): HTMLInputElement {
  const input = Array.from(container?.querySelectorAll("input") ?? []).find((candidate) => candidate.getAttribute("aria-label") === label);
  expect(input).toBeDefined();
  return input as HTMLInputElement;
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = Array.from(document.body.querySelectorAll("input") ?? []).find((candidate) => candidate.getAttribute("placeholder") === placeholder);
  expect(input).toBeDefined();
  return input as HTMLInputElement;
}

function datePopover(): HTMLDivElement {
  const popover = container?.querySelector(".logbook-date-popover");
  expect(popover).toBeDefined();
  return popover as HTMLDivElement;
}
