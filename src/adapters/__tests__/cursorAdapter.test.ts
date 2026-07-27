import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { cursorAdapter } from "../cursor/adapter.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Cursor adapter", () => {
  test("imports Cursor's current cursorDiskKV composer bubbles", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cursor-adapter-"));
    tempDirs.push(tempDir);
    const path = join(tempDir, "state.vscdb");
    const sqlite = new DatabaseSync(path);
    sqlite.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB);");
    const insert = sqlite.prepare("INSERT INTO cursorDiskKV(key, value) VALUES (?, ?)");
    insert.run(
      "bubbleId:composer-1:bubble-1",
      Buffer.from(JSON.stringify({ createdAt: "2026-07-21T00:00:00.000Z", text: "Cursor user prompt", type: 1 }))
    );
    insert.run(
      "bubbleId:composer-1:bubble-2",
      Buffer.from(JSON.stringify({ createdAt: "2026-07-21T00:00:02.000Z", text: "Cursor assistant reply", type: 2 }))
    );
    sqlite.close();

    const source = {
      confidence: "heuristic",
      path,
      runtime: "cursor",
      schemaVersion: "cursor-sqlite-file",
      sourceId: "cursor:fixture",
      sourceKind: "sqlite"
    } as const;
    const records = [];
    for await (const record of cursorAdapter.backfill(source)) {
      records.push(record);
    }

    expect(records.map((record) => record.diagnostics)).toEqual([[], []]);
    expect(records.map((record) => record.normalized.value)).toEqual([
      expect.objectContaining({ observedAt: "2026-07-21T00:00:00.000Z", role: "user", sessionId: "composer-1", text: "Cursor user prompt" }),
      expect.objectContaining({ observedAt: "2026-07-21T00:00:02.000Z", role: "assistant", sessionId: "composer-1", text: "Cursor assistant reply" })
    ]);

    const [unit] = await cursorAdapter.planTranscriptUnits(source);
    const parsed = await cursorAdapter.parseTranscriptUnit(unit!);
    expect(parsed).toMatchObject({ completeness: "complete", sourceSessionIds: ["composer-1"] });
  });
});
