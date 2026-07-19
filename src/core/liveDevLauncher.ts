import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";
import {
  assertGuidedAuthoringExpectedIdentity,
  canonicalInstancePaths,
  identityFromManifest,
  parseMastheadInstanceManifest,
  type GuidedAuthoringExpectedIdentity
} from "../shared/instanceIdentity.ts";

export async function prepareLiveDevInstanceLauncher(input: {
  cliEntry: string;
  dataDirectory: string;
  nodePath: string;
  platform?: NodeJS.Platform;
}): Promise<{ instanceDir: string; instanceManifest: string; launcherPath: string }> {
  const platform = input.platform ?? process.platform;
  const pathIsAbsolute = platform === "win32" ? win32.isAbsolute : isAbsolute;
  if (!pathIsAbsolute(input.nodePath) || !pathIsAbsolute(input.cliEntry)) throw new Error("Live dev CLI runtime paths must be absolute");
  const paths = canonicalInstancePaths(input.dataDirectory, platform);
  const body = renderLiveDevInstanceLauncher({ ...input, instanceManifest: paths.instanceManifest, platform });
  await mkdir(dirname(paths.launcherPath), { recursive: true });
  const temporary = join(dirname(paths.launcherPath), `.${basename(paths.launcherPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o755 });
    await chmod(temporary, 0o755);
    await rename(temporary, paths.launcherPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return paths;
}

export function renderLiveDevInstanceLauncher(input: {
  cliEntry: string;
  instanceManifest: string;
  nodePath: string;
  platform: NodeJS.Platform;
}): string {
  if (input.platform === "win32") {
    return `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@set "MASTHEAD_INSTANCE_MANIFEST=${batch(input.instanceManifest)}"\r\n"${batch(input.nodePath)}" "${batch(input.cliEntry)}" %*\r\n`;
  }
  return `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST=${quote(input.instanceManifest)} ${quote(input.nodePath)} ${quote(input.cliEntry)} "$@"\n`;
}

export async function assertLiveDevInstanceManifest(
  path: string,
  expected: GuidedAuthoringExpectedIdentity & { pid: number }
): Promise<void> {
  const manifest = parseMastheadInstanceManifest(JSON.parse(await readFile(path, "utf8")), path);
  assertGuidedAuthoringExpectedIdentity(identityFromManifest(manifest, path), expected);
  if (manifest.pid !== expected.pid) throw new Error("instance_manifest_pid_mismatch");
}

function quote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function batch(value: string): string {
  return value.replace(/%/gu, "%%");
}
