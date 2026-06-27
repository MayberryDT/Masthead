import { describe, expect, test } from "vitest";
import { shouldRefreshSourceInventory } from "../sourceInventoryRefresh";

describe("shouldRefreshSourceInventory", () => {
  test("skips non-sources surfaces", () => {
    expect(shouldRefreshSourceInventory({ activeSurface: "now", now: 20_000 })).toBe(false);
  });

  test("refreshes sources when inventory was never loaded", () => {
    expect(shouldRefreshSourceInventory({ activeSurface: "sources", now: 20_000 })).toBe(true);
  });

  test("skips sources refresh when inventory is fresh", () => {
    expect(
      shouldRefreshSourceInventory({
        activeSurface: "sources",
        lastLoadedAt: 15_000,
        now: 20_000,
        ttlMs: 10_000
      })
    ).toBe(false);
  });

  test("refreshes sources when inventory is stale or forced", () => {
    expect(
      shouldRefreshSourceInventory({
        activeSurface: "sources",
        lastLoadedAt: 5_000,
        now: 20_000,
        ttlMs: 10_000
      })
    ).toBe(true);
    expect(
      shouldRefreshSourceInventory({
        activeSurface: "sources",
        force: true,
        lastLoadedAt: 19_999,
        now: 20_000,
        ttlMs: 10_000
      })
    ).toBe(true);
  });
});
