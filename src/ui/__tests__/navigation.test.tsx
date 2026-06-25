import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";

describe("product navigation", () => {
  test("shows only product surfaces that exist", () => {
    const html = renderToStaticMarkup(<ObservabilitySidebar version="v0.1.0" activeCount={2} />);

    expect(html).toContain("Now");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).toContain("Agent Access");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Performance");
    expect(html).not.toContain("Usage");
    expect(html).not.toContain("Models");
    expect(html).not.toContain("Alerts");
  });
});
