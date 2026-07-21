import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";

export type MastheadCliLaunchTarget = {
  launcherPath: string;
  instanceManifest: string;
  nodePath: string;
  cliEntry: string;
};

export function resolveMastheadCliLaunchTarget(input: {
  instanceDir: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  devNodePath?: string;
  devProjectDir?: string;
}): MastheadCliLaunchTarget {
  const windows = input.platform === "win32";
  const pathJoin = windows ? win32.join : join;
  const instanceDir = requiredAbsolutePath(input.instanceDir, "instance directory", windows);
  const launcherPath = pathJoin(instanceDir, "bin", windows ? "mastheadctl.cmd" : "mastheadctl");
  const instanceManifest = pathJoin(instanceDir, "masthead-instance.json");
  const nodePath = input.isPackaged
    ? pathJoin(input.resourcesPath, "daemon", windows ? "node.exe" : "node")
    : requiredAbsolutePath(input.devNodePath, "development Node path", windows);
  const cliEntry = input.isPackaged
    ? pathJoin(input.resourcesPath, "daemon", "dist", "src", "cli", "mastheadctl.js")
    : pathJoin(requiredAbsolutePath(input.devProjectDir, "development project directory", windows), "dist", "daemon", "src", "cli", "mastheadctl.js");

  requiredAbsolutePath(input.resourcesPath, "resources path", windows);
  requiredAbsolutePath(nodePath, "Node path", windows);
  requiredAbsolutePath(cliEntry, "CLI entry", windows);
  return { cliEntry, instanceManifest, launcherPath, nodePath };
}

export async function installMastheadCliLauncher(
  target: MastheadCliLaunchTarget
): Promise<void> {
  const windows = target.launcherPath.toLowerCase().endsWith(".cmd");
  requiredAbsolutePath(target.launcherPath, "launcher path", windows);
  requiredAbsolutePath(target.nodePath, "Node path", windows);
  requiredAbsolutePath(target.cliEntry, "CLI entry", windows);
  requiredAbsolutePath(target.instanceManifest, "instance manifest", windows);

  const directory = dirname(target.launcherPath);
  const temporaryPath = join(directory, `.${basename(target.launcherPath)}.${process.pid}.${randomUUID()}.tmp`);
  const body = windows ? windowsLauncher(target) : posixLauncher(target);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, body, { encoding: "utf8", mode: windows ? undefined : 0o755 });
    if (!windows) await chmod(temporaryPath, 0o755);
    await rename(temporaryPath, target.launcherPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function posixLauncher(target: MastheadCliLaunchTarget): string {
  return `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST=${shellQuote(target.instanceManifest)} ${shellQuote(target.nodePath)} ${shellQuote(target.cliEntry)} "$@"\n`;
}

function windowsLauncher(target: MastheadCliLaunchTarget): string {
  return `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@set "MASTHEAD_INSTANCE_MANIFEST=${batchPath(target.instanceManifest)}"\r\n"${batchPath(target.nodePath)}" "${batchPath(target.cliEntry)}" %*\r\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function batchPath(value: string): string {
  return value.replace(/%/g, "%%");
}

function requiredAbsolutePath(value: string | undefined, label: string, windows: boolean): string {
  const path = value?.trim();
  if (!path || !(windows ? win32.isAbsolute(path) : isAbsolute(path))) {
    throw new Error(`Masthead ${label} must be absolute`);
  }
  return path;
}
