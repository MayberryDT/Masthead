import { EventEmitter } from "node:events";
import { access, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  allocateLoopbackPort,
  assertIsolatedProbeRuntime,
  assertSafeDatabaseCopySource,
  probeEndpoint,
  runAuthoringPerfProbe,
  seedFixtureData,
  terminateChild,
  type ProbeChild,
  waitForDaemonHealth
} from "../../../scripts/masthead-authoring-perf-probe.js";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead authoring latency probe", () => {
  test("allocates an unused dynamic loopback port", async () => {
    const listen = vi.fn((_port: number, host: string, callback: () => void) => callback());
    const port = await allocateLoopbackPort({
      createServer: () => ({
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 39_125 }),
        close: (callback: (error?: Error) => void) => callback(),
        listen,
        once: vi.fn()
      })
    });
    expect(port).toBe(39_125);
    expect(listen).toHaveBeenCalledWith(0, "127.0.0.1", expect.any(Function));
  });

  test("refuses the production database and symlink database sources", async () => {
    await expect(
      assertSafeDatabaseCopySource("/home/tyler/.config/masthead-production/masthead.sqlite", {
        homeDir: "/home/tyler"
      })
    ).rejects.toThrow(/production database/i);

    const root = await testDirectory();
    const regular = join(root, "rehearsal.sqlite");
    const linked = join(root, "linked.sqlite");
    await writeFile(regular, "fixture");
    await symlink(regular, linked);
    await expect(assertSafeDatabaseCopySource(linked, { homeDir: "/home/tyler" })).rejects.toThrow(/symbolic link/i);
  });

  test("refuses the live production manifest and base URL", () => {
    expect(() =>
      assertIsolatedProbeRuntime({
        baseUrl: "http://127.0.0.1:39123",
        homeDir: "/home/tyler",
        manifestPath: "/home/tyler/.config/masthead-production/masthead-instance.json"
      })
    ).toThrow(/production manifest/i);
    expect(() =>
      assertIsolatedProbeRuntime({
        baseUrl: "http://127.0.0.1:17383",
        homeDir: "/home/tyler",
        liveProductionBaseUrl: "http://127.0.0.1:17383",
        manifestPath: "/tmp/masthead-probe/masthead-instance.json"
      })
    ).toThrow(/production base URL/i);
  });

  test("bounds health and measured HTTP requests with abort deadlines", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const response = { arrayBuffer: async () => new ArrayBuffer(0), ok: true, status: 200 } as Response;
    const fetchImpl = vi.fn(async () => response);

    await waitForDaemonHealth("http://127.0.0.1:39123", { exitCode: null }, 100, { fetchImpl });
    await probeEndpoint("http://127.0.0.1:39123", "/logbook/summary", 250, { fetchImpl });

    expect(timeout.mock.calls[0]?.[0]).toBeGreaterThan(0);
    expect(timeout.mock.calls[0]?.[0]).toBeLessThanOrEqual(100);
    expect(timeout).toHaveBeenCalledWith(250);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("seeds a historical corpus with transcript evidence, activity, usage, and multiple artifacts", async () => {
    const root = await testDirectory();
    const db = await openMastheadDatabase(join(root, "fixture.sqlite"));
    migrateDatabase(db);

    seedFixtureData(db, 10);

    expect(tableCount(db, "sessions")).toBe(10);
    expect(tableCount(db, "messages")).toBe(20);
    expect(tableCount(db, "tool_calls")).toBe(10);
    expect(tableCount(db, "tool_results")).toBe(10);
    expect(tableCount(db, "file_effects")).toBe(10);
    expect(tableCount(db, "model_usage")).toBe(10);
    expect(tableCount(db, "workbench_activity")).toBe(20);
    expect(tableCount(db, "session_artifacts")).toBe(18);
    const history = db.prepare("SELECT MIN(started_at) AS earliest, MAX(ended_at) AS latest FROM sessions").get() as {
      earliest: string;
      latest: string;
    };
    expect(Date.parse(history.latest) - Date.parse(history.earliest)).toBeGreaterThan(365 * 24 * 60 * 60 * 1_000);
    db.close();
  });

  test("waits for SIGKILL exit when SIGTERM does not stop the subprocess", async () => {
    const child = fakeChild((signal, process) => {
      if (signal === "SIGKILL") {
        setTimeout(() => process.exit(137), 5);
      }
    });

    await terminateChild(child, { killTimeoutMs: 100, termTimeoutMs: 5 });

    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(child.exitCode).toBe(137);
  });

  test("accepts a subprocess that already exited by signal", async () => {
    const child = {
      exitCode: null,
      signalCode: "SIGTERM" as const,
      kill: vi.fn(() => false)
    };

    await expect(terminateChild(child, { killTimeoutMs: 5, termTimeoutMs: 5 })).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
  });

  test("terminates the subprocess and removes temporary state after a measured endpoint failure", async () => {
    const root = await testDirectory();
    const child = fakeChild((_signal, process) => setTimeout(() => process.exit(0), 5));
    let summaryReads = 0;
    const probe = vi.fn(async (_baseUrl: string, path: string) => {
      if (path === "/logbook/summary" && ++summaryReads === 2) throw new Error("measured endpoint failed");
      return 1;
    });

    await expect(
      runAuthoringPerfProbe(
        { fixtureSessions: 10 },
        {
          allocatePort: async () => 39_123,
          createWorkspace: async () => root,
          prepareFixtureDatabase: async (databasePath) => {
            await mkdir(join(root, "data"), { recursive: true });
            await writeFile(databasePath, "fixture");
            await writeFile(`${databasePath}-wal`, "sidecar");
          },
          probe,
          spawnDaemon: () => child,
          waitForHealth: async () => 5
        }
      )
    ).rejects.toThrow("measured endpoint failed");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.exitCode).toBe(0);
    expect(summaryReads).toBe(2);
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes temporary database, manifest, and directory after success", async () => {
    const root = await testDirectory();
    const child = fakeChild((_signal, process) => setTimeout(() => process.exit(0), 5));
    const result = await runAuthoringPerfProbe(
      { fixtureSessions: 10 },
      {
        allocatePort: async () => 39_124,
        createWorkspace: async () => root,
        prepareFixtureDatabase: async (databasePath) => {
          await mkdir(join(root, "data"), { recursive: true });
          await writeFile(databasePath, "fixture");
        },
        probe: async () => 1,
        spawnDaemon: () => child,
        waitForHealth: async () => 5
      }
    );

    expect(result.healthReadyMs).toBe(5);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.exitCode).toBe(0);
    expect(result.endpoints["/logbook/summary"]?.samplesMs).toHaveLength(5);
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes temporary state even when subprocess termination throws", async () => {
    const root = await testDirectory();

    await expect(
      runAuthoringPerfProbe(
        { fixtureSessions: 10 },
        {
          allocatePort: async () => 39_125,
          createWorkspace: async () => root,
          prepareFixtureDatabase: async (databasePath) => writeFile(databasePath, "fixture"),
          probe: async () => 1,
          spawnDaemon: () => ({
            exitCode: null,
            kill: () => {
              throw new Error("termination failed");
            },
            once: () => undefined
          }),
          waitForHealth: async () => 5
        }
      )
    ).rejects.toThrow("termination failed");

    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function fakeChild(
  onKill: (signal: "SIGTERM" | "SIGKILL", process: { exit: (code: number) => void }) => void
): EventEmitter & ProbeChild {
  const child = new EventEmitter() as EventEmitter & ProbeChild;
  child.exitCode = null;
  const process = {
    exit(code: number) {
      child.exitCode = code;
      child.emit("exit", code, null);
    }
  };
  child.kill = vi.fn((signal: "SIGTERM" | "SIGKILL"): boolean => {
    onKill(signal, process);
    return true;
  });
  return child;
}

function tableCount(db: { prepare: (sql: string) => { get: () => unknown } }, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

async function testDirectory(): Promise<string> {
  const path = join(tmpdir(), `masthead-authoring-probe-test-${crypto.randomUUID()}`);
  tempDirs.push(path);
  await mkdir(path, { recursive: true });
  return path;
}
