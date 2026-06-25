import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";

describe("ObservabilitySidebar", () => {
  test("renders Masthead identity and observability nav", () => {
    const html = renderToStaticMarkup(
      <ObservabilitySidebar version="v0.1.0" activeCount={24} alertCount={3} />
    );

    expect(html).toContain("Masthead");
    expect(html).toContain("v0.1.0");
    expect(html).toContain("Sessions");
    expect(html).toContain("24");
    expect(html).not.toContain("Traces");
    expect(html).toContain("Models");
    expect(html).toContain("Alerts");
    expect(html).toContain("3");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).toContain("Overview");
    expect(html).toContain("Analysis");
    expect(html).not.toContain("Configuration");
    expect(html).toContain("Performance");
    expect(html).toContain("Usage");
    expect(html).toContain("Settings");
    expect(html).not.toContain("Costs");
    expect(html).not.toContain("Agents");
    expect(html).not.toContain("Environments");
    expect(html).not.toContain("Status");
    expect(html).not.toContain("API");
    expect(html).not.toContain("Update available");
    expect(html).not.toContain("Live collector");
    expect(html).not.toContain("Demo");
    expect(html).toContain("<img");
    expect(html).toContain("brand-sail");
  });
});
