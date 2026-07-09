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
        filterOptions={{ projects: ["Masthead"] }}
        filters={{ dateFrom: "2026-06-01", dateTo: "2026-06-25", kind: "runbook", project: "Masthead" }}
        query="oauth"
        sort="project"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search published artifacts");
    expect(html).toContain("Search published artifacts…");
    expect(html.indexOf("Date 2")).toBeLessThan(html.indexOf("Kind filter"));
    expect(html).toContain("Date 2");
    expect(html).toContain("Kind filter");
    expect(html).toContain("Project filter");
    expect(html).toContain("Masthead");
    expect(html).toContain("Runbook");
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-25");
    expect(html).toContain("Project");
    expect(html.indexOf("Search published artifacts")).toBeLessThan(html.indexOf("Date 2"));
    expect(html.indexOf("Kind filter")).toBeLessThan(html.indexOf("Project filter"));
    expect(html.indexOf("Kind filter")).toBeLessThan(html.indexOf("Sort artifacts"));
    expect(html).not.toContain("Runtime filter");
    expect(html).not.toContain("Model filter");
    expect(html).not.toContain("Enrich summaries");
    expect(html).not.toContain("Enrich full");
    expect(html).not.toContain("Select page");
    expect(html).not.toContain("Duration");
    expect(html).not.toContain("Tool calls");
    expect(html).not.toContain("Errors");
    expect(html).not.toContain("Files changed");
    expect(html).not.toContain("Changed file path");
    expect(html).not.toContain("Open file filter");
    expect(html).not.toContain("Filters");
    expect(html).not.toContain("Lifecycle filter");
    expect(html).not.toContain("Compact rows");
    expect(html).not.toContain("<select");
  });

  test("does not render bulk enrich controls", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"] }}
        filters={{}}
        query=""
        sort="recent"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).not.toContain("selected");
    expect(html).not.toContain("Select page");
    expect(html).not.toContain("Select all matching filter");
    expect(html).not.toContain("Enrich summaries");
    expect(html).not.toContain("Enrich full sessions");
    expect(html).not.toContain("Remote provider is off");
  });

  test("keeps secondary Logbook filters visible without active filters", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"] }}
        filters={{}}
        query=""
        sort="recent"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain('class="logbook-toolbar observability-toolbar metal-toolbar"');
    expect(html).toContain("Kind filter");
    expect(html).toContain("Project filter");
    expect(html).toContain("Recent");
    expect(html).not.toContain("Runtime filter");
    expect(html).not.toContain("Model filter");
    expect(html).not.toContain("Files changed");
    expect(html).not.toContain("Changed file path");
    expect(html).not.toContain("Open file filter");
    expect(html).not.toContain("Filters");
    expect(html).not.toContain("File 1");
  });

  test("renders Kind as a searchable dropdown like Project", async () => {
    renderToolbar({ onFilterChange: vi.fn() });

    const kindTrigger = buttonByLabel("Kind filter");
    expect(kindTrigger.className).toContain("filterable-select-trigger");

    await act(async () => {
      kindTrigger.click();
    });

    expect(document.body.querySelector(".filterable-select-menu")).not.toBeNull();
    expect(inputByPlaceholder("Type or choose kind")).not.toBeNull();
    expect(document.body.querySelector(".filterable-select-options")).not.toBeNull();
    expect(document.body.textContent).toContain("All kinds");
    expect(document.body.textContent).toContain("Session dossier");
    expect(document.body.textContent).toContain("Runbook");
    expect(document.body.textContent).toContain("ADR");
    expect(document.body.textContent).toContain("Incident timeline");
  });

  test("manages selected filter values inside the dropdown", async () => {
    const onFilterChange = vi.fn();
    renderToolbar({ filters: { project: "Masthead", kind: "runbook" }, onFilterChange });

    await act(async () => {
      buttonByLabel("Project filter").click();
    });

    expect(document.body.querySelector(".filterable-select-selection")?.textContent).toContain("Selected");
    expect(document.body.querySelector(".filterable-select-selection")?.textContent).toContain("Masthead");

    await act(async () => {
      buttonByDocumentLabel("Clear Project filter").click();
    });

    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ project: undefined, kind: "runbook" }));
  });

  test("keeps multi-select dropdowns open while values are selected", async () => {
    const onFilterChange = vi.fn();
    renderStatefulToolbar({ filterOptions: { projects: ["Masthead", "Pip"] }, onFilterChange });

    await act(async () => {
      buttonByLabel("Project filter").click();
    });

    const masthead = optionByName("Masthead");
    await act(async () => {
      masthead.click();
    });

    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ project: ["Masthead"] }));
    expect(document.body.querySelector(".filterable-select-menu")?.className).toContain("is-open");

    await act(async () => {
      optionByName("Pip").click();
    });

    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ project: ["Masthead", "Pip"] }));
    expect(document.body.querySelector(".filterable-select-menu")?.className).toContain("is-open");
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
  filterOptions = { projects: ["Masthead"] },
  filters = {},
  onFilterChange
}: {
  filterOptions?: { projects: string[] };
  filters?: LogbookFilterState;
  onFilterChange: (filters: LogbookFilterState) => void;
}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LogbookToolbar
        filterOptions={filterOptions}
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

function renderStatefulToolbar({
  filterOptions,
  onFilterChange
}: {
  filterOptions: { projects: string[] };
  onFilterChange: (filters: LogbookFilterState) => void;
}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let filters: LogbookFilterState = {};
  const render = () => {
    root?.render(
      <LogbookToolbar
        filterOptions={filterOptions}
        filters={filters}
        query=""
        sort="recent"
        onFilterChange={(nextFilters) => {
          filters = nextFilters;
          onFilterChange(nextFilters);
          render();
        }}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );
  };
  act(render);
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
  const input = Array.from(document.body.querySelectorAll("input")).find((candidate) => candidate.getAttribute("placeholder") === placeholder);
  expect(input).toBeDefined();
  return input as HTMLInputElement;
}

function optionByName(name: string): HTMLButtonElement {
  const option = Array.from(document.body.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === name);
  expect(option).toBeDefined();
  return option as HTMLButtonElement;
}

function datePopover(): HTMLElement {
  const popover = container?.querySelector(".logbook-date-popover");
  expect(popover).not.toBeNull();
  return popover as HTMLElement;
}
