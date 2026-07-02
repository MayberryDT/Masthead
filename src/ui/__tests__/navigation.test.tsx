import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";
import { APP_VERSION_LABEL } from "../../app/version";

describe("product navigation", () => {
  test("shows only product surfaces that exist", () => {
    const html = renderToStaticMarkup(<ObservabilitySidebar version={APP_VERSION_LABEL} activeCount={2} />);

    expect(html).toContain("Board");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).toContain("Usage");
    expect(html).toContain("Settings");
    expect(html).not.toContain("href=\"#");
    expect(html).not.toContain("Agent Access");
    expect(html).not.toContain("#agent-access");
    expect(html).not.toContain("Performance");
    expect(html).not.toContain("Models");
    expect(html).not.toContain("Alerts");
  });
});
