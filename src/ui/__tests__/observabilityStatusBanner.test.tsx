import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityStatusBanner } from "../ObservabilityStatusBanner";

describe("ObservabilityStatusBanner", () => {
  test("summarizes real session status in screenshot banner style", () => {
    const html = renderToStaticMarkup(
      <ObservabilityStatusBanner
        summary={{ active: 16, needsAttention: 3, conflicts: 1, completed: 9, running: 16, idle: 5, needsAction: 3 }}
        environmentCount={3}
      />
    );

    expect(html).toContain("System status:");
    expect(html).toContain("16 active");
    expect(html).toContain("5 idle");
    expect(html).toContain("3 blocked");
    expect(html).toContain("Healthy");
    expect(html).toContain("Demo data");
  });
});
