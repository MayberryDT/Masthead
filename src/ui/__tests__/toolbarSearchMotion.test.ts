import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("toolbar search motion", () => {
  test("ports the selected telescoping steel rail search motion from the prototype", () => {
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const prototypeHtml = readFileSync("docs/archive/design-mockups/toolbar-filter-metal-motion-directions.html", "utf8");

    expect(prototypeHtml).toContain('"Telescoping Steel Rail"');
    expect(prototypeHtml).toContain("animation: telescoping-rail-in 300ms var(--ease-lock) both;");
    expect(prototypeHtml).toContain("animation: rail-teeth-in 300ms steps(5, end) both;");
    expect(prototypeHtml).toContain("animation: telescoping-rail-out 220ms cubic-bezier(0.42, 0, 0.64, 0.24) both;");

    const rootTokens = cssRuleBody(mastheadCss, ":root");
    expect(rootTokens).toContain("--search-now-open-dur: 300ms;");
    expect(rootTokens).toContain("--search-close-dur: 230ms;");
    expect(rootTokens).toContain("--search-rail-ease: cubic-bezier(0.14, 0.74, 0.18, 1);");

    expect(cssRuleBody(mastheadCss, ".collapsible-search")).toContain("var(--search-rail-ease)");
    expect(cssRuleBody(mastheadCss, ".observability-toolbar .collapsible-search.now-search.expanded")).toContain("var(--search-rail-ease)");
    expect(cssRuleBody(mastheadCss, ".collapsible-search-panel")).toContain("transform-origin: left center;");

    expect(cssRuleBody(mastheadCss, ".collapsible-search-panel::after")).toContain("repeating-linear-gradient(90deg");
    expect(cssRuleBody(mastheadCss, ".collapsible-search-panel::after")).toContain("transform: translateX(-38px);");
    expect(cssRuleBody(mastheadCss, ".collapsible-search.expanded .collapsible-search-panel")).toContain("animation: search-telescoping-rail-in var(--search-now-open-dur) var(--search-rail-ease) both;");
    expect(cssRuleBody(mastheadCss, ".collapsible-search.expanded .collapsible-search-panel::after")).toContain("animation: search-rail-teeth-in var(--search-now-open-dur) steps(5, end) both;");
    expect(cssRuleBody(mastheadCss, ".collapsible-search.closing .collapsible-search-panel")).toContain("animation: search-telescoping-rail-out var(--search-close-dur) cubic-bezier(0.42, 0, 0.64, 0.24) both;");
    expect(cssRuleBodyContaining(mastheadCss, ".observability-toolbar .collapsible-search.expanded", "flex: 1 1 100%;")).toContain("max-width: 100%;");
    expect(cssRuleBodyContaining(mastheadCss, ".observability-toolbar .collapsible-search.now-search.expanded", "flex: 1 1 100%;")).toContain("max-width: 100%;");

    expect(mastheadCss).toContain("@keyframes search-telescoping-rail-in");
    expect(mastheadCss).toContain("@keyframes search-rail-teeth-in");
    expect(mastheadCss).toContain("@keyframes search-telescoping-rail-out");
  });
});

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = findCssSelectorIndex(css, selector);
  if (selectorIndex === -1) throw new Error(`Expected CSS to contain rule for ${selector}`);
  return extractCssRuleBodyAt(css, selector, selectorIndex);
}

function cssRuleBodyContaining(css: string, selector: string, containedText: string): string {
  let fromIndex = 0;
  while (fromIndex < css.length) {
    const selectorIndex = findCssSelectorIndex(css, selector, fromIndex);
    if (selectorIndex === -1) break;
    const body = extractCssRuleBodyAt(css, selector, selectorIndex);
    if (body.includes(containedText)) return body;
    fromIndex = selectorIndex + selector.length;
  }

  throw new Error(`Expected CSS rule for ${selector} to contain ${containedText}`);
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
