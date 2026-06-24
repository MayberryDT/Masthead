import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MetricCard } from "../MetricCard";

describe("MetricCard", () => {
  test("renders real metric values without demo badge", () => {
    const html = renderToStaticMarkup(<MetricCard label="Active Sessions" value="16" tone="good" source="real" />);

    expect(html).toContain("Active Sessions");
    expect(html).toContain("16");
    expect(html).not.toContain("Demo data");
  });

  test("renders demo metric values with demo badge", () => {
    const html = renderToStaticMarkup(
      <MetricCard label="Total Tokens (24h)" value="48.7M" delta="+12.1M" tone="good" source="demo" />
    );

    expect(html).toContain("Total Tokens (24h)");
    expect(html).toContain("48.7M");
    expect(html).toContain("Demo data");
  });
});
