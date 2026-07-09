import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow";
import { SidebarKnowledgeFlow } from "../SidebarKnowledgeFlow";

const summary: KnowledgeFlowSummaryDto = {
  capturedSessions: 17,
  workbenchSessions: 6,
  publishedArtifacts: 11,
  automaticallyResolvedSessions: 4
};

describe("SidebarKnowledgeFlow", () => {
  test("renders loaded inventory values in the approved flow order", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} />);

    expect(html).toContain('aria-label="Knowledge flow"');
    expect(html).toContain("Captured sessions");
    expect(html).toContain("In Workbench");
    expect(html).toContain("Published artifacts");
    expect(html).toContain(">17<");
    expect(html).toContain(">6<");
    expect(html).toContain(">11<");
    expect(html).toContain("4 automatically resolved");
  });

  test("renders zero as valid inventory", () => {
    const html = renderToStaticMarkup(
      <SidebarKnowledgeFlow
        summary={{
          capturedSessions: 0,
          workbenchSessions: 0,
          publishedArtifacts: 0,
          automaticallyResolvedSessions: 0
        }}
      />
    );

    expect(html.match(/>0</g)).toHaveLength(3);
    expect(html).toContain("0 automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("renders em dashes while loading", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow loading />);

    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("— automatically resolved");
    expect(html).not.toContain("Summary unavailable");
  });

  test("renders the unavailable state without stale values", () => {
    const html = renderToStaticMarkup(<SidebarKnowledgeFlow summary={summary} error="offline" />);

    expect(html).toContain('class="sidebar-knowledge-flow unavailable"');
    expect(html.match(/>—</g)).toHaveLength(3);
    expect(html).toContain("Summary unavailable");
    expect(html).not.toContain("4 automatically resolved");
  });

  test("uses the approved green resolution note and shared steel shell", () => {
    const css = readFileSync(new URL("../../styles/masthead.css", import.meta.url), "utf8");
    const resolvedRule = cssRuleBody(css, ".sidebar-knowledge-resolved");
    const unavailableRule = cssRuleBody(css, ".sidebar-knowledge-flow.unavailable .sidebar-knowledge-resolved");
    const shellRule = cssRuleBodyContaining(
      css,
      ".masthead-shell .sidebar-knowledge-flow",
      "background: #071b28;"
    );
    const bottomEdgeRule = cssRuleBodyContaining(
      css,
      ".masthead-shell .sidebar-knowledge-flow::after",
      "border-bottom: 2px solid rgba(46, 167, 255, 0.42);"
    );

    expect(resolvedRule).toContain("color: var(--green);");
    expect(unavailableRule).toContain("color: var(--ash);");
    expect(shellRule).toContain("border: 1px solid rgba(92, 153, 187, 0.14);");
    expect(shellRule).toContain("border-radius: 5px;");
    expect(shellRule).toContain("background: #071b28;");
    expect(shellRule).toContain("box-shadow: none;");
    expect(bottomEdgeRule).toContain("border-bottom: 2px solid rgba(46, 167, 255, 0.42);");
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
