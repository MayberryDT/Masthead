// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
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

  test("toggles local visual state when no persistence handler is wired yet", async () => {
    await renderToggle();

    const label = currentContainer().querySelector<HTMLLabelElement>(".settings-toggle");
    const input = currentContainer().querySelector<HTMLInputElement>("input");
    expect(label).not.toBeNull();
    expect(input?.checked).toBe(false);
    expect(label?.textContent).toContain("Disabled");

    await act(async () => {
      label?.click();
    });

    expect(input?.checked).toBe(true);
    expect(label?.textContent).toContain("Enabled");
  });
});

async function renderToggle() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<SettingsToggle label="Transcript import" checked={false} />);
  });
}

function currentContainer(): HTMLDivElement {
  expect(container).toBeDefined();
  return container as HTMLDivElement;
}
