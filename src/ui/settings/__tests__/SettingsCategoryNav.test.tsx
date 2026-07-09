// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SettingsCategoryNav } from "../SettingsCategoryNav";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

describe("SettingsCategoryNav", () => {
  test("renders the settings categories and reports selection", async () => {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<SettingsCategoryNav active="general" onChange={onChange} />);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "General",
      "Data",
      "Agent access",
      "Advanced",
      "Danger zone"
    ]);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[0]?.className).toBe("active");

    await act(async () => {
      buttons[1]?.click();
    });

    expect(onChange).toHaveBeenCalledWith("data");
  });
});
