import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  resolvePackagedBundleLayout,
  resolvePackagedExecutableLayout,
  verifyPackagedBundleManifest,
  writePackagedBundleManifest
} from "../../../scripts/packaged-bundle-manifest.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function packagedFixture() {
  const bundleRoot = await mkdtemp(join(tmpdir(), "masthead-packaged-manifest-"));
  cleanup.push(bundleRoot);
  const resourcesPath = join(bundleRoot, "resources");
  const daemonPath = join(resourcesPath, "daemon");
  await mkdir(join(daemonPath, "dist", "src", "daemon"), { recursive: true });
  await mkdir(join(daemonPath, "dist", "src", "cli"), { recursive: true });
  await mkdir(join(daemonPath, "scripts"), { recursive: true });
  await writeFile(join(bundleRoot, "masthead"), "electron executable");
  await writeFile(join(resourcesPath, "app.asar"), "renderer archive");
  await writeFile(join(daemonPath, "node"), "node runtime");
  await writeFile(join(daemonPath, "dist", "src", "daemon", "main.js"), "daemon main");
  await writeFile(join(daemonPath, "dist", "src", "cli", "mastheadctl.js"), "cli main");
  await writeFile(join(daemonPath, "scripts", "packaged-bundle-manifest.js"), "manifest verifier");
  await writeFile(join(daemonPath, "scripts", "masthead-production.js"), "lifecycle");
  await writeFile(join(daemonPath, "scripts", "masthead-private-display.js"), "private display");
  await writeFile(join(daemonPath, "scripts", "masthead-production-cold-activation.js"), "cold activation");
  await writeFile(join(daemonPath, "scripts", "masthead-hook.js"), "evidence hook");
  await writeFile(join(daemonPath, "scripts", "resolve-hook-runtime.js"), "hook resolver");
  await writeFile(join(daemonPath, "release.json"), `${JSON.stringify({
    gitSha: "a".repeat(40),
    version: "0.1.0"
  }, null, 2)}\n`);
  return { bundleRoot, daemonPath, resourcesPath };
}

