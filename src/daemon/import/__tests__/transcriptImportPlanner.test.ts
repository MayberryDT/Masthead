import { describe, expect, test } from "vitest";
import type { DiscoveredSource } from "../../../adapters/types.ts";
import { planTranscriptImportUnits, transcriptPlanForWorkUnit } from "../transcriptImportPlanner.ts";

const source = (path?: string): DiscoveredSource => ({
  confidence: "authoritative",
  path,
  runtime: "hermes",
  sourceId: "planner-test:hermes",
  sourceKind: "jsonl"
});

describe("transcript import planning", () => {
  test("fails closed when adapter planning produces no units", async () => {
    await expect(planTranscriptImportUnits([source()])).rejects.toThrow("adapter produced no import units");
  });

  test("preserves a generic unit only when the adapter explicitly plans it", async () => {
    await expect(planTranscriptImportUnits([source("/tmp/masthead-explicit-missing-hermes.jsonl")])).resolves.toMatchObject([
      { timestampBasis: "unknown", unitId: "/tmp/masthead-explicit-missing-hermes.jsonl" }
    ]);
  });

  test("fails closed when a ledger unit has no exact planned unit", () => {
    expect(() =>
      transcriptPlanForWorkUnit([], {
        runtime: "hermes",
        sourcePath: "/tmp/unplanned.jsonl",
        workUnitId: "unit:unplanned"
      })
    ).toThrow("expected one planned unit, found 0");
  });
});
