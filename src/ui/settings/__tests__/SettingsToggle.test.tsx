// @vitest-environment happy-dom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SettingsToggle } from "../SettingsToggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

describe("SettingsToggle", () => {
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  test("renders a controlled wired toggle", async () => {
    const onChange = vi.fn();
    await renderToggle(<SettingsToggle checked={false} label="Enable motion" offLabel="Motion off" onChange={onChange} onLabel="Motion on" />);

    const label = currentContainer().querySelector<HTMLLabelElement>(".settings-toggle");
    const input = currentContainer().querySelector<HTMLInputElement>("input");
    expect(label).not.toBeNull();
    expect(input?.checked).toBe(false);
    expect(label?.className).not.toContain("checked");
    expect(label?.textContent).toContain("Motion off");

    await act(async () => {
      input?.click();
    });

    expect(onChange).toHaveBeenCalledWith(true);
    expect(input?.checked).toBe(false);
  });

  test("disables itself when no persistence handler is wired", async () => {
    await renderToggle(<SettingsToggle checked={false} label="Enable motion" />);

    const input = currentContainer().querySelector<HTMLInputElement>("input");
    expect(input?.disabled).toBe(true);
  });
});

async function renderToggle(element: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(element);
  });
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}
