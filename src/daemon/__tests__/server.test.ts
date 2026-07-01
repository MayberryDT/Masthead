import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
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
        hookTranscriptCatchupEnabled: false,
        llmCopyEnabled: false,
        port: 0,
        storePath: join(notDirectory, "events.ndjson")
      } satisfies DaemonConfig)
    ).rejects.toThrow();
    await expect(access(databasePath)).rejects.toThrow();
  });

  test("previews enrichment rebuilds without writing rows", async () => {
    const daemon = await createTestDaemon();
    seedSession(daemon.database, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:rebuild", title: "Rebuild preview" });
    const before = countRows(daemon, "session_enrichments");
    const baseUrl = await listen(daemon);

    const response = await postJson(baseUrl, "/enrichment/rebuild", { dryRun: true, limit: 1, scope: "recent" });

    expect(response).toMatchObject({
      dryRun: true,
      ok: true,
      requested: 1,
      sessions: [{ sessionId: "session:rebuild", status: "dry_run" }]
    });
    expect(countRows(daemon, "session_enrichments")).toBe(before);
  });
});

async function createTestDaemon(): Promise<MastheadDaemon> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-daemon-server-"));
  tempDirs.push(tempDir);
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson")
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return daemon;
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, any>>;
}

function countRows(daemon: MastheadDaemon, table: string): number {
  return (daemon.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
