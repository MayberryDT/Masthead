import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DemoBadge } from "../DemoBadge";

describe("DemoBadge", () => {
  test("renders a consistent demo data marker", () => {
    const html = renderToStaticMarkup(<DemoBadge />);

    expect(html).toContain("Demo data");
    expect(html).toContain('aria-label="Demo data marker"');
  });
});
