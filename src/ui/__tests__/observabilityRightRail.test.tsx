import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ObservabilityRightRail } from "../ObservabilityRightRail";

describe("ObservabilityRightRail", () => {
  test("does not render connector controls in the telemetry rail", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        summary={{ active: 1, needsAttention: 0, conflicts: 0, completed: 0, running: 1, idle: 0, needsAction: 0 }}
      />
    );

    expect(html).not.toContain("Connector");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Reconnect");
  });

  test("renders live session telemetry without fake model or token values by default", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).toContain("Live Sessions");
    expect(html).toContain("Session Source");
    expect(html).toContain("Codex");
    expect(html).toContain("Session Mix");
    expect(html).toContain("Visible sessions");
    expect(html).toContain("24");
    expect(html).not.toContain("Total Tokens");
    expect(html).not.toContain("48.7M");
    expect(html).not.toContain("Top Models");
    expect(html).not.toContain("Tokens / Min");
    expect(html).not.toContain("12.4K");
    expect(html).not.toContain("gpt-5.5");
    expect(html).not.toContain("gpt-5.4");
    expect(html).not.toContain("Demo data");
  });

  test("renders reference telemetry only when demo telemetry is requested", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
        showDemoTelemetry
      />
    );

    expect(html).toContain("Total Tokens (24h)");
    expect(html).toContain("48.7M");
    expect(html).toContain("Top Models (24h)");
    expect(html).toContain("Tokens / Min");
    expect(html).toContain("12.4K");
    expect(html).not.toContain("Total Cost");
    expect(html).not.toContain("Cost</span>");
    expect(html).not.toContain("$123.47");
    expect(html).not.toContain("Demo data");
    expect(html).not.toContain("Recent Errors");
    expect(html).not.toContain("Resource Utilization");
  });

  test("does not render toolbar controls in the telemetry rail by default", () => {
    const html = renderToStaticMarkup(
      <ObservabilityRightRail
        summary={{ active: 16, needsAttention: 3, conflicts: 0, completed: 0, running: 16, idle: 5, needsAction: 3 }}
      />
    );

    expect(html).not.toContain("rail-controls");
    expect(html).not.toContain("24h");
  });
});
