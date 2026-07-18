// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AppShell } from "../AppShell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mastheadCss = readFileSync(resolve(process.cwd(), "src/styles/masthead.css"), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = mastheadCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("Electron window chrome styles", () => {
  afterEach(() => {
    delete window.mastheadDesktop;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  test("renders only the safe draggable title bar when the desktop bridge is available", async () => {
    window.mastheadDesktop = {
      invoke: vi.fn(async () => ({ ok: true })) as unknown as NonNullable<Window["mastheadDesktop"]>["invoke"]
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppShell, { sidebar: createElement("nav"), main: createElement("section") }));
    });

    const windowBar = container.querySelector(".masthead-window-bar");
    expect(windowBar).not.toBeNull();
    expect(windowBar?.tagName).toBe("DIV");
    expect(windowBar?.getAttribute("aria-hidden")).toBe("true");
    expect(windowBar?.getAttribute("aria-label")).toBeNull();
    expect(container.querySelector(".masthead-window-drag-region")).not.toBeNull();
    expect(container.querySelector(".masthead-window-controls")).toBeNull();
    expect(container.querySelectorAll(".masthead-window-control")).toHaveLength(0);

    await act(async () => root.unmount());
  });

  test("uses the native overlay safe area without renderer control styles", () => {
    expect(cssRule(".masthead-shell.desktop-chrome .masthead-workspace")).toMatch(
      /grid-template-rows:\s*env\(titlebar-area-height,\s*32px\)\s+minmax\(0,\s*1fr\);/
    );
    expect(cssRule(".masthead-window-bar")).toMatch(/height:\s*env\(titlebar-area-height,\s*32px\);/);
    expect(cssRule(".masthead-window-bar")).not.toMatch(/border-bottom\s*:/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/bottom:\s*0;/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/height:\s*1px;/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/z-index:\s*2;/);
    expect(cssRule(".masthead-window-drag-region")).toMatch(/position:\s*absolute;/);
    expect(cssRule(".masthead-window-drag-region")).toMatch(/left:\s*env\(titlebar-area-x,\s*0px\);/);
    expect(cssRule(".masthead-window-drag-region")).toMatch(/width:\s*env\(titlebar-area-width,\s*100%\);/);
    expect(cssRule(".masthead-window-drag-region")).toMatch(/-webkit-app-region:\s*drag;/);
    expect(mastheadCss).not.toMatch(/\.masthead-window-controls?\b/);
  });
});
