import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const mastheadCss = readFileSync(new URL("../../styles/masthead.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = mastheadCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? "";
}

describe("Electron window chrome styles", () => {
  test("keeps window controls out of the bottom titlebar rule", () => {
    expect(cssRule(".masthead-shell.desktop-chrome .masthead-workspace")).toMatch(/grid-template-rows:\s*30px\s+minmax\(0,\s*1fr\);/);
    expect(cssRule(".masthead-window-bar")).toMatch(/height:\s*30px;/);
    expect(cssRule(".masthead-window-bar")).not.toMatch(/border-bottom\s*:/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/bottom:\s*0;/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/height:\s*1px;/);
    expect(cssRule(".masthead-window-bar::after")).toMatch(/z-index:\s*2;/);
    expect(cssRule(".masthead-window-controls")).toMatch(/align-self:\s*flex-start;/);
    expect(cssRule(".masthead-window-controls")).toMatch(/height:\s*calc\(100%\s*-\s*1px\);/);
    expect(cssRule(".masthead-window-control::before")).toBe("");
    expect(cssRule(".masthead-window-control")).toMatch(/width:\s*32px;/);
    expect(cssRule(".masthead-window-control::after")).toMatch(/inset:\s*2px\s+2px\s+0;/);
    expect(cssRule(".masthead-window-control:hover")).not.toMatch(/background\s*:/);
    expect(cssRule(".masthead-window-control:hover::after")).toMatch(/opacity:\s*1;/);
  });
});
