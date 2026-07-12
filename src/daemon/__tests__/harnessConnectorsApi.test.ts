import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import { setConnectorActivation } from "../sources/connectorActivationStore.ts";

const EXPECTED_RUNTIMES = [
  "codex",
  "claude_code",
  "cursor",
  "grok",
  "opencode",
  "omp",
  "pi",
  "hermes"
] as const;

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("harness connectors API", () => {
  test("GET /sources/connectors returns eight live targets", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const body = await getJson(baseUrl, "/sources/connectors");
    expect(body.ok).toBe(true);
    expect(body.connectors).toHaveLength(8);
    expect(body.connectors.map((connector: { runtime: string }) => connector.runtime)).toEqual([
      ...EXPECTED_RUNTIMES
    ]);
    expect(body.summary).toMatchObject({
      ready: expect.any(Number),
      needsAction: expect.any(Number),
      notInstalled: expect.any(Number),
      notFound: expect.any(Number),
      error: expect.any(Number)
    });
    expect(body.generatedAt).toEqual(expect.any(String));
  });

  test("POST /sources/connectors/discover returns the same snapshot shape", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const body = await postJson(baseUrl, "/sources/connectors/discover");
    expect(body.ok).toBe(true);
    expect(body.connectors).toHaveLength(8);
    expect(body.connectors.every((connector: { historyFound?: boolean }) => connector.historyFound === false)).toBe(true);
  });

  test("POST /sources/connectors/discover-history is the explicit count-bearing onboarding scan", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const body = await postJson(baseUrl, "/sources/connectors/discover-history");
    expect(body.ok).toBe(true);
    expect(body.connectors).toHaveLength(8);
    expect(body.connectors.every((connector: { historySessionCount?: number }) => typeof connector.historySessionCount === "number")).toBe(true);
  });

  test("enable codex marks needs_action (trust_hooks) after install", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const body = await postJson(baseUrl, "/sources/connectors/codex/enable");
    expect(body.ok).toBe(true);

    const codex = body.connectors.find((connector: { runtime: string }) => connector.runtime === "codex");
    expect(codex).toMatchObject({
      runtime: "codex",
      live: "needs_action",
      actionRequired: "trust_hooks"
    });
  });

  test("Codex remains needs_action until a real live event is observed", async () => {
    const { daemon, databasePath } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/sources/connectors/codex/enable");
    await setConnectorActivation(dirname(databasePath), "codex", {
      required: "trust_hooks",
      message: "Trust hooks in Codex."
    });

    const before = await getJson(baseUrl, "/sources/connectors");
    const beforeCodex = before.connectors.find((connector: { runtime: string }) => connector.runtime === "codex");
    expect(beforeCodex).toMatchObject({
      live: "needs_action",
      actionRequired: "trust_hooks"
    });

    const after = await postJson(baseUrl, "/sources/connectors/codex/confirm-activation");
    const afterCodex = after.connectors.find((connector: { runtime: string }) => connector.runtime === "codex");
    expect(afterCodex).toMatchObject({
      runtime: "codex",
      live: "needs_action",
      actionRequired: "trust_hooks"
    });
  });

  test("rejects unknown runtime actions", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    const response = await fetch(`${baseUrl}/sources/connectors/not_a_runtime/enable`, {
      headers: { accept: "application/json" },
      method: "POST"
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body).toMatchObject({
      ok: false,
      error: "live connector runtime not found"
    });
  });
});

async function createTestHarness(
  overrides: Partial<DaemonConfig> = {}
): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-harness-connectors-api-"));
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
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath,
    ...overrides
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

async function postJson(baseUrl: string, path: string, body?: unknown, expectedStatus = 202): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(expectedStatus);
  return response.json() as Promise<Record<string, any>>;
}
