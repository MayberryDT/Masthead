import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  test("reports Codex as not detected when local Codex files are missing", async () => {
    const { db, home } = await openSourceDiscoveryTestDatabase("masthead-source-discovery-missing-");

    const snapshot = await discoverSourceSnapshot({ codexHomeDir: home, now: "2026-06-25T12:00:00.000Z" });
    const adapters = getAdapterStatuses(db, snapshot);

    expect(adapters.find((adapter) => adapter.runtime === "codex")).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "codex_sources_not_detected", severity: "warning" })],
      discoveredCount: 0,
      implementationState: "active",
      importedCount: 0,
      sourceLocations: [],
      state: "not_detected"
    });
    db.close();
  });

  test("counts detected Codex candidates before import", async () => {
    const { db, home } = await openSourceDiscoveryTestDatabase("masthead-source-discovery-connected-");
    const codexRoot = join(home, ".codex");
    await mkdir(join(codexRoot, "sessions", "2026", "06"), { recursive: true });
    await mkdir(join(codexRoot, "archived_sessions", "2025"), { recursive: true });
    await writeFile(join(codexRoot, "session_index.jsonl"), "{}\n");
    await writeFile(join(codexRoot, "history.jsonl"), "{}\n");
    await writeFile(join(codexRoot, "sessions", "2026", "06", "one.jsonl"), "{}\n");
    await writeFile(join(codexRoot, "sessions", "2026", "06", "two.jsonl"), "{}\n");
    await writeFile(join(codexRoot, "archived_sessions", "2025", "old.jsonl"), "{}\n");

    const snapshot = await discoverSourceSnapshot({ codexHomeDir: home, now: "2026-06-25T12:00:00.000Z" });
    const adapters = getAdapterStatuses(db, snapshot);

    expect(adapters.find((adapter) => adapter.runtime === "codex")).toMatchObject({
      diagnostics: [],
      discoveredCount: 5,
      implementationState: "active",
      importedCount: 0,
      state: "connected"
    });
    expect(adapters.find((adapter) => adapter.runtime === "codex")?.sourceLocations.map((source) => source.sourceId)).toEqual(
      expect.arrayContaining(["codex-session-index", "codex-history", "codex-sessions", "codex-archived-sessions"])
    );
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
