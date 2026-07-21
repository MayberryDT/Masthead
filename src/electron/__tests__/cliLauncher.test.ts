import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  installMastheadCliLauncher,
  resolveMastheadCliLaunchTarget
} from "../cliLauncher";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead CLI launcher", () => {
  test("writes a packaged POSIX launcher using quoted bundled paths", async () => {
    const home = await makeTempDir();
    const target = resolveMastheadCliLaunchTarget({
      instanceDir: join(home, "masthead-production"),
      isPackaged: true,
      platform: "linux",
      resourcesPath: "/opt/Masthead Product/resources"
    });

    expect(target).toEqual({
      cliEntry: "/opt/Masthead Product/resources/daemon/dist/src/cli/mastheadctl.js",
      instanceManifest: join(home, "masthead-production", "masthead-instance.json"),
      launcherPath: join(home, "masthead-production", "bin", "mastheadctl"),
      nodePath: "/opt/Masthead Product/resources/daemon/node"
    });

    await installMastheadCliLauncher(target);
    const body = await readFile(target.launcherPath, "utf8");
    expect(body).toBe(
      `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST='${join(home, "masthead-production", "masthead-instance.json")}' '/opt/Masthead Product/resources/daemon/node' '/opt/Masthead Product/resources/daemon/dist/src/cli/mastheadctl.js' \"$@\"\n`
    );
  });

  test("writes a development launcher for the current checkout and atomically replaces it", async () => {
    const home = await makeTempDir();
    const target = resolveMastheadCliLaunchTarget({
      devNodePath: "/usr/local/Node Runtime/bin/node",
      devProjectDir: "/home/test/Masthead checkout",
      instanceDir: join(home, "masthead-dev"),
      isPackaged: false,
      platform: "linux",
      resourcesPath: "/ignored"
    });

    expect(target).toEqual({
      cliEntry: "/home/test/Masthead checkout/dist/daemon/src/cli/mastheadctl.js",
      instanceManifest: join(home, "masthead-dev", "masthead-instance.json"),
      launcherPath: join(home, "masthead-dev", "bin", "mastheadctl"),
      nodePath: "/usr/local/Node Runtime/bin/node"
    });

    await installMastheadCliLauncher(target);
    await installMastheadCliLauncher({
      ...target,
      cliEntry: "/home/test/Masthead checkout/dist/daemon/src/cli/replaced.js"
    });

    expect(await readFile(target.launcherPath, "utf8")).toContain("replaced.js");
    expect(await readdir(join(home, "masthead-dev", "bin"))).toEqual(["mastheadctl"]);
  });

  test("writes a Windows command launcher with quoted absolute bundled paths", async () => {
    const target = resolveMastheadCliLaunchTarget({
      instanceDir: "C:\\Users\\test\\masthead-production",
      isPackaged: true,
      platform: "win32",
      resourcesPath: "C:\\Program Files\\Masthead\\resources"
    });

    expect(target).toEqual({
      cliEntry: "C:\\Program Files\\Masthead\\resources\\daemon\\dist\\src\\cli\\mastheadctl.js",
      instanceManifest: "C:\\Users\\test\\masthead-production\\masthead-instance.json",
      launcherPath: "C:\\Users\\test\\masthead-production\\bin\\mastheadctl.cmd",
      nodePath: "C:\\Program Files\\Masthead\\resources\\daemon\\node.exe"
    });

    const home = await makeTempDir();
    const writableTarget = { ...target, launcherPath: join(home, "mastheadctl.cmd") };
    await installMastheadCliLauncher(writableTarget);
    expect(await readFile(writableTarget.launcherPath, "utf8")).toBe(
      "@echo off\r\n@setlocal DisableDelayedExpansion\r\n@set \"MASTHEAD_INSTANCE_MANIFEST=C:\\Users\\test\\masthead-production\\masthead-instance.json\"\r\n\"C:\\Program Files\\Masthead\\resources\\daemon\\node.exe\" \"C:\\Program Files\\Masthead\\resources\\daemon\\dist\\src\\cli\\mastheadctl.js\" %*\r\n"
    );
  });

  test("production and dev resolve different launcher paths", async () => {
    const home = await makeTempDir();
    const production = resolveMastheadCliLaunchTarget({
      instanceDir: join(home, "masthead-production"),
      isPackaged: true,
      platform: "linux",
      resourcesPath: "/opt/Masthead/resources"
    });
    const development = resolveMastheadCliLaunchTarget({
      devNodePath: "/usr/bin/node",
      devProjectDir: "/repo",
      instanceDir: join(home, "masthead-dev"),
      isPackaged: false,
      platform: "linux",
      resourcesPath: "/opt/Masthead/resources"
    });
    expect(production.launcherPath).toBe(join(home, "masthead-production", "bin", "mastheadctl"));
    expect(development.launcherPath).toBe(join(home, "masthead-dev", "bin", "mastheadctl"));
  });
});

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "masthead-cli-home-"));
  tempDirs.push(path);
  return path;
}
