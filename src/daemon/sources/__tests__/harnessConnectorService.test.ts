import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { LIVE_CONNECTOR_RUNTIMES } from "../../../adapters/liveRuntimes.ts";
import type { DaemonConfig } from "../../config.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { installLiveConnector } from "../../liveConnectorSettings.ts";
import {
  clearConnectorActivation,
  getConnectorActivation,
  setConnectorActivation
} from "../connectorActivationStore.ts";
import {
  discoverHarnessConnectors,
  latestLiveEventAtByRuntime,
  listHarnessConnectors
} from "../harnessConnectorService.ts";

const tempDirs: string[] = [];
const envKeys = ["MASTHEAD_CODEX_HOOKS"] as const;
const originalEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;

  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
    delete originalEnv[key];
  }
});

describe("harnessConnectorService", () => {
  test("list returns all LIVE_CONNECTOR_RUNTIMES with summary counts", async () => {
    const { db, config } = await openTestFixture();

    const snapshot = await listHarnessConnectors(db, config);

    expect(snapshot.connectors.map((connector) => connector.runtime)).toEqual([...LIVE_CONNECTOR_RUNTIMES]);
    expect(snapshot.connectors).toHaveLength(8);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.summary).toMatchObject({
      ready: expect.any(Number),
      needsAction: expect.any(Number),
      notInstalled: expect.any(Number),
      notFound: expect.any(Number),
      error: expect.any(Number)
    });
    expect(
      snapshot.summary.ready +
        snapshot.summary.needsAction +
        snapshot.summary.notInstalled +
        snapshot.summary.error
    ).toBe(snapshot.connectors.length);

    for (const connector of snapshot.connectors) {
      expect(connector.supportsActions).toBe(true);
      expect(connector.label.length).toBeGreaterThan(0);
      expect(["not_found", "found"]).toContain(connector.presence);
      expect(["not_installed", "needs_action", "ready", "error"]).toContain(connector.live);
    }

    db.close();
  });

  test("codex with trust_hooks activation is needs_action", async () => {
    const { db, config, tempDir } = await openTestFixture();
    pinCodexHooks(tempDir);

    await installLiveConnector(config, "codex");

    const activation = await getConnectorActivation(dirname(config.databasePath), "codex");
    expect(activation?.required).toBe("trust_hooks");

    const snapshot = await listHarnessConnectors(db, config);
    const codex = snapshot.connectors.find((connector) => connector.runtime === "codex");
    expect(codex).toMatchObject({
      runtime: "codex",
      presence: "found",
      live: "needs_action",
      actionRequired: "trust_hooks"
    });
    expect(codex?.actionMessage).toMatch(/hooks/i);

    db.close();
  });

  test("codex installed with cleared activation is ready", async () => {
    const { db, config, tempDir } = await openTestFixture();
    pinCodexHooks(tempDir);

    await installLiveConnector(config, "codex");
    await clearConnectorActivation(dirname(config.databasePath), "codex");

    const snapshot = await listHarnessConnectors(db, config);
    const codex = snapshot.connectors.find((connector) => connector.runtime === "codex");
    expect(codex).toMatchObject({
      runtime: "codex",
      live: "ready"
    });
    expect(codex?.actionRequired).toBeUndefined();

    db.close();
  });

  test("manual trust_hooks activation without install is not_installed (activation not applied)", async () => {
    const { db, config } = await openTestFixture();

    await setConnectorActivation(dirname(config.databasePath), "codex", {
      required: "trust_hooks",
      message: "Open Codex and run /hooks"
    });

    const snapshot = await listHarnessConnectors(db, config);
    const codex = snapshot.connectors.find((connector) => connector.runtime === "codex");
    // deriveLiveStatus checks !installed before activation.
    expect(codex?.live).toBe("not_installed");

    db.close();
  });

  test("auto-clears activation when lastLiveEventAt is after setAt", async () => {
    const { db, config, tempDir } = await openTestFixture();
    pinCodexHooks(tempDir);

    await installLiveConnector(config, "codex");
    const dataDirectory = dirname(config.databasePath);
    const activation = await getConnectorActivation(dataDirectory, "codex");
    expect(activation).toBeDefined();

    // Seed a live state report observed after activation.setAt.
    const observedAt = new Date(Date.parse(activation!.setAt) + 60_000).toISOString();
    seedLiveStateReport(db, "codex", observedAt);

    const snapshot = await listHarnessConnectors(db, config);
    const codex = snapshot.connectors.find((connector) => connector.runtime === "codex");
    expect(codex).toMatchObject({
      live: "ready",
      lastLiveEventAt: observedAt
    });
    expect(await getConnectorActivation(dataDirectory, "codex")).toBeUndefined();

    db.close();
  });

  test("discoverHarnessConnectors matches listHarnessConnectors", async () => {
    const { db, config } = await openTestFixture();

    const listed = await listHarnessConnectors(db, config);
    const discovered = await discoverHarnessConnectors(db, config);

    expect(discovered.connectors.map((c) => c.runtime)).toEqual(listed.connectors.map((c) => c.runtime));
    expect(discovered.summary).toEqual(listed.summary);

    db.close();
  });

  test("latestLiveEventAtByRuntime returns max observed_at per runtime", async () => {
    const { db } = await openTestFixture();

    seedLiveStateReport(db, "codex", "2026-07-01T10:00:00.000Z");
    seedLiveStateReport(db, "codex", "2026-07-08T12:00:00.000Z", "report-2");
    seedLiveStateReport(db, "hermes", "2026-07-05T08:00:00.000Z");

    const latest = latestLiveEventAtByRuntime(db);
    expect(latest.get("codex")).toBe("2026-07-08T12:00:00.000Z");
    expect(latest.get("hermes")).toBe("2026-07-05T08:00:00.000Z");
    expect(latest.get("cursor")).toBeUndefined();

    db.close();
  });

  test("codex presence found when ~/.codex exists without history", async () => {
    const { db, config, tempDir } = await openTestFixture();
    await mkdir(join(tempDir, ".codex"), { recursive: true });

    const snapshot = await listHarnessConnectors(db, config);
    const codex = snapshot.connectors.find((connector) => connector.runtime === "codex");
    expect(codex?.presence).toBe("found");
    expect(codex?.live).toBe("not_installed");

    db.close();
  });
});

