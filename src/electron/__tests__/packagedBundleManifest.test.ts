import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  resolvePackagedBundleLayout,
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

  test("writes a deterministic, self-excluding digest over every required packaged payload", async () => {
    const fixture = await packagedFixture();

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
      "resources/daemon/dist/src/cli/mastheadctl.js",
      "resources/daemon/dist/src/daemon/main.js",
      "resources/daemon/node",
      "resources/daemon/release.json",
      "resources/daemon/scripts/masthead-hook.js",
      "resources/daemon/scripts/masthead-production.js",
      "resources/daemon/scripts/packaged-bundle-manifest.js",
      "resources/daemon/scripts/resolve-hook-runtime.js"
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

  test("rejects a changed required file and an unlisted daemon dist file", async () => {
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
