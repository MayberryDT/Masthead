import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead daemon startup", () => {
  test("does not create the SQLite database when legacy store initialization fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-startup-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const notDirectory = join(tempDir, "not-a-directory");
    await writeFile(notDirectory, "not a directory", "utf8");

    await expect(
      createMastheadDaemon({
        allowedOrigins: ["http://127.0.0.1:5173"],
        codexHomeDir: tempDir,
        databasePath,
        fixturePath: join(tempDir, "fixture.json"),
        gitRefreshMs: 0,
        host: "127.0.0.1",
        llmCopyEnabled: false,
        port: 0,
        storePath: join(notDirectory, "events.ndjson")
      } satisfies DaemonConfig)
    ).rejects.toThrow();
    await expect(access(databasePath)).rejects.toThrow();
  });
});
