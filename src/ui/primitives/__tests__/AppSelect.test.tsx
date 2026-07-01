// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppSelect } from "../AppSelect";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  vi.useRealTimers();
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
  document.body.innerHTML = "";
});

describe("AppSelect", () => {
  test("renders the closed Board dropdown trigger as a reusable primitive", () => {
    const html = renderToStaticMarkup(
      <AppSelect
        label="Harnesses"
        icon="harness"
        value="all"
        options={[
          { value: "all", label: "All Harnesses" },
          { value: "codex", label: "Codex" }
        ]}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('class="toolbar-select metal-control');
    expect(html).toContain('class="toolbar-select-trigger"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    expect(html).toContain("All Harnesses");
  });

  test("preserves width modifier classes for toolbar parity", () => {
    const html = renderToStaticMarkup(
      <AppSelect
        label="Refresh rate"
        icon="refreshInterval"
        value="10000"
        className="refresh"
        options={[{ value: "10000", label: "10s" }]}
        onChange={() => undefined}
      />
    );

    expect(html).toContain('class="toolbar-select metal-control  refresh"');
  });

  test("opens menu items with stagger indices and a selection lock state", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderSelect(onChange);

    await act(async () => {
      triggerButton().click();
    });

    const options = portalOptions();
    expect(options).toHaveLength(2);
    expect(options[0].style.getPropertyValue("--option-index")).toBe("0");
    expect(options[1].style.getPropertyValue("--option-index")).toBe("1");

    await act(async () => {
      options[1].click();
    });

    expect(onChange).toHaveBeenCalledWith("codex");
    expect(options[1].className).toContain("is-selecting");
    expect(portalMenu().className).toContain("is-open");

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(portalMenu().className).toContain("is-closing");
  });
});

function renderSelect(onChange: (value: string) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AppSelect
        label="Harnesses"
        icon="harness"
        value="all"
        options={[
          { value: "all", label: "All Harnesses" },
          { value: "codex", label: "Codex" }
        ]}
        onChange={onChange}
      />
    );
  });
}

function triggerButton(): HTMLButtonElement {
  const button = container?.querySelector(".toolbar-select-trigger");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing AppSelect trigger");
  return button;
}

function portalMenu(): HTMLDivElement {
  const menu = document.body.querySelector(".toolbar-select-menu.t-dropdown");
  if (!(menu instanceof HTMLDivElement)) throw new Error("missing AppSelect portal menu");
  return menu;
}

function portalOptions(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll(".toolbar-select-option")).filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
}
