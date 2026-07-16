import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkpointMastheadDatabase,
  openMastheadDatabase,
  optimizeMastheadDatabase,
  quickCheckMastheadDatabase,
  withImmediateTransaction
} from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("SQLite runtime metadata", () => {
  test("declares a Node engine that supports node:sqlite without an experimental flag", async () => {
    const packageJsonPath = fileURLToPath(new URL("../../../../package.json", import.meta.url));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      engines?: {
        node?: string;
      };
    };

    expect(packageJson.engines?.node).toBe(">=24.15.0");
  });

  test("opens Masthead databases with WAL, foreign keys, busy timeout, and FTS5", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-sqlite-runtime-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    try {
      const journal = db.prepare("PRAGMA journal_mode;").get() as { journal_mode: string };
      const foreignKeys = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
      const busyTimeout = db.prepare("PRAGMA busy_timeout;").get() as { timeout: number };
      db.exec("CREATE VIRTUAL TABLE runtime_fts USING fts5(text);");

      expect(journal.journal_mode).toBe("wal");
      expect(foreignKeys.foreign_keys).toBe(1);
      expect(busyTimeout.timeout).toBe(3000);
    } finally {
      db.close();
    }
  });

  test("runs explicit SQLite maintenance helpers without closing the caller-owned database", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-sqlite-maintenance-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    try {
      db.exec("CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
      db.prepare("INSERT INTO records(value) VALUES (?)").run("launch-ready");

      quickCheckMastheadDatabase(db);
      optimizeMastheadDatabase(db);
      checkpointMastheadDatabase(db);

      const row = db.prepare("SELECT value FROM records WHERE id = 1").get() as { value: string };
      expect(row.value).toBe("launch-ready");
    } finally {
      db.close();
    }
  });

  test("joins a caller-owned transaction without committing it", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-sqlite-nested-transaction-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    try {
      db.exec("CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
      db.exec("BEGIN IMMEDIATE;");

      withImmediateTransaction(db, () => {
        db.prepare("INSERT INTO records(value) VALUES (?)").run("caller-owned");
      });

      expect(db.isTransaction).toBe(true);
      db.exec("ROLLBACK;");
      expect(db.prepare("SELECT COUNT(*) AS count FROM records").get()).toEqual({ count: 0 });
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK;");
      db.close();
    }
  });
});
