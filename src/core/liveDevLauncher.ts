import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
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
}): Promise<{ instanceDir: string; instanceManifest: string; launcherPath: string }> {
  if (!isAbsolute(input.nodePath) || !isAbsolute(input.cliEntry)) throw new Error("Live dev CLI runtime paths must be absolute");
  const paths = canonicalInstancePaths(input.dataDirectory);
  const body = `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST=${quote(paths.instanceManifest)} ${quote(input.nodePath)} ${quote(input.cliEntry)} "$@"\n`;
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
