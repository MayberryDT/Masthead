import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import type { DaemonConfig } from "../../daemon/config.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { runMastheadCli } from "../mastheadctl.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("mastheadctl daemon-owned Workbench authoring", () => {
  test("advertises only daemon authoring commands plus explicit wipe maintenance", async () => {
    const top = await runMastheadCli(["--help"], { env: {} });
    expect(top.stdout).toContain("mastheadctl workbench");
    expect(top.stdout).toContain("workbench open");

    const result = await runMastheadCli(["workbench", "--help"], { env: {} });
    for (const command of ["capabilities", "open", "status", "evidence", "submit", "finish", "wipe-published"]) {
      expect(result.stdout).toContain(`workbench ${command}`);
    }
    for (const removed of ["queue", "next", "apply", "publish", "not-applicable", "batch"]) {
      expect(result.stdout).not.toContain(`workbench ${removed}`);
    }
  });

  test("uses daemon-owned commands without --db and preserves revision findings", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:a",
      title: "CLI authoring session"
    });
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);
    const env = { MASTHEAD_DAEMON_URL: baseUrl };

    const capabilities = await runMastheadCli(["workbench", "capabilities", "--json"], { env });
    expect(capabilities.exitCode).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      ok: true,
      capability: "artifact_authoring",
      databaseId
    });

    const opened = await runMastheadCli(
      ["workbench", "open", "--database-id", databaseId, "--session", "session:a", "--json"],
      { env }
    );
    expect(opened.exitCode).toBe(0);
    expect(opened.stderr).toBe("");
    const openedBody = JSON.parse(opened.stdout);
    expect(openedBody).toMatchObject({ ok: true, run: { sessionIds: ["session:a"], status: "open" } });
    const runId = openedBody.run.runId as string;

    const status = await runMastheadCli(["workbench", "status", "--run", runId, "--json"], { env });
    expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, evidenceStatus: "current", run: { runId } });

    const evidence = await runMastheadCli(
      [
        "workbench",
        "evidence",
        "--run",
        runId,
        "--session",
        "session:a",
        "--limit",
        "25",
        "--order",
        "desc",
        "--kind",
        "all",
        "--json"
      ],
      { env }
    );
    expect(JSON.parse(evidence.stdout)).toMatchObject({ ok: true, sessionId: "session:a" });

    const tempDir = await makeTempDir("masthead-cli-bundle-");
    const bundlePath = join(tempDir, "bundle.json");
    await writeFile(
      bundlePath,
      JSON.stringify({
        artifacts: [],
        bundleVersion: "workbench-authoring-v1",
        contributions: [],
        evidenceRevision: openedBody.run.evidenceRevision,
        notApplicable: [],
        runId,
        sessionPackages: []
      }),
      "utf8"
    );
    const submitted = await runMastheadCli(
      ["workbench", "submit", "--run", runId, "--file", bundlePath, "--json"],
      { env }
    );
    expect(submitted.exitCode).toBe(0);
    expect(JSON.parse(submitted.stdout)).toMatchObject({ accepted: false, ok: true, run: { status: "needs_revision" } });

    const finish = await runMastheadCli(["workbench", "finish", "--run", runId, "--json"], { env });
    expect(finish.exitCode).toBe(1);
    expect(JSON.parse(finish.stderr)).toMatchObject({
      ok: false,
      error: { code: "run_not_ready", status: 409, body: { error: { code: "authoring_run_not_ready" } } }
    });
  });

  test("enforces database identity before open and the daemon enforces it again", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:identity",
      title: "Identity boundary"
    });
    const result = await runMastheadCli(
      ["workbench", "open", "--database-id", "wrong", "--session", "session:identity", "--json"],
      { env: { MASTHEAD_DAEMON_URL: baseUrl } }
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: { code: "database_identity_mismatch" }
    });
    expect(daemon.database.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 0 });
  });

  test("returns structured daemon and argument failures", async () => {
    const unavailable = await runMastheadCli(["workbench", "capabilities", "--json"], {
      env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" }
    });
    expect(unavailable.exitCode).toBe(1);
    expect(JSON.parse(unavailable.stderr)).toMatchObject({ ok: false, error: { code: "daemon_unavailable" } });

    const missing = await runMastheadCli(["workbench", "status", "--json"], { env: {} });
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr)).toMatchObject({ ok: false, error: { code: "missing_argument" } });
  });

  test("catches unexpected failures at the executable boundary", async () => {
    const binPath = join(process.cwd(), "dist", "daemon", "src", "cli", "mastheadctl.js");
    let failure: { code: number; stderr: string; stdout: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [binPath, "workbench", "submit", "--run", "missing", "--file", "/definitely/missing/bundle.json", "--json"],
        { env: process.env }
      );
    } catch (error) {
      failure = error as { code: number; stderr: string; stdout: string };
    }

    expect(failure?.code).toBe(1);
    expect(failure?.stdout).toBe("");
    expect(JSON.parse(failure?.stderr ?? "")).toMatchObject({
      ok: false,
      error: { code: "unhandled_cli_error" }
    });
  });

  test("keeps the normal authoring startup path free of SQLite imports", async () => {
    const sourceRoot = join(process.cwd(), "src", "cli");
    for (const file of ["mastheadctl.ts", "workbench.ts", "authoringClient.ts"]) {
      const source = await readFile(join(sourceRoot, file), "utf8");
      expect(source).not.toMatch(/daemon\/db\/(?:sqlite|schema|workbench|sessionArtifact)/);
    }
  });

  test("preserves wipe-published as an explicit direct-database maintenance command", async () => {
    const tempDir = await makeTempDir("masthead-cli-wipe-");
    const dbPath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(dbPath);
    migrateDatabase(db);
    db.close();

    const confirmation = await runMastheadCli(
      ["workbench", "wipe-published", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(confirmation.exitCode).toBe(1);
    expect(JSON.parse(confirmation.stderr)).toMatchObject({ ok: false, error: { code: "missing_argument" } });

    const wiped = await runMastheadCli(
      ["workbench", "wipe-published", "--db", dbPath, "--confirm", "--json"],
      { env: {} }
    );
    expect(wiped.exitCode).toBe(0);
    expect(JSON.parse(wiped.stdout)).toMatchObject({ ok: true });
  });
});

async function startTestDaemon(): Promise<{ baseUrl: string; daemon: MastheadDaemon }> {
  const tempDir = await makeTempDir("masthead-authoring-cli-");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    backgroundHydrationEnabled: false,
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
  const baseUrl = await new Promise<string>((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(daemon.server.address() as AddressInfo).port}`);
    });
  });
  return { baseUrl, daemon };
}

async function makeTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}
