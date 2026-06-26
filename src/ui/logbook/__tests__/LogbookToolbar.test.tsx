import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LogbookToolbar } from "../LogbookToolbar";

describe("LogbookToolbar", () => {
  test("renders compact Logbook controls with advanced filters in the drawer", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex", "claude"] }}
        filters={{ dateFrom: "2026-06-01", dateTo: "2026-06-25", file: "src/app", model: "gpt-5", project: "Masthead", runtime: "codex" }}
        query="oauth"
        sort="files_desc"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search all session history");
    expect(html).toContain("Search sessions");
    expect(html.indexOf("Filters 5")).toBeLessThan(html.indexOf("Runtime filter"));
    expect(html).toContain("Filters 5");
    expect(html).toContain("Project filter");
    expect(html).toContain("Model filter");
    expect(html).toContain("Masthead");
    expect(html).toContain("gpt-5");
    expect(html).toContain("Date");
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-25");
    expect(html).toContain("Filter changed files");
    expect(html).toContain("Files changed");
    expect(html.indexOf("Search sessions")).toBeLessThan(html.indexOf("Filters 5"));
    expect(html.indexOf("Runtime filter")).toBeLessThan(html.indexOf("Files changed"));
    expect(html).not.toContain("Lifecycle filter");
    expect(html).not.toContain("Compact rows");
    expect(html).not.toContain("<select");
  });

  test("keeps advanced filters collapsed by default without active filters", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        filterOptions={{ projects: ["Masthead"], models: ["gpt-5"], runtimes: ["codex"] }}
        filters={{}}
        query=""
        sort="recent"
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain('class="logbook-toolbar"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Filters");
    expect(html).not.toContain("Filters 1");
  });
});
