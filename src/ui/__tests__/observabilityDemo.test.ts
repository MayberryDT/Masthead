import { describe, expect, test } from "vitest";
import {
  observabilityDemoTelemetry,
  sessionDemoTelemetry,
  sourceLabelForDemoValue
} from "../observabilityDemo";

describe("observability demo telemetry", () => {
  test("marks every global invented metric as demo data", () => {
    expect(observabilityDemoTelemetry.tokens24h.source).toBe("demo");
    expect(observabilityDemoTelemetry.avgLatency.source).toBe("demo");
    expect(observabilityDemoTelemetry.errors24h.source).toBe("demo");
    expect(observabilityDemoTelemetry.totalCost24h.source).toBe("demo");
    expect(observabilityDemoTelemetry.topModels.every((model) => model.source === "demo")).toBe(true);
    expect(observabilityDemoTelemetry.topModels[0].model).toBe("gpt-5.5");
    expect(observabilityDemoTelemetry.resourceSeries.every((series) => series.source === "demo")).toBe(true);
  });

  test("marks per-session invented metrics as demo data", () => {
    const telemetry = sessionDemoTelemetry("session-abc", 1);

    expect(telemetry.model.source).toBe("demo");
    expect(telemetry.harness.source).toBe("demo");
    expect(["OpenCode", "Claude Code", "Cursor", "Hermes"]).toContain(telemetry.harness.value);
    expect(telemetry.host.source).toBe("demo");
    expect(telemetry.commands.source).toBe("demo");
    expect(telemetry.filesChanged.source).toBe("demo");
    expect(telemetry.filesChanged.value.added).toBeGreaterThanOrEqual(0);
    expect(telemetry.filesChanged.value.removed).toBeGreaterThanOrEqual(0);
    expect(telemetry.filesChanged.value.bars.length).toBe(10);
    expect(telemetry.progress.source).toBe("demo");
    expect(sourceLabelForDemoValue(telemetry.model)).toBe("Demo data");
  });
});
