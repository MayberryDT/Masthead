import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";
import { APP_VERSION_LABEL } from "../../app/version";

describe("product navigation", () => {
  test("shows only product surfaces that exist", () => {
    const html = renderToStaticMarkup(<ObservabilitySidebar version={APP_VERSION_LABEL} activeCount={2} />);

    expect(html).toContain("Now");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).toContain("Workbench");
    expect(html).toContain("Settings");
    expect(navOrder(html, ["Now", "Workbench", "Logbook", "Sources", "Settings"])).toBe(true);
    expect(html).not.toContain("href=\"#");
    expect(html).not.toContain("Usage");
    expect(html).not.toContain("Agent Access");
    expect(html).toContain("Knowledge flow");
    expect(html).not.toContain("#agent-access");
    expect(html).not.toContain("Performance");
    expect(html).not.toContain("Models");
    expect(html).not.toContain("Alerts");
  });
});

function navOrder(html: string, labels: string[]): boolean {
  let previous = -1;
  for (const label of labels) {
    const index = html.indexOf(`>${label}<`);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}
