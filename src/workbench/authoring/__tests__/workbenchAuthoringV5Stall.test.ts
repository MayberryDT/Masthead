import { describe, expect, test } from "vitest";
import {
  WORKBENCH_AUTHORING_V5_STALL_MS,
  evaluateAuthoringCampaignStall
} from "../workbenchAuthoringV5Stall";

describe("evaluateAuthoringCampaignStall", () => {
  const updatedAt = "2026-07-28T21:40:25.195Z";
  const base = Date.parse(updatedAt);

  test("not stalled inside threshold", () => {
    const result = evaluateAuthoringCampaignStall({
      updatedAt,
      nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS - 1
    });
    expect(result.stalled).toBe(false);
    expect(result.idleMs).toBe(WORKBENCH_AUTHORING_V5_STALL_MS - 1);
  });

  test("stalled at and beyond threshold", () => {
    expect(
      evaluateAuthoringCampaignStall({
        updatedAt,
        nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS
      }).stalled
    ).toBe(true);
    expect(
      evaluateAuthoringCampaignStall({
        updatedAt,
        nowMs: base + WORKBENCH_AUTHORING_V5_STALL_MS + 3_600_000
      }).idleMs
    ).toBe(WORKBENCH_AUTHORING_V5_STALL_MS + 3_600_000);
  });

  test("invalid updatedAt yields not stalled with idleMs 0", () => {
    expect(evaluateAuthoringCampaignStall({ updatedAt: "nope", nowMs: base })).toEqual({
      stalled: false,
      idleMs: 0
    });
  });
});
