import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  readReleaseJsonFile,
  releaseJsonPathBesideMcpEntry,
  resolveReleaseIdentity
} from "../releaseIdentity.ts";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("releaseIdentity", () => {
  test("prefers non-empty MASTHEAD_BUILD_* env over development defaults", () => {
    expect(
      resolveReleaseIdentity({
        MASTHEAD_BUILD_SHA: "a".repeat(40),
        MASTHEAD_BUILD_VERSION: "0.1.15"
      })
    ).toEqual({ gitSha: "a".repeat(40), version: "0.1.15" });
  });

  test("reads release.json next to packaged mcp entry layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-release-id-"));
    cleanup.push(root);
    const daemonRoot = join(root, "daemon");
    const mcpEntry = join(daemonRoot, "dist", "src", "mcp", "server.js");
    await mkdir(join(daemonRoot, "dist", "src", "mcp"), { recursive: true });
    await writeFile(
      join(daemonRoot, "release.json"),
      `${JSON.stringify({ gitSha: "b".repeat(40), version: "0.1.15" }, null, 2)}\n`
    );
    expect(releaseJsonPathBesideMcpEntry(mcpEntry)).toBe(join(daemonRoot, "release.json"));
    expect(readReleaseJsonFile(join(daemonRoot, "release.json"))).toEqual({
      gitSha: "b".repeat(40),
      version: "0.1.15"
    });
    expect(
      resolveReleaseIdentity({
        MASTHEAD_RELEASE_JSON: join(daemonRoot, "release.json")
      })
    ).toEqual({ gitSha: "b".repeat(40), version: "0.1.15" });
  });
});
