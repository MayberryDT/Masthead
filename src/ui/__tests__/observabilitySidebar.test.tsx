import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilitySidebar } from "../ObservabilitySidebar";
import { APP_VERSION_LABEL } from "../../app/version";
import { iconRegistry } from "../icons/icon-registry";

describe("ObservabilitySidebar", () => {
  test("renders Masthead identity and session product nav", () => {
    const html = renderToStaticMarkup(<ObservabilitySidebar version={APP_VERSION_LABEL} activeCount={24} />);

    expect(html).toContain("Masthead");
    expect(html).toContain(APP_VERSION_LABEL);
    expect(html).toContain("Now");
    expect(html).toContain("Workbench");
    expect(html).toContain("24");
    expect(html).not.toContain("Traces");
    expect(html).not.toContain("Models");
    expect(html).not.toContain("Alerts");
    expect(html).toContain("Logbook");
    expect(html).toContain("Sources");
    expect(html).toContain("Usage");
    expect(html).not.toContain("Agent Access");
    expect(html).not.toContain("Workspace");
    expect(html).not.toContain("Overview");
    expect(html).not.toContain("Analysis");
    expect(html).not.toContain("Configuration");
    expect(html).not.toContain("Performance");
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
    expect(html).toContain("<button");
    expect(html).not.toContain("href=\"#");
  });

  test("Workbench and Logbook use distinct registry icons", () => {
    expect(iconRegistry.workbench).not.toBe(iconRegistry.logbook);
  });
});
