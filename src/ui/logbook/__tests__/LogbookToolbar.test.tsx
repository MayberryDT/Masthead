import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LogbookToolbar } from "../LogbookToolbar";

describe("LogbookToolbar", () => {
  test("renders search, sort, density, and facet controls with shared primitives", () => {
    const html = renderToStaticMarkup(
      <LogbookToolbar
        density="comfortable"
        query=""
        sort="recent"
        onDensityToggle={() => undefined}
        onQueryChange={() => undefined}
        onSortChange={() => undefined}
      />
    );

    expect(html).toContain("Search all session history");
    expect(html).toContain("Recent");
    expect(html).toContain("Files changed");
    expect(html).toContain("Errors");
    expect(html).toContain('aria-label="Compact rows"');
    expect(html).not.toContain("<select");
  });
});