async function openTestFixture(): Promise<{ db: MastheadDatabase; config: DaemonConfig; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-harness-connector-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "data", "masthead.sqlite");
  await mkdir(dirname(databasePath), { recursive: true });
  const db = await openMastheadDatabase(databasePath);
  migrateDatabase(db);
  return {
    db,
    config: configFor(tempDir, databasePath),
    tempDir
  };
}

function configFor(homeDir: string, databasePath: string): DaemonConfig {
  return {
    allowedOrigins: [],
    codexHomeDir: homeDir,
    databasePath,
    fixturePath: "fixtures/v0/replay-three-sessions-board.json",
    gitRefreshMs: 60_000,
    hookTranscriptCatchupEnabled: true,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 17373,
    storePath: join(homeDir, "events.ndjson")
  };
}

function pinCodexHooks(tempDir: string): void {
  originalEnv.MASTHEAD_CODEX_HOOKS = process.env.MASTHEAD_CODEX_HOOKS;
  process.env.MASTHEAD_CODEX_HOOKS = join(tempDir, ".codex", "hooks.json");
}

function seedLiveStateReport(
  db: MastheadDatabase,
  runtime: string,
  observedAt: string,
  reportId = `report-${runtime}-${observedAt}`
): void {
  db.prepare(
    `INSERT INTO live_state_reports (
      report_id, runtime, source, source_session_id, state, authority,
      observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reportId,
    runtime,
    `test:${runtime}`,
    `session-${runtime}`,
    "working",
    "hook",
    observedAt,
    observedAt
  );
}
