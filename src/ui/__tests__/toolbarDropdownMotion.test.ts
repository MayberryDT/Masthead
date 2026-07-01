import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("toolbar dropdown motion", () => {
  test("ports the prototype forged plate dropdown motion into the shared toolbar menu", () => {
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const prototypeHtml = readFileSync("mockups/toolbar-filter-metal-motion-directions.html", "utf8");

    expect(prototypeHtml).toContain("animation: forged-plate-in var(--open-dur) var(--ease-weight) both;");
    expect(prototypeHtml).toContain("animation: forged-plate-out var(--close-dur) cubic-bezier(0.42, 0, 0.7, 0.22) both;");
    expect(prototypeHtml).toContain("animation: plate-item-in 170ms var(--ease-seat) both;");
    expect(prototypeHtml).toContain("animation: selection-lock 180ms var(--ease-lock) both;");

    const rootTokens = cssRuleBody(mastheadCss, ":root");
    expect(rootTokens).toContain("--dropdown-open-dur: 190ms;");
    expect(rootTokens).toContain("--dropdown-close-dur: 150ms;");
    expect(rootTokens).toContain("--dropdown-item-dur: 90ms;");
    expect(rootTokens).toContain("--dropdown-weight-ease: cubic-bezier(0.17, 0.84, 0.25, 1);");
    expect(rootTokens).toContain("--dropdown-lock-ease: cubic-bezier(0.14, 0.74, 0.18, 1);");

    expect(cssRuleBody(mastheadCss, ".t-dropdown")).toContain("will-change: auto;");
    expect(cssRuleBody(mastheadCss, ".t-dropdown.is-open")).toContain("animation: forged-plate-in var(--dropdown-open-dur) var(--dropdown-weight-ease) both;");
    expect(cssRuleBody(mastheadCss, ".t-dropdown.is-closing")).toContain("animation: forged-plate-out var(--dropdown-close-dur) cubic-bezier(0.42, 0, 0.7, 0.22) both;");
    expect(cssRuleBody(mastheadCss, ".t-dropdown.is-open .toolbar-select-option")).toContain("animation: plate-item-in var(--dropdown-item-dur) var(--dropdown-ease) both;");
    expect(cssRuleBody(mastheadCss, ".t-dropdown.is-open .toolbar-select-option")).toContain("animation-delay: calc(18ms + var(--option-index, 0) * 4ms);");
    expect(cssRuleBody(mastheadCss, ".toolbar-select-option.is-selecting")).toContain("animation: selection-lock 120ms var(--dropdown-lock-ease) both;");

    expect(mastheadCss).toContain("@keyframes forged-plate-in");
    expect(mastheadCss).toContain("@keyframes forged-plate-out");
    expect(mastheadCss).toContain("@keyframes plate-item-in");
    expect(mastheadCss).toContain("@keyframes selection-lock");
    expect(mastheadCss).toContain("transform: none;");
  });
});

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = findCssSelectorIndex(css, selector);
  if (selectorIndex === -1) throw new Error(`Expected CSS to contain rule for ${selector}`);
  return extractCssRuleBodyAt(css, selector, selectorIndex);
}

function findCssSelectorIndex(css: string, selector: string, fromIndex = 0): number {
  let searchIndex = fromIndex;
  while (searchIndex < css.length) {
    const selectorIndex = css.indexOf(selector, searchIndex);
    if (selectorIndex === -1) return -1;
    const nextSignificantChar = css.slice(selectorIndex + selector.length).trimStart()[0];
    if (nextSignificantChar === "{" || nextSignificantChar === ",") return selectorIndex;
    searchIndex = selectorIndex + selector.length;
  }

  return -1;
}

function extractCssRuleBodyAt(css: string, selector: string, selectorIndex: number): string {
  const openBraceIndex = css.indexOf("{", selectorIndex + selector.length);
  if (openBraceIndex === -1) throw new Error(`Expected CSS rule for ${selector} to have a body`);

  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBraceIndex + 1, index);
    }
  }

  throw new Error(`Expected CSS rule for ${selector} to close`);
}
