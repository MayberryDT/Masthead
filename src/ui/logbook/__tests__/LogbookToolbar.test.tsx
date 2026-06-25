import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LogbookToolbar } from "../LogbookToolbar";

describe("LogbookToolbar", () => {
  test("renders search, sort, density, and canonical filter controls with shared primitives", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        density="comfortable"
        filterOptions={{ lifecycles: ["running", "ended"], models: ["gpt-5"], runtimes: ["codex", "claude"] }}
        filters={{ dateFrom: "2026-06-01", dateTo: "2026-06-25", file: "src/app", model: "gpt-5", project: "Masthead", runtime: "codex", state: "ended" }}
        query="oauth"
        sort="files_desc"
        onDensityToggle={() => undefined}
        onFilterChange={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search all session history");
    expect(html).toContain("Runtime filter");
    expect(html).toContain("Lifecycle filter");
    expect(html).toContain("Masthead");
    expect(html).toContain("gpt-5");
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-25");
    expect(html).toContain("src/app");
    expect(html).toContain("Files changed");
    expect(html).toContain('aria-label="Compact rows"');
    expect(html).not.toContain("<select");
  });
});
