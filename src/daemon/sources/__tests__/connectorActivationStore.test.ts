import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConnectorActivation,
  getConnectorActivation,
  listConnectorActivations,
  setConnectorActivation
} from "../connectorActivationStore.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-activation-"));
  tempDirs.push(dir);
  return dir;
}

describe("connectorActivationStore", () => {
  test("set/get/clear works in a temp data directory", async () => {
    const dataDirectory = await createTempDir();

    expect(await getConnectorActivation(dataDirectory, "codex")).toBeUndefined();
    expect(await listConnectorActivations(dataDirectory)).toEqual({});

    await setConnectorActivation(dataDirectory, "codex", {
      required: "trust_hooks",
      message: "Open Codex and run /hooks to review and trust Masthead hooks."
    });

    const stored = await getConnectorActivation(dataDirectory, "codex");
    expect(stored).toMatchObject({
      required: "trust_hooks",
      message: "Open Codex and run /hooks to review and trust Masthead hooks."
    });
    expect(stored?.setAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const onDisk = JSON.parse(await readFile(join(dataDirectory, "connector-activation.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(onDisk).toHaveProperty("codex");

    const listed = await listConnectorActivations(dataDirectory);
    expect(listed.codex).toEqual(stored);

    await clearConnectorActivation(dataDirectory, "codex");
    expect(await getConnectorActivation(dataDirectory, "codex")).toBeUndefined();
    expect(await listConnectorActivations(dataDirectory)).toEqual({});
  });

  test("missing file reads as empty and corrupt file fails open", async () => {
    const dataDirectory = await createTempDir();

    expect(await getConnectorActivation(dataDirectory, "codex")).toBeUndefined();
    expect(await listConnectorActivations(dataDirectory)).toEqual({});

    await writeFile(join(dataDirectory, "connector-activation.json"), "{ not valid json", "utf8");
    expect(await getConnectorActivation(dataDirectory, "codex")).toBeUndefined();
    expect(await listConnectorActivations(dataDirectory)).toEqual({});
  });

  test("clearing a missing runtime is a no-op", async () => {
    const dataDirectory = await createTempDir();
    await expect(clearConnectorActivation(dataDirectory, "codex")).resolves.toBeUndefined();
  });
});
