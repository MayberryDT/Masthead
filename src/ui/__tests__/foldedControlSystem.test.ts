import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("folded sheet-metal control system", () => {
  test("ports option 4 control treatment from the prototype", () => {
    const mastheadCss = readFileSync("src/styles/masthead.css", "utf8");
    const prototypeHtml = readFileSync("mockups/control-system-directions.html", "utf8");

    const option4Rule = cssRuleBody(prototypeHtml, ".d4");
    const foldedTokenRule = cssRuleBodyContaining(mastheadCss, ".masthead-shell", "--folded-control-texture");

    expect(foldedTokenRule).toContain("--folded-control-clip: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%);");
    expect(cssDeclaration(option4Rule, "--texture")).toContain("repeating-linear-gradient(135deg");
    expect(foldedTokenRule).toContain("--folded-control-texture: repeating-linear-gradient(135deg, rgba(196, 226, 248, 0.012) 0 1px, transparent 1px 18px);");

    for (const selector of [
      ".masthead-shell .observability-toolbar::before",
      ".masthead-shell .sidebar-group > div",
      ".masthead-shell .usage-toolbar",
      ".masthead-shell .import-jobs-section"
    ]) {
      const plateRule = cssRuleBody(mastheadCss, selector);
      expect(plateRule, selector).toContain("clip-path: var(--folded-control-clip);");
      expect(plateRule, selector).toContain("var(--folded-control-texture)");
    }

    for (const selector of [
      ".masthead-shell .sidebar-link",
      ".masthead-shell .app-button",
      ".masthead-shell .toolbar-select",
      ".masthead-shell .observability-toolbar .search-field",
      ".masthead-shell .filterable-select-search",
      ".masthead-shell .settings-text-input",
      ".masthead-shell .settings-delete-controls input",
      ".masthead-shell .dossier-transcript-toolbar input",
      ".masthead-shell .usage-toolbar button"
    ]) {
      expect(cssRuleBody(mastheadCss, selector), selector).toContain("clip-path: var(--folded-control-clip);");
    }

    expect(cssRuleBodyContaining(mastheadCss, ".masthead-shell .app-button", "background-image:")).not.toContain("--folded-control-texture");
    expect(cssRuleBodyContaining(mastheadCss, ".masthead-shell .toolbar-select", "background-image:")).not.toContain("--folded-control-texture");
    expect(cssRuleBodyContaining(mastheadCss, ".masthead-shell .toolbar-select-menu", "background:")).not.toContain("--folded-control-texture");
    expect(cssRuleBodyContaining(mastheadCss, ".masthead-shell .toolbar-select-menu::after", "background-image: none;")).toContain("opacity: 0;");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .import-jobs-summary div")).toContain("background: #071b28;");
    expect(mastheadCss).not.toContain(".masthead-shell .session-card,\n.masthead-shell .app-button");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .collapsible-search.expanded .collapsible-search-trigger")).toContain("background-image: none;");
    expect(cssRuleBody(mastheadCss, ".masthead-shell .collapsible-search.expanded .collapsible-search-trigger")).toContain("box-shadow: none;");
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

function cssDeclaration(ruleBody: string, property: string): string {
  const declaration = ruleBody
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${property}:`));
  if (!declaration) throw new Error(`Expected CSS declaration for ${property}`);
  return declaration.replace("--texture", "--folded-control-texture") + ";";
}
