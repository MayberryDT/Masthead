import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DaemonOwnershipMetadata = {
  daemonInstanceId: string;
  pid: number;
  baseUrl: string;
  apiVersion: number;
  buildSha?: string;
  dataDirectory: string;
  startedAt: string;
};

export async function writeDaemonOwnershipMetadata(
  dataDirectory: string,
  metadata: DaemonOwnershipMetadata
): Promise<string> {
  const runtimeDirectory = join(dataDirectory, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const metadataPath = join(runtimeDirectory, "daemon.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  return metadataPath;
}

export async function removeDaemonOwnershipMetadata(metadataPath: string | undefined): Promise<void> {
  if (!metadataPath) return;
  await rm(metadataPath, { force: true });
}
