import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertLiveDevInstanceManifest, prepareLiveDevInstanceLauncher } from "../liveDevLauncher";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true }))));

describe("non-Electron live development launcher", () => {
  test("installs an instance launcher before spawn and verifies daemon identity", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "masthead-live-dev-launcher-"));
    cleanup.push(dataDirectory);
    const events: string[] = [];
    const paths = await prepareLiveDevInstanceLauncher({
      cliEntry: "/repo/dist/daemon/src/cli/mastheadctl.js",
      dataDirectory,
      nodePath: "/usr/bin/node"
    });
    events.push("install-launcher");
    expect(await readFile(paths.launcherPath, "utf8")).toContain(`MASTHEAD_INSTANCE_MANIFEST='${paths.instanceManifest}'`);
    expect(await readFile(paths.launcherPath, "utf8")).not.toContain("MASTHEAD_DAEMON_URL");
    events.push("spawn-daemon");
    await writeFile(paths.instanceManifest, JSON.stringify({
      schemaVersion: 1,
      instanceId: "instance:test",
      baseUrl: "http://127.0.0.1:17373",
      databaseId: "database:test",
      buildSha: "development",
      pid: 12345,
      instanceDir: dataDirectory,
      updatedAt: new Date().toISOString()
    }));
    await assertLiveDevInstanceManifest(paths.instanceManifest, {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "development",
      databaseId: "database:test",
      instanceId: "instance:test",
      instanceManifest: paths.instanceManifest,
      pid: 12345
    });
    events.push("compatible-health", "start-ui");
    expect(events).toEqual(["install-launcher", "spawn-daemon", "compatible-health", "start-ui"]);
  });
});
