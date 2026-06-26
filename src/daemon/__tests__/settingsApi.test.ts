import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("settings API", () => {
  test("reports effective settings and enumerable deletion targets", async () => {
    const { daemon, databasePath, storePath } = await createTestHarness();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:settings", title: "Settings API" });
    const baseUrl = await listen(daemon);

    const state = await getJson(baseUrl, "/settings");
    const settings = state.settings as Record<string, any>;

    expect(state).toMatchObject({
      ok: true,
      settings: {
        enrichment: {
          provider: "Deterministic fallback",
          remoteModelEnabled: false
        },
        privacy: {
          mcpAccessEnabled: true,
          redactionEnabled: true
        },
        schemaVersion: expect.any(Number),
        runtime: {
          mode: "primary",
          writable: true
        },
        storage: {
          databasePath,
          dataDirectory: dirname(databasePath),
          storePath
        }
      }
    });
    expect(settings.data).toMatchObject({
      databasePath,
      dataDirectory: dirname(databasePath),
      migrationState: "ready",
      storePath
    });
    const health = await getJson(baseUrl, "/health");
    expect(settings.data.databaseId).toBe(health.data.databaseId);
    expect(state.settings.deletionTargets.projects).toEqual([{ label: "Masthead", value: "Masthead" }]);
    expect(state.settings.deletionTargets.runtimes).toEqual([{ label: "codex", value: "codex" }]);
    expect(state.settings.deletionTargets.hosts).toEqual([{ label: "masthead-test-host", value: "masthead-test-host" }]);
  });

  test("rejects stale database identity on destructive previews and confirms", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const settings = await getJson(baseUrl, "/settings");
    const currentDatabaseId = settings.settings.data.databaseId;

    const currentPreview = await fetch(`${baseUrl}/data/summary?databaseId=${encodeURIComponent(currentDatabaseId)}`, { headers: { accept: "application/json" } });
    expect(currentPreview.status).toBe(200);

    const preview = await fetch(`${baseUrl}/data/summary?databaseId=sqlite:stale`, { headers: { accept: "application/json" } });
    expect(preview.status).toBe(400);
    expect(await preview.text()).toContain("Masthead database changed");

    const confirm = await fetch(`${baseUrl}/data/delete`, {
      body: JSON.stringify({ databaseId: "sqlite:stale", scope: { kind: "all" } }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(confirm.status).toBe(400);
    expect(await confirm.text()).toContain("Masthead database changed");
  });

  test("installs, tests, and uninstalls the real Codex hooks file", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const baseUrl = await listen(daemon);
    const hooksPath = join(tempDir, ".codex", "hooks.json");

    const before = await getJson(baseUrl, "/settings/hooks/codex");
    expect(before.hooks).toMatchObject({
      configExists: false,
      configPath: hooksPath,
      installed: false
    });

    const installed = await postJson(baseUrl, "/settings/hooks/codex/install");
    expect(installed.hooks).toMatchObject({
      configExists: true,
      installed: true
    });
    expect(await readFile(hooksPath, "utf8")).toContain("masthead-hook.js");

    const tested = await postJson(baseUrl, "/settings/hooks/codex/test");
    expect(tested.hooks.lastTest).toMatchObject({
      message: "Hook round-trip passed: Masthead accepted a synthetic Codex lifecycle event.",
      status: "passed"
    });

    const uninstalled = await postJson(baseUrl, "/settings/hooks/codex/uninstall");
    expect(uninstalled.hooks).toMatchObject({
      installed: false
    });
    expect(uninstalled.hooks.latestBackupPath).toContain("masthead-backup");
  });
});

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-settings-api-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
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

async function postJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" }, method: "POST" });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, any>>;
}
