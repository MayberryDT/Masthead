import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { MASTHEAD_API_VERSION, MASTHEAD_PRODUCT, REQUIRED_CLIENT_CAPABILITIES } from "../../shared/protocol.ts";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead health API", () => {
  test("returns protocol, runtime, data, and live identities", async () => {
    const { daemon, databasePath, storePath, tempDir } = await createTestDaemon();
    const baseUrl = await listen(daemon);

    const health = await getJson(baseUrl, "/health");

    expect(health).toMatchObject({
      ok: true,
      product: MASTHEAD_PRODUCT,
      apiVersion: MASTHEAD_API_VERSION,
      schemaVersion: expect.any(Number),
      buildVersion: expect.any(String),
      capabilities: expect.arrayContaining(REQUIRED_CLIENT_CAPABILITIES),
      runtime: {
        daemonInstanceId: expect.any(String),
        mode: "primary",
        writable: true,
        host: "127.0.0.1",
        port: expect.any(Number)
      },
      data: {
        dataDirectory: tempDir,
        databasePath,
        databaseId: expect.any(String),
        migrationState: "ready",
        sessions: 0,
        sources: 0
      },
      live: {
        events: 0,
        diagnostics: 0,
        gitSnapshots: 0
      },
      storePath
    });
  });

  test("keeps database identity stable across daemon restarts", async () => {
    const harness = await createTestDaemon();
    const firstBaseUrl = await listen(harness.daemon);
    const firstHealth = await getJson(firstBaseUrl, "/health");
    await closeDaemon(harness.daemon);

    const restarted = await createDaemon(harness.config);
    const secondBaseUrl = await listen(restarted);
    const secondHealth = await getJson(secondBaseUrl, "/health");

    expect(secondHealth.data.databaseId).toBe(firstHealth.data.databaseId);
    expect(secondHealth.runtime.daemonInstanceId).not.toBe(firstHealth.runtime.daemonInstanceId);
  });
});

async function createTestDaemon(): Promise<{
  config: DaemonConfig;
  daemon: MastheadDaemon;
  databasePath: string;
  storePath: string;
  tempDir: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-health-api-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const config = {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig;
  return { config, daemon: await createDaemon(config), databasePath, storePath, tempDir };
}

async function createDaemon(config: DaemonConfig): Promise<MastheadDaemon> {
  const daemon = await createMastheadDaemon(config);
  daemons.push(daemon);
  return daemon;
}

async function closeDaemon(daemon: MastheadDaemon): Promise<void> {
  await daemon.close();
  const index = daemons.indexOf(daemon);
  if (index >= 0) daemons.splice(index, 1);
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}