describe("packaged bundle manifest", () => {
  test("resolves the target platform's executable and bundled Node names", async () => {
    const bundleRoot = await mkdtemp(join(tmpdir(), "masthead-packaged-layout-"));
    cleanup.push(bundleRoot);

    await expect(resolvePackagedBundleLayout(bundleRoot, "win32")).resolves.toEqual({
      bundleRoot,
      executablePath: join(bundleRoot, "masthead.exe"),
      nodePath: join(bundleRoot, "resources", "daemon", "node.exe"),
      resourcesPath: join(bundleRoot, "resources")
    });
  });

  test("resolves layout from a linux packaged executable path", async () => {
    const bundleRoot = await mkdtemp(join(tmpdir(), "masthead-packaged-exec-linux-"));
    cleanup.push(bundleRoot);
    const executablePath = join(bundleRoot, "masthead");

    await expect(resolvePackagedExecutableLayout(executablePath, "linux")).resolves.toEqual({
      bundleRoot,
      executablePath,
      nodePath: join(bundleRoot, "resources", "daemon", "node"),
      resourcesPath: join(bundleRoot, "resources")
    });
  });

  test("resolves layout from a darwin .app or MacOS executable path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "masthead-packaged-exec-darwin-"));
    cleanup.push(parent);
    const bundleRoot = join(parent, "Masthead.app");
    const executablePath = join(bundleRoot, "Contents", "MacOS", "masthead");

    await expect(resolvePackagedExecutableLayout(executablePath, "darwin")).resolves.toEqual({
      bundleRoot,
      executablePath,
      nodePath: join(bundleRoot, "Contents", "Resources", "daemon", "node"),
      resourcesPath: join(bundleRoot, "Contents", "Resources")
    });
    await expect(resolvePackagedExecutableLayout(bundleRoot, "darwin")).resolves.toEqual({
      bundleRoot,
      executablePath,
      nodePath: join(bundleRoot, "Contents", "Resources", "daemon", "node"),
      resourcesPath: join(bundleRoot, "Contents", "Resources")
    });
  });

  test("writes a deterministic, self-excluding digest over the complete packaged tree", async () => {
    const fixture = await packagedFixture();
    await mkdir(join(fixture.daemonPath, "dist", "libs"), { recursive: true });
    await writeFile(join(fixture.daemonPath, "dist", "libs", "runtime-helper.js"), "helper");
    await writeFile(join(fixture.resourcesPath, "extra-asset.txt"), "asset");

    const first = await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });
    const firstBytes = await readFile(first.manifestPath, "utf8");
    const second = await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });
    const secondBytes = await readFile(second.manifestPath, "utf8");

    expect(secondBytes).toBe(firstBytes);
    expect(first.bundleDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.release).toEqual({ gitSha: "a".repeat(40), version: "0.1.0" });
    expect(first.files.map((entry: { path: string }) => entry.path)).toEqual([
      "masthead",
      "resources/app.asar",
      "resources/daemon/dist/libs/runtime-helper.js",
      "resources/daemon/dist/src/cli/mastheadctl.js",
      "resources/daemon/dist/src/daemon/main.js",
      "resources/daemon/node",
      "resources/daemon/release.json",
      "resources/daemon/scripts/masthead-hook.js",
      "resources/daemon/scripts/masthead-private-display.js",
      "resources/daemon/scripts/masthead-production-cold-activation.js",
      "resources/daemon/scripts/masthead-production.js",
      "resources/daemon/scripts/packaged-bundle-manifest.js",
      "resources/daemon/scripts/resolve-hook-runtime.js",
      "resources/extra-asset.txt"
    ]);
    expect(first.files.map((entry: { path: string }) => entry.path)).not.toContain(
      "resources/release-manifest.json"
    );
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).resolves.toEqual(first);
  });

  test("includes every present regular file, including optional helpers when present", async () => {
    const fixture = await packagedFixture();
    await rm(join(fixture.daemonPath, "scripts", "masthead-private-display.js"));

    const withoutOptional = await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });
    expect(withoutOptional.files.map((entry: { path: string }) => entry.path)).not.toContain(
      "resources/daemon/scripts/masthead-private-display.js"
    );
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).resolves.toEqual(withoutOptional);

    await writeFile(join(fixture.daemonPath, "scripts", "masthead-private-display.js"), "private display");
    const withOptional = await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });
    expect(withOptional.files.map((entry: { path: string }) => entry.path)).toContain(
      "resources/daemon/scripts/masthead-private-display.js"
    );
  });

  test.each(["masthead-hook.js", "resolve-hook-runtime.js"])("rejects tampered executable hook helper %s", async (script) => {
    const fixture = await packagedFixture();
    await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });
    await writeFile(join(fixture.daemonPath, "scripts", script), "tampered");
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("does not match its content manifest");
  });

  test("rejects a changed required file and an unexpected tree file after sealing", async () => {
    const fixture = await packagedFixture();
    await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });

    await writeFile(join(fixture.bundleRoot, "masthead"), "tampered executable");
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("does not match its content manifest");

    await writeFile(join(fixture.bundleRoot, "masthead"), "electron executable");
    await writeFile(join(fixture.daemonPath, "dist", "unexpected.js"), "unlisted");
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("does not match its content manifest");

    await writeFile(join(fixture.resourcesPath, "unexpected-root-asset.bin"), "surprise");
    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("does not match its content manifest");
  });

  test("rejects symbolic links in the packaged tree", async () => {
    const fixture = await packagedFixture();
    await symlink("/tmp", join(fixture.daemonPath, "dist", "escape-dir"));
    await expect(writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("symbolic link");

    await rm(join(fixture.daemonPath, "dist", "escape-dir"), { force: true });
    await symlink("/etc/passwd", join(fixture.daemonPath, "scripts", "escape-file.js"));
    await expect(writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("symbolic link");
  });

  test("rejects release metadata that no longer matches the manifest identity", async () => {
    const fixture = await packagedFixture();
    await writePackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    });

    await writeFile(join(fixture.daemonPath, "release.json"), `${JSON.stringify({
      gitSha: "b".repeat(40),
      version: "0.1.0"
    }, null, 2)}\n`);

    await expect(verifyPackagedBundleManifest({
      bundleRoot: fixture.bundleRoot,
      executablePath: join(fixture.bundleRoot, "masthead"),
      resourcesPath: fixture.resourcesPath
    })).rejects.toThrow("release identity");
  });
});
