import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readCursor, upsertCursor } from "../cursorRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("ingest cursors", () => {
  test("tracks source path byte offset modification time and fingerprint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cursor-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    upsertCursor(db, {
      byteOffset: 120,
      contentFingerprint: "fingerprint-1",
      modifiedAt: "2026-06-24T12:30:00.000Z",
      sourceId: "codex-sessions",
      sourcePath: "/tmp/session.jsonl"
    });

    expect(readCursor(db, "codex-sessions", "/tmp/session.jsonl")).toMatchObject({
      byteOffset: 120,
      contentFingerprint: "fingerprint-1",
      sourceId: "codex-sessions",
      sourcePath: "/tmp/session.jsonl"
    });
    db.close();
  });
});
