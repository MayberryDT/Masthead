import { access, copyFile, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import { acquireDatabaseWriterLock, acquireLegacyDataDirectoryGuard } from "../../core/daemonOwnership.ts";
import type { DaemonConfig } from "../../daemon/config.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateTestDatabaseThrough } from "../../daemon/db/__tests__/schemaTestHelpers.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { runMastheadCli } from "../mastheadctl.ts";
import { openAuthoringRun } from "../../workbench/authoring/authoringService.ts";
import { fingerprintWorkbenchOutput } from "../../workbench/applyArtifact.ts";
import {
  seedDurableArtifactCorpus
} from "../../workbench/authoring/__fixtures__/durableArtifactCorpus.ts";
import {
  restoreFailedV1RecoveryBackupInsideExclusiveMaintenance,
  withExclusiveDatabaseMaintenance
} from "../../daemon/databaseBackup.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("mastheadctl daemon-owned Workbench authoring", () => {
  test("discovers candidates by kind and opens exactly one candidate", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedDurableArtifactCorpus(daemon.database);
    const env = { MASTHEAD_DAEMON_URL: baseUrl };
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);

    const listed = await runMastheadCli(
      ["workbench", "candidates", "--kind", "runbook", "--limit", "2", "--json"],
      { env }
    );
    expect(listed.exitCode).toBe(0);
    const listedBody = JSON.parse(listed.stdout);
    expect(listedBody.candidates).toHaveLength(2);
    expect(listedBody.candidates.every((candidate: any) => candidate.kind === "runbook")).toBe(true);

    const candidateId = listedBody.candidates[0].candidateId as string;
    const opened = await runMastheadCli(
      ["workbench", "open", "--database-id", databaseId, "--candidate", candidateId, "--json"],
      { env }
    );
    expect(opened.exitCode).toBe(0);
    expect(JSON.parse(opened.stdout)).toMatchObject({
      run: { candidateId, contractVersion: "workbench-authoring-v2" }
    });

    const arbitrary = await runMastheadCli(
      ["workbench", "open", "--database-id", databaseId, "--session", "session:oauth-fixed", "--json"],
      { env }
    );
    expect(arbitrary.exitCode).toBe(1);
    expect(JSON.parse(arbitrary.stderr)).toMatchObject({ error: { code: "missing_argument" } });
  });

  test("advertises only daemon authoring commands plus explicit wipe maintenance", async () => {
    const top = await runMastheadCli(["--help"], { env: {} });
    expect(top.stdout).toContain("mastheadctl workbench");
    expect(top.stdout).toContain("workbench open");

    const result = await runMastheadCli(["workbench", "--help"], { env: {} });
    for (const command of [
      "capabilities", "candidates", "open", "status", "evidence", "submit", "finish",
      "audit-v1-generation", "prepare-v1-recovery", "invalidate-v1-generation", "restore-v1-recovery",
      "wipe-published"
    ]) {
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

    const openedBody = openAuthoringRun(daemon.database, {
      actorId: "mastheadctl",
      databaseId,
      sessionIds: ["session:a"]
    });
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
      ["workbench", "open", "--database-id", "wrong", "--candidate", "candidate:any", "--json"],
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

  test.each([
    { args: ["workbench", "open", "--database-id", "--candidate", "candidate:any", "--json"], option: "--database-id" },
    { args: ["workbench", "open", "--database-id", "database", "--candidate", "--json"], option: "--candidate" },
    { args: ["workbench", "status", "--run", "--json"], option: "--run" },
    { args: ["workbench", "submit", "--run", "run", "--file", "--json"], option: "--file" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "--json"], option: "--session" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--cursor", "--json"], option: "--cursor" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--limit", "--json"], option: "--limit" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--order", "--json"], option: "--order" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--kind", "--json"], option: "--kind" },
    { args: ["workbench", "evidence", "--run", "run", "--session", "session:a", "--query", "--json"], option: "--query" }
  ])("rejects valueless $option before network or filesystem access", async ({ args, option }) => {
    const result = await runMastheadCli(args, {
      env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "missing_argument", message: `Missing value for option: ${option}` },
      ok: false
    });
  });

  test("normalizes a blank daemon URL to the default connector", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          bundleVersion: "workbench-authoring-v2",
          capability: "artifact_authoring",
          command: "mastheadctl",
          databaseId: "database",
          evidencePolicy: "candidate_scoped_canonical_evidence",
          evidenceRequirements: {
            adr: ["context", "decision", "alternatives"],
            incident_timeline: ["symptom", "ordered_events", "remediation"],
            runbook: ["problem", "change", "verification"]
          },
          operations: ["candidates", "open", "status", "evidence", "submit", "finish"],
          protocol: "masthead.workbench.authoring/v1",
          transport: "daemon_http"
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    );

    const result = await runMastheadCli(["workbench", "capabilities", "--json"], {
      env: { MASTHEAD_DAEMON_URL: "   " }
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17373/workbench/authoring/capabilities",
      expect.any(Object)
    );
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

  test.each([
    "db-path",
    "schema",
    "instructions",
    "validate",
    "apply",
    "artifacts",
    "publish",
    "na",
    "not-applicable",
    "provenance-candidates",
    "enroll",
    "claim",
    "release",
    "activity",
    "not-added",
    "transcript",
    "quality",
    "batch",
    "queue",
    "next"
  ])("rejects removed direct-database command %s before opening SQLite", async (command) => {
    const tempDir = await makeTempDir("masthead-cli-removed-");
    const databasePath = join(tempDir, "must-not-be-created.sqlite");

    const result = await runMastheadCli(
      ["workbench", command, "--db", databasePath, "--json"],
      { env: {} }
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "unknown_command", message: `Unknown workbench command: ${command}` },
      ok: false
    });
    await expect(stat(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not import the legacy direct-SQLite Workbench stack", async () => {
    const sourceRoot = join(process.cwd(), "src", "cli");
    const source = await readFile(join(sourceRoot, "workbench.ts"), "utf8");
    expect(source).not.toContain("workbenchLegacy");
    await expect(stat(join(sourceRoot, "workbenchLegacy.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cannot mutate SQLite through removed apply, publish, or not-applicable commands", async () => {
    const tempDir = await makeTempDir("masthead-cli-no-direct-writes-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const outputPath = join(tempDir, "enrichment.json");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:boundary",
      title: "Authoring boundary"
    });
    const before = authoringOutputCounts(db);
    db.close();
    await writeFile(
      outputPath,
      JSON.stringify({
        confidence: "medium",
        evidenceRefs: ["message:session:boundary:message"],
        missingEvidence: [],
        searchPhrases: ["authoring boundary"],
        summary: "This must not be written directly.",
        technologies: ["TypeScript"],
        title: "Forbidden direct authoring",
        topics: ["Workbench"]
      }),
      "utf8"
    );

    const removedCommands = [
      ["apply", "--kind", "session_enrichment", "--session", "session:boundary", "--file", outputPath],
      ["publish", "--session", "session:boundary"],
      ["not-applicable", "--kind", "runbook", "--session", "session:boundary", "--reason", "not_needed"]
    ];
    for (const command of removedCommands) {
      const result = await runMastheadCli(
        ["workbench", ...command, "--db", databasePath, "--json"],
        { env: {} }
      );
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: "unknown_command" },
        ok: false
      });
    }

    const afterDb = await openMastheadDatabase(databasePath);
    expect(authoringOutputCounts(afterDb)).toEqual(before);
    afterDb.close();
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

  test("keeps failed V1 recovery audit and prepare dry, then requires the exact hash and confirmation", async () => {
    const tempDir = await makeTempDir("masthead-cli-v1-recovery-");
    const dbPath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(dbPath);
    migrateDatabase(db);
    const databaseId = getOrCreateDatabaseIdentity(db);
    seedCliFailedV1Generation(db);
    db.close();

    const audited = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(audited.exitCode).toBe(0);
    const audit = JSON.parse(audited.stdout).audit as { auditHash: string; dossiers: number };
    expect(audit).toMatchObject({ dossiers: 1_283, auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(readCliRecoveryCounts(dbPath)).toMatchObject({ artifacts: 1_283, runs: 66 });

    const prepared = await runMastheadCli(
      ["workbench", "prepare-v1-recovery", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(prepared.exitCode).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      audit: { auditHash: audit.auditHash, dossiers: 1_283 },
      backup: { integrityResult: "ok", sizeBytes: expect.any(Number) },
      ok: true
    });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toHaveLength(1);
    expect(readCliRecoveryCounts(dbPath)).toMatchObject({ artifacts: 1_283, runs: 66 });

    const missingHash = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingHash.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    const missingConfirmation = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", audit.auditHash, "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingConfirmation.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    const legacyGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      const blockedByOwner = await runMastheadCli(
        ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", audit.auditHash, "--confirm", "--json"],
        { env: {} }
      );
      expect(JSON.parse(blockedByOwner.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
      expect(readCliRecoveryCounts(dbPath)).toMatchObject({ artifacts: 1_283, runs: 66 });
    } finally {
      await legacyGuard.release();
    }
    const mismatched = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", "0".repeat(64), "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(mismatched.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toMatchObject({ artifacts: 1_283, runs: 66 });

    const invalidated = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", audit.auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(invalidated.exitCode).toBe(0);
    expect(JSON.parse(invalidated.stdout)).toMatchObject({
      ok: true,
      receipt: { artifactsInvalidated: 1_283, auditHash: audit.auditHash, sessionsReset: 1_283 }
    });
    expect(readCliRecoveryCounts(dbPath)).toMatchObject({ artifacts: 0, runs: 66 });
    const verified = new DatabaseSync(dbPath, { readOnly: true });
    expect(verified.prepare(
      "SELECT adr_status AS adrStatus, session_dossier_status AS dossierStatus FROM workbench_session_state WHERE session_id = 'session:cli-failed:0000'"
    ).get()).toEqual({ adrStatus: "unknown", dossierStatus: "missing" });
    verified.close();

    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${backupPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
    for (const omitted of ["backup", "auditHash", "confirmation"] as const) {
      const restoreArgs = ["workbench", "restore-v1-recovery", "--db", dbPath];
      if (omitted !== "backup") restoreArgs.push("--backup", backupPath);
      if (omitted !== "auditHash") restoreArgs.push("--audit-hash", audit.auditHash);
      if (omitted !== "confirmation") restoreArgs.push("--confirm");
      restoreArgs.push("--json");
      const refused = await runMastheadCli(restoreArgs, { env: {} });
      expect(JSON.parse(refused.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
      expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    }

    const backupBytesBeforeSidecarRefusal = await readFile(backupPath);
    const activeBytesBeforeSidecarRefusal = await readFile(dbPath);
    const backupSidecars = ["-wal", "-shm", "-journal"].map((suffix) => `${backupPath}${suffix}`);
    for (const sidecarPath of backupSidecars) await writeFile(sidecarPath, "");
    const sidecarRefused = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(sidecarRefused.exitCode).toBe(1);
    expect(JSON.parse(sidecarRefused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_restore_backup_sidecar_present") },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(activeBytesBeforeSidecarRefusal);
    expect(await readFile(backupPath)).toEqual(backupBytesBeforeSidecarRefusal);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    for (const sidecarPath of backupSidecars) expect(await readFile(sidecarPath)).toEqual(Buffer.alloc(0));
    await Promise.all(backupSidecars.map((sidecarPath) => rm(sidecarPath)));

    const outside = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath,
        "--backup", join(tempDir, "outside.backup-current"),
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(outside.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });

    const heldBackupPath = join(tempDir, "held-backup.sqlite");
    await rename(backupPath, heldBackupPath);
    await symlink(heldBackupPath, backupPath, "file");
    const symlinked = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(symlinked.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    await rm(backupPath);
    await rename(heldBackupPath, backupPath);

    const writerLease = await acquireDatabaseWriterLock(dbPath);
    try {
      const leased = await runMastheadCli(
        [
          "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
          "--audit-hash", audit.auditHash, "--confirm", "--json"
        ],
        { env: {} }
      );
      expect(JSON.parse(leased.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
      expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    } finally {
      await writerLease.release();
    }

    const activeLegacyGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      const guarded = await runMastheadCli(
        [
          "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
          "--audit-hash", audit.auditHash, "--confirm", "--json"
        ],
        { env: {} }
      );
      expect(JSON.parse(guarded.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
      expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    } finally {
      await activeLegacyGuard.release();
    }

    const staleSentinelPath = join(tempDir, "runtime", "database.lock");
    const staleSentinel = JSON.stringify({ createdAt: "2026-07-01T00:00:00.000Z", pid: 999_999_999, token: "stale" });
    await writeFile(staleSentinelPath, staleSentinel, "utf8");
    const staleGuard = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(staleGuard.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(await readFile(staleSentinelPath, "utf8")).toBe(staleSentinel);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    await rm(staleSentinelPath);

    const mismatchedIdentityDb = new DatabaseSync(backupPath);
    const originalIdentity = mismatchedIdentityDb.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string };
    mismatchedIdentityDb.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(JSON.stringify({ databaseId: "wrong-database-id" }));
    mismatchedIdentityDb.close();
    const wrongIdentity = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongIdentity.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    const resetIdentityDb = new DatabaseSync(backupPath);
    resetIdentityDb.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(originalIdentity.value);
    resetIdentityDb.close();

    const wrongHash = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "0".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongHash.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });

    const backupSafetyPath = join(tempDir, "backup-safety.sqlite");
    await copyFile(backupPath, backupSafetyPath);
    await writeFile(backupPath, "not a sqlite database", "utf8");
    const corrupt = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", audit.auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(corrupt.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    await copyFile(backupSafetyPath, backupPath);
    await rm(backupSafetyPath);

    const activeBytesBeforeInjectedFailure = await readFile(dbPath);
    const backupBytesBeforeInjectedFailure = await readFile(backupPath);
    await expect(
      withExclusiveDatabaseMaintenance(dbPath, (ownership) =>
        restoreFailedV1RecoveryBackupInsideExclusiveMaintenance(
          dbPath,
          backupPath,
          audit.auditHash,
          ownership,
          {
            onBoundary(boundary) {
              if (boundary === "before_promotion") throw new Error("injected:before_promotion");
            }
          }
        )
      )
    ).rejects.toThrow("injected:before_promotion");
    expect(await readFile(dbPath)).toEqual(activeBytesBeforeInjectedFailure);
    expect(await readFile(backupPath)).toEqual(backupBytesBeforeInjectedFailure);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    expect((await readdir(tempDir)).some((name) => name.includes("restore-stage"))).toBe(false);

    for (const suffix of ["-wal", "-shm", "-journal"]) await writeFile(`${dbPath}${suffix}`, "");
    const restored = await runMastheadCli(
      [
        "workbench",
        "restore-v1-recovery",
        "--db",
        dbPath,
        "--backup",
        backupPath,
        "--audit-hash",
        audit.auditHash,
        "--confirm",
        "--json"
      ],
      { env: {} }
    );
    expect(restored.exitCode).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({
      databasePath: dbPath,
      ok: true,
      receipt: {
        artifactsRestored: 1_283,
        auditHash: audit.auditHash,
        backupPath,
        backupPreserved: true,
        databaseId,
        integrityResult: "ok",
        runsRestored: 66,
        sessionsRestored: 1_283
      }
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${dbPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }, 120_000);

  test("audits the exact failed V1 generation through the CLI on schema 21", async () => {
    const tempDir = await makeTempDir("masthead-cli-v1-schema21-audit-");
    const dbPath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(dbPath);
    migrateTestDatabaseThrough(db, 21);
    getOrCreateDatabaseIdentity(db);
    seedCliFailedV1Generation(db, { schema21: true });
    db.close();

    const audited = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );

    expect(audited.exitCode).toBe(0);
    expect(JSON.parse(audited.stdout)).toMatchObject({
      audit: {
        auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contractVersion: "workbench-authoring-v1",
        dossiers: 1_283,
        totalRuns: 66,
        totalSessions: 1_283
      },
      databasePath: dbPath,
      ok: true
    });
  }, 120_000);
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

function authoringOutputCounts(db: Awaited<ReturnType<typeof openMastheadDatabase>>) {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    artifacts: count("session_artifacts"),
    authoringRuns: count("workbench_authoring_runs"),
    enrichments: count("session_enrichments"),
    pipelineRows: count("workbench_session_state")
  };
}

function seedCliFailedV1Generation(
  db: Awaited<ReturnType<typeof openMastheadDatabase>>,
  options: { schema21?: boolean } = {}
): void {
  const createdAt = "2026-07-11T08:00:00.000Z";
  const publishedAt = "2026-07-11T08:30:00.000Z";
  const completedAt = "2026-07-11T09:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:cli-failed", "fixture", createdAt, completedAt
  );
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:cli-failed", "codex", "fixture", createdAt, completedAt
  );
  const session = db.prepare(
    `INSERT INTO sessions (session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at) VALUES (?, 'host:cli-failed', 'runtime:cli-failed', ?,
      'ended', ?, 'authoritative', ?, ?)`
  );
  const state = db.prepare(
    `INSERT INTO workbench_session_state (session_id, publication_status, next_action, transcript_status,
      quality_status, session_enrichment_status, session_dossier_status, bug_fix_trace_status,
      runbook_status, adr_status, incident_timeline_status, session_package_status, resolution_status,
      published_at, created_at, updated_at) VALUES (?, 'published', 'none', 'available', 'passed',
      'satisfied', 'satisfied', 'not_applicable', 'not_applicable', 'not_applicable', 'not_applicable',
      'published', 'automatic_resolved', ?, ?, ?)`
  );
  const claim = db.prepare(
    `INSERT INTO workbench_claims (claim_id, session_id, claimed_by, claimed_at, heartbeat_at,
      expires_at, released_at, release_reason) VALUES (?, ?, 'failed-agent', ?, ?, ?, ?, ?)`
  );
  const artifact = db.prepare(
    `INSERT INTO session_artifacts (artifact_id, session_id, artifact_kind, status, content_fingerprint,
      created_at, updated_at, created_by, schema_version, title, content_json, evidence_refs_json,
      validation_json, publication_status, lineage_id, published_at) VALUES (?, ?, 'session_dossier',
      'current', ?, ?, ?, 'workbench_authoring:failed-agent', 'session_dossier-v2', ?, ?, '[]', ?,
      'published', ?, ?)`
  );
  const provenance = db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)");
  const search = db.prepare(
    "INSERT INTO session_artifact_search (artifact_id, title, summary, highlight, project, body) VALUES (?, ?, '', '', '', ?)"
  );
  const runSession = db.prepare(
    "INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal) VALUES (?, ?, ?, ?)"
  );
  const packages: Array<Record<string, unknown>> = [];
  const notApplicable: Array<Record<string, unknown>> = [];
  const publishedArtifactIds: string[] = [];
  const resolvedSessionIds: string[] = [];
  const members: Array<{ claimId: string; sessionId: string }> = [];
  for (let index = 0; index < 1_283; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const sessionId = `session:cli-failed:${suffix}`;
    const claimId = `claim:cli-failed:${suffix}`;
    const artifactId = `artifact:cli-failed:${suffix}`;
    const dossier = {
      approach: [
        "Read every canonical evidence item through cursor pagination.",
        "Kept all claims single-session and limited unsupported root-cause or publication assertions."
      ],
      commandsAndTools: [{
        label: "Masthead Workbench evidence reader",
        purpose: "Read the session manifest to completion.",
        status: "completed"
      }],
      filesTouched: [{
        label: "No canonical file effect recorded",
        role: "No file effect was asserted in the reviewed evidence."
      }],
      keyDecisions: ["Keep the package single-provenance and avoid weak multi-session joins."],
      missingEvidence: ["The redacted session record does not independently establish a published artifact or durable root cause."],
      outcome: "The canonical redacted record was fully reviewed; no stronger published outcome is asserted without direct supporting evidence.",
      problemStatement: "Generic problem: review the selected session's canonical evidence.",
      title: `CLI failed dossier ${suffix}`
    };
    session.run(sessionId, sessionId, publishedAt, createdAt, publishedAt);
    state.run(sessionId, publishedAt, createdAt, publishedAt);
    claim.run(claimId, sessionId, createdAt, createdAt, completedAt, index === 0 ? null : completedAt, index === 0 ? null : "authoring_finished");
    artifact.run(
      artifactId, sessionId, fingerprintWorkbenchOutput(dossier), createdAt, publishedAt, dossier.title,
      JSON.stringify(dossier), JSON.stringify({ contract: "workbench-authoring-v1", ok: true, schemaVersion: "session_dossier-v2" }),
      artifactId, publishedAt
    );
    provenance.run(artifactId, sessionId);
    search.run(artifactId, dossier.title, JSON.stringify(dossier));
    packages.push({ dossier, enrichment: {}, sessionId });
    publishedArtifactIds.push(artifactId);
    resolvedSessionIds.push(sessionId);
    members.push({ claimId, sessionId });
    for (const kind of ["runbook", "adr", "incident_timeline"]) {
      notApplicable.push({ evidenceRefs: [], kind, reason: "No reusable output", sessionId });
    }
  }
  const insertRun = db.prepare(options.schema21
    ? `INSERT INTO workbench_authoring_runs (run_id, actor_id, database_id, status, evidence_revision,
        bundle_json, findings_json, receipt_json, created_at, updated_at, completed_at)
       VALUES (?, 'failed-agent', 'fixture-db', 'completed', 'cli-revision', ?, '[]', ?, ?, ?, ?)`
    : `INSERT INTO workbench_authoring_runs (run_id, actor_id, database_id, status, evidence_revision,
        bundle_json, findings_json, receipt_json, created_at, updated_at, completed_at, contract_version,
        candidate_id) VALUES (?, 'failed-agent', 'fixture-db', 'completed', 'cli-revision', ?, '[]', ?, ?, ?, ?,
        'workbench-authoring-v1', NULL)`
  );
  let offset = 0;
  for (let runIndex = 0; offset < packages.length; runIndex += 1) {
    const remaining = packages.length - offset;
    const size = remaining === 3 ? 2 : Math.min(20, remaining);
    const runId = `run:cli-failed-v1:${String(runIndex).padStart(3, "0")}`;
    const runPackages = packages.slice(offset, offset + size);
    const runMembers = members.slice(offset, offset + size);
    const runArtifactIds = publishedArtifactIds.slice(offset, offset + size);
    const runSessionIds = resolvedSessionIds.slice(offset, offset + size);
    const runNotApplicable = notApplicable.filter((decision) =>
      runSessionIds.includes(decision.sessionId as string)
    );
    const bundle = {
      artifacts: [], bundleVersion: "workbench-authoring-v1", contributions: [], evidenceRevision: "cli-revision",
      notApplicable: runNotApplicable, runId, sessionPackages: runPackages
    };
    const receipt = {
      completedAt, contributions: [], notApplicable: runNotApplicable.map(({ kind, sessionId }) => ({ kind, sessionId })),
      publishedArtifactIds: runArtifactIds, resolvedSessionIds: runSessionIds, runId
    };
    insertRun.run(runId, JSON.stringify(bundle), JSON.stringify(receipt), createdAt, completedAt, completedAt);
    runMembers.forEach((member, index) => runSession.run(runId, member.sessionId, member.claimId, index));
    offset += size;
  }
}

function readCliRecoveryCounts(databasePath: string): { artifacts: number; runs: number } {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    return { artifacts: count("session_artifacts"), runs: count("workbench_authoring_runs") };
  } finally {
    db.close();
  }
}
