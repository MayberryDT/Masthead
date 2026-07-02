import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createDetectorAdapter } from "../generic/detectorAdapter.ts";
import { harnessForRuntime } from "../harnessCatalog.ts";
import type { DiscoveryContext } from "../types.ts";

describe("detector adapter", () => {
  test("detects readable catalog roots without emitting import records", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-detector-"));
    await mkdir(join(homeDir, ".crush"));
    const context: DiscoveryContext = {
      exclusions: [],
      homeDir,
      now: "2026-06-23T02:04:00.000Z"
    };
    const adapter = createDetectorAdapter(harnessForRuntime("crush")!);

    const sources = await adapter.discover(context);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      confidence: "heuristic",
      runtime: "crush",
      sourceKind: "inference"
    });

    const inventory = await adapter.inspect(sources[0]!);
    expect(inventory.sessionCount).toBe(0);
    expect(inventory.recordCount).toBe(0);
    expect(inventory.failures).toEqual([
      expect.objectContaining({
        code: "crush_detector_only",
        observedAt: context.now,
        severity: "info"
      })
    ]);

    const records = [];
    for await (const record of adapter.backfill(sources[0]!)) records.push(record);
    expect(records).toEqual([]);
  });
});
