import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertSafeMastheadDataDirectory,
  isMastheadOwnedDirectory,
  isPathInsideRoot,
  knownMastheadDataRoots,
  packagedDaemonPaths
} from "../pathPolicy";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Electron path policy", () => {
  test("accepts only Masthead-owned data directories", () => {
    const homeDir = "/home/test";
    expect(isMastheadOwnedDirectory(`${homeDir}/.local/share/masthead-dev`, { homeDir })).toBe(true);
    expect(isMastheadOwnedDirectory("/tmp/masthead-doctor-acceptance")).toBe(true);
    expect(isMastheadOwnedDirectory("/tmp/masthead-doctor-acceptance/nested")).toBe(true);
    expect(isMastheadOwnedDirectory(`${homeDir}/Documents`, { homeDir })).toBe(false);
    expect(isMastheadOwnedDirectory("/tmp/project")).toBe(false);
    expect(isMastheadOwnedDirectory("/tmp/not-masthead-at-all")).toBe(false);
    expect(isMastheadOwnedDirectory(`${homeDir}/Documents/masthead-secret`, { homeDir })).toBe(false);
  });

  test("known roots include env override and platform defaults", () => {
    const roots = knownMastheadDataRoots({
      env: {
        MASTHEAD_DATA_DIR: "/custom/masthead-data",
        XDG_DATA_HOME: "/xdg/data",
        XDG_CONFIG_HOME: "/xdg/config"
      },
      homeDir: "/home/test"
    });
    expect(roots).toEqual(expect.arrayContaining([
      "/custom/masthead-data",
      "/xdg/data/masthead-dev",
      "/xdg/config/masthead-production",
      "/xdg/config/masthead",
      "/xdg/config/Masthead"
    ]));
  });

  test("isPathInsideRoot rejects traversal", () => {
    expect(isPathInsideRoot("/tmp/masthead-dev", "/tmp/masthead-dev")).toBe(true);
    expect(isPathInsideRoot("/tmp/masthead-dev", "/tmp/masthead-dev/child")).toBe(true);
    expect(isPathInsideRoot("/tmp/masthead-dev", "/tmp/masthead-dev/../escape")).toBe(false);
    expect(isPathInsideRoot("/tmp/masthead-dev", "/tmp/other")).toBe(false);
  });

  test("assertSafeMastheadDataDirectory realpath-contains under known roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-path-policy-"));
    tempDirs.push(root);
    const dataDir = join(root, "data");
    await mkdir(dataDir);

    await expect(assertSafeMastheadDataDirectory(dataDir, {
      additionalRoots: [root],
      homeDir: "/no-home"
    })).resolves.toBe(await realpath(dataDir));
  });

  test("assertSafeMastheadDataDirectory rejects leaf symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-path-policy-"));
    tempDirs.push(root);
    const outside = await mkdtemp(join(tmpdir(), "outside-path-policy-"));
    tempDirs.push(outside);
    const linked = join(root, "escape");
    await symlink(outside, linked, "dir");

    await expect(assertSafeMastheadDataDirectory(linked, {
      additionalRoots: [root],
      homeDir: "/no-home"
    })).rejects.toThrow(/symlink/i);
  });

  test("assertSafeMastheadDataDirectory rejects parent-symlink escapes that leave trusted roots", async () => {
    const trusted = await mkdtemp(join(tmpdir(), "masthead-path-policy-"));
    tempDirs.push(trusted);
    const outside = await mkdtemp(join(tmpdir(), "outside-path-policy-"));
    tempDirs.push(outside);
    await writeFile(join(outside, "secret.txt"), "nope");

    // Create a path that looks owned by name under /tmp/masthead-* but whose
    // realpath parent chain can still be validated via realpath of the leaf.
    const ownedName = await mkdtemp(join("/tmp", "masthead-path-policy-owned-"));
    tempDirs.push(ownedName);
    const nested = join(ownedName, "nested");
    await mkdir(nested);
    // Replace nested with a symlink to outside after first creation path exists.
    await rm(nested, { recursive: true, force: true });
    await symlink(outside, nested, "dir");

    await expect(assertSafeMastheadDataDirectory(nested)).rejects.toThrow(/symlink|non-Masthead/i);
  });

  test("assertSafeMastheadDataDirectory rejects non-directories and missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-path-policy-"));
    tempDirs.push(root);
    const filePath = join(root, "file.txt");
    await writeFile(filePath, "x");

    await expect(assertSafeMastheadDataDirectory(filePath, {
      additionalRoots: [root],
      homeDir: "/no-home"
    })).rejects.toThrow(/not a directory/i);

    await expect(assertSafeMastheadDataDirectory(join(root, "missing"), {
      additionalRoots: [root],
      homeDir: "/no-home"
    })).rejects.toThrow(/does not exist/i);
  });

  test("resolves packaged daemon resource paths", () => {
    expect(packagedDaemonPaths("/opt/Masthead/resources")).toEqual({
      daemonRoot: "/opt/Masthead/resources/daemon",
      nodePath: "/opt/Masthead/resources/daemon/node",
      daemonEntry: "/opt/Masthead/resources/daemon/dist/src/daemon/main.js",
      hookScript: "/opt/Masthead/resources/daemon/scripts/masthead-hook.js",
      mcpEntry: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
      releaseJson: "/opt/Masthead/resources/daemon/release.json"
    });
  });
});
