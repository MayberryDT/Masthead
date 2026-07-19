import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { getAdapterStatuses } from "../../import/sourceStatusService.ts";
import { discoverSourceSnapshot } from "../sourceDiscoveryService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source discovery service", () => {
  test("reports OpenCode as not detected when local OpenCode files are missing", async () => {
    const { db, home } = await openSourceDiscoveryTestDatabase("masthead-source-discovery-missing-");

    const snapshot = await discoverSourceSnapshot({ codexHomeDir: home, now: "2026-06-25T12:00:00.000Z" });
    const adapters = getAdapterStatuses(db, snapshot);

    expect(adapters.find((adapter) => adapter.runtime === "opencode")).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "opencode_sources_not_detected", severity: "warning" })],
      discoveredCount: 0,
      implementationState: "active",
      importedCount: 0,
      sourceLocations: [],
      state: "not_detected"
    });
    db.close();
  });

  test("counts detected OpenCode candidates before import", async () => {
    const { db, home } = await openSourceDiscoveryTestDatabase("masthead-source-discovery-connected-");
    const opencodeRoot = join(home, ".local", "share", "opencode");
    await mkdir(opencodeRoot, { recursive: true });
    const opencode = new DatabaseSync(join(opencodeRoot, "opencode.db"));
    opencode.exec("CREATE TABLE session (id TEXT PRIMARY KEY)");
    opencode.prepare("INSERT INTO session (id) VALUES (?)").run("one");
    opencode.prepare("INSERT INTO session (id) VALUES (?)").run("two");
    opencode.close();

    const snapshot = await discoverSourceSnapshot({ codexHomeDir: home, now: "2026-06-25T12:00:00.000Z" });
    const adapters = getAdapterStatuses(db, snapshot);

    expect(adapters.find((adapter) => adapter.runtime === "opencode")).toMatchObject({
      diagnostics: [],
      discoveredCount: 1,
      implementationState: "active",
      importedCount: 0,
      state: "connected"
    });
    expect(adapters.find((adapter) => adapter.runtime === "opencode")?.sourceLocations).toEqual([
      expect.objectContaining({ path: join(opencodeRoot, "opencode.db"), sourceKind: "sqlite" })
    ]);
    db.close();
  });

  test("includes active Claude Code adapter row when not detected", async () => {
    const { db, home } = await openSourceDiscoveryTestDatabase("masthead-source-discovery-planned-");

    const snapshot = await discoverSourceSnapshot({ codexHomeDir: home, now: "2026-06-25T12:00:00.000Z" });
    const adapters = getAdapterStatuses(db, snapshot);

    expect(adapters.find((adapter) => adapter.runtime === "claude_code")).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "claude_code_sources_not_detected", severity: "warning" })],
      discoveredCount: 0,
      implementationState: "active",
      importedCount: 0,
      name: "Claude Code",
      sourceLocations: [],
      state: "not_detected"
    });
    db.close();
  });
});

async function openSourceDiscoveryTestDatabase(prefix: string): Promise<{ db: MastheadDatabase; home: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const home = join(tempDir, "home");
  await mkdir(home, { recursive: true });
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return { db, home };
}
