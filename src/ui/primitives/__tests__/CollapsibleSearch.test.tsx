// @vitest-environment happy-dom
import { act, createRef, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CollapsibleSearch } from "../CollapsibleSearch";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--search-close-dur");
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

describe("CollapsibleSearch", () => {
  test("opens and collapses from the search trigger", async () => {
    const onClear = vi.fn();
    renderSearch({ value: "", onClear });

    const trigger = buttonByLabel("Search sessions");

    await act(async () => {
      trigger.click();
    });
    expect(searchRoot().className).toContain("expanded");
    expect(trigger.getAttribute("aria-label")).toBe("Collapse search");

    await act(async () => {
      trigger.click();
    });
    expect(searchRoot().className).toContain("collapsed");
    expect(onClear).not.toHaveBeenCalled();
  });

  test("keeps the trigger immediately clickable during collapse", async () => {
    renderSearch({ value: "", onClear: vi.fn() });

    const trigger = buttonByLabel("Search sessions");

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      trigger.click();
    });

    expect(searchRoot().className).toContain("closing");
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      trigger.click();
    });

    expect(searchRoot().className).toContain("expanded");
    expect(searchRoot().className).not.toContain("closing");
    expect(searchInput()).toBe(document.activeElement);
  });

  test("clears closing state after the configured search close duration", async () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--search-close-dur", "230ms");
    renderSearch({ value: "", onClear: vi.fn() });

    const trigger = buttonByLabel("Search sessions");

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      trigger.click();
    });

    expect(searchRoot().className).toContain("closing");

    await act(async () => {
      vi.advanceTimersByTime(229);
    });
    expect(searchRoot().className).toContain("closing");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(searchRoot().className).not.toContain("closing");
  });

  test("imperative focus expands and focuses the input", async () => {
    const searchRef = createRef<{ focus: () => void }>();
    renderSearch({ value: "", onClear: vi.fn(), searchRef });

    await act(async () => {
      searchRef.current?.focus();
    });

    expect(searchRoot().className).toContain("expanded");
    expect(searchInput()).toBe(document.activeElement);
  });

  test("collapsing from the search trigger preserves controlled query state", async () => {
    const onClear = vi.fn();
    renderControlledSearch({ initialValue: "codex", onClear });

    const trigger = buttonByLabel("Collapse search");

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      buttonByText("Rerender").click();
    });
    await act(async () => {
      buttonByText("External query").click();
    });

    expect(searchRoot().className).toContain("collapsed");
    expect(onClear).not.toHaveBeenCalled();
    expect(searchInput().value).toBe("codex external");
  });
});

function renderSearch({ value, onClear, searchRef }: { value: string; onClear: () => void; searchRef?: RefObject<{ focus: () => void } | null> }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <CollapsibleSearch
        label="Search sessions"
        ref={searchRef}
        placeholder="Search all session history..."
        value={value}
        onChange={() => undefined}
        onClear={onClear}
      />
    );
  });
}

function renderControlledSearch({ initialValue, onClear }: { initialValue: string; onClear: () => void }) {
  function ControlledSearch() {
    const [value, setValue] = useState(initialValue);
    const [, setRenderCount] = useState(0);

    return (
      <>
        <button type="button" onClick={() => setRenderCount((current) => current + 1)}>
          Rerender
        </button>
        <button type="button" onClick={() => setValue((current) => `${current} external`)}>
          External query
        </button>
        <CollapsibleSearch
          label="Search sessions"
          placeholder="Search all session history..."
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onClear={onClear}
        />
      </>
    );
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ControlledSearch />);
  });
}

function searchRoot(): HTMLDivElement {
  const element = container?.querySelector(".collapsible-search");
  if (!(element instanceof HTMLDivElement)) throw new Error("missing search root");
  return element;
}

function searchInput(): HTMLInputElement {
  const element = container?.querySelector("input");
  if (!(element instanceof HTMLInputElement)) throw new Error("missing search input");
  return element;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((element) => element.getAttribute("aria-label") === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
  return button;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll("button") ?? []).find((element) => element.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button ${text}`);
  return button;
}
