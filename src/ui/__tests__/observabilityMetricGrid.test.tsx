import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityMetricGrid } from "../ObservabilityMetricGrid";

describe("ObservabilityMetricGrid", () => {
  test("mixes real lifecycle counts with marked demo telemetry", () => {
    const html = renderToStaticMarkup(
      <ObservabilityMetricGrid
        summary={{ active: 16, needsAttention: 3, conflicts: 1, completed: 9, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).toContain("Active Sessions");
    expect(html).toContain("Idle Sessions");
    expect(html).toContain("Blocked Sessions");
    expect(html).toContain("Total Tokens (24h)");
    expect(html).toContain("Avg. Latency");
    expect(html).toContain("Errors (24h)");
    expect(html).toContain("Total Cost (24h)");
    expect(html).toContain("Demo data");
  });
});
