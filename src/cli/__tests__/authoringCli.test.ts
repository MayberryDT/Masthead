import { access, copyFile, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import { acquireDatabaseWriterLock, acquireLegacyDataDirectoryGuard } from "../../core/daemonOwnership.ts";
import type { DaemonConfig } from "../../daemon/config.ts";
import { markSessionCompileReady, seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
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
import * as sessionArtifactRepository from "../../daemon/db/sessionArtifactRepository.ts";

const tempDirs: string[] = [];
const suiteTempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];
const execFileAsync = promisify(execFile);
let exactCliRecoveryTemplatePromise: Promise<ExactCliRecoveryTemplate> | undefined;
const SMALL_RECOVERY_AUDIT_HASH = "b".repeat(64);
const SMALL_ALTERED_RECOVERY_AUDIT_HASH = "c".repeat(64);

function validCliV3Bundle(runId: string, evidenceRevision: string, sessionId: string) {
  const evidenceRef = {
    id: `message:${sessionId}:message`,
    kind: "event",
    observedAt: "2026-07-10T12:00:00.000Z",
    source: "canonical"
  };
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision,
    runId,
    sessionEnrichments: [{
      enrichment: {
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], openQuestions: [] },
          decisions: ["Publish only after enrichment is current."],
          evidenceRefs: [evidenceRef],
          keyWork: ["Applied grounded durable enrichment before dossier rendering."],
          outcome: "Published an enriched canonical dossier atomically.",
          verification: {
            commands: [],
            evidenceRefs: [evidenceRef],
            failures: [],
            status: "unknown",
            summary: "Canonical message evidence supports the enrichment."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "low",
          evidenceRefs: [evidenceRef],
          state: "completed",
          text: "Agent-enriched summary grounded in the selected canonical evidence."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "low",
          evidenceRefs: [evidenceRef],
          text: "Agent-enriched title"
        },
        version: "session-capsule-v4"
      },
      sessionId
    }]
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

afterAll(async () => {
  await Promise.all(suiteTempDirs.map((path) => rm(path, { force: true, recursive: true })));
  suiteTempDirs.length = 0;
});

describe("mastheadctl daemon-owned Workbench authoring", () => {
  test("gets advisory suggestions and opens a multi-session V3 selection", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedDurableArtifactCorpus(daemon.database);
    const env = { MASTHEAD_DAEMON_URL: baseUrl };
    const databaseId = getOrCreateDatabaseIdentity(daemon.database);
    const sessionIds = ["session:oauth-fixed", "session:migration-fixed"];
    const normalizedSessionIds = [...sessionIds].sort();

    const suggested = await runMastheadCli([
      "workbench", "suggestions",
      "--session", sessionIds[0]!,
      "--session", sessionIds[1]!,
      "--json"
    ], { env });
    expect(suggested.exitCode).toBe(0);
    expect(JSON.parse(suggested.stdout).suggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ advisory: true })])
    );

    const opened = await runMastheadCli([
      "workbench", "open",
      "--database-id", databaseId,
      "--session", sessionIds[0]!,
      "--session", sessionIds[1]!,
      "--json"
    ], { env });
    expect(opened.exitCode).toBe(0);
    const openedBody = JSON.parse(opened.stdout);
    expect(openedBody.run).toMatchObject({
      contractVersion: "workbench-authoring-v3",
      sessionIds: normalizedSessionIds
    });
    expect(openedBody.run).not.toHaveProperty("candidateId");

    const context = await runMastheadCli([
      "workbench", "context", "--run", openedBody.run.runId, "--json"
    ], { env });
    expect(context.exitCode).toBe(0);
    expect(JSON.parse(context.stdout)).toMatchObject({
      ok: true,
      runId: openedBody.run.runId,
      sessions: normalizedSessionIds.map((sessionId) => ({ sessionId }))
    });
  });

  test("submits and finishes a V3 selection through the CLI", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:cli-v3",
      title: "CLI V3 lifecycle"
    });
    markSessionCompileReady(daemon.database, "session:cli-v3");
    const env = { MASTHEAD_DAEMON_URL: baseUrl };
    const opened = await runMastheadCli([
      "workbench", "open",
      "--database-id", getOrCreateDatabaseIdentity(daemon.database),
      "--session", "session:cli-v3",
      "--json"
    ], { env });
    expect(opened.exitCode).toBe(0);
    const run = JSON.parse(opened.stdout).run;
    const tempDir = await makeTempDir("masthead-cli-v3-bundle-");
    const bundlePath = join(tempDir, "bundle.json");
    await writeFile(
      bundlePath,
      JSON.stringify(validCliV3Bundle(run.runId, run.evidenceRevision, "session:cli-v3")),
      "utf8"
    );

    const submitted = await runMastheadCli([
      "workbench", "submit", "--run", run.runId, "--file", bundlePath, "--json"
    ], { env });
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      accepted: true,
      ok: true,
      run: { status: "ready_to_finish" }
    });

    const finished = await runMastheadCli([
      "workbench", "finish", "--run", run.runId, "--json"
    ], { env });
    const receipt = JSON.parse(finished.stdout).receipt;
    expect(receipt).toMatchObject({
      contractVersion: "workbench-authoring-v3",
      optionalArtifacts: [],
      resolvedSessionIds: ["session:cli-v3"],
      runId: run.runId
    });
    const retried = await runMastheadCli([
      "workbench", "finish", "--run", run.runId, "--json"
    ], { env });
    expect(JSON.parse(retried.stdout).receipt).toEqual(receipt);
  });

  test("advertises only daemon authoring commands plus explicit wipe maintenance", async () => {
    const top = await runMastheadCli(["--help"], { env: {} });
    expect(top.stdout).toContain("mastheadctl workbench");
    expect(top.stdout).toContain("workbench open");

    const result = await runMastheadCli(["workbench", "--help"], { env: {} });
    for (const command of [
      "capabilities", "suggestions", "open", "status", "context", "evidence", "submit", "finish",
      "audit-v1-generation", "prepare-v1-recovery", "invalidate-v1-generation", "restore-v1-recovery",
      "wipe-published"
    ]) {
      expect(result.stdout).toContain(`workbench ${command}`);
    }
    for (const removed of ["candidates", "--candidate", "queue", "next", "apply", "publish", "not-applicable", "batch"]) {
      expect(result.stdout).not.toContain(`workbench ${removed}`);
    }
  });

  test("uses daemon-owned commands without --db and preserves historical run reads", async () => {
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
    expect(submitted.exitCode).toBe(1);
    expect(JSON.parse(submitted.stderr)).toMatchObject({ error: { code: "authoring_contract_audit_only" } });

    const finish = await runMastheadCli(["workbench", "finish", "--run", runId, "--json"], { env });
    expect(finish.exitCode).toBe(1);
    expect(JSON.parse(finish.stderr)).toMatchObject({
      ok: false,
      error: { code: "authoring_contract_audit_only", status: 409 }
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

  test("rejects more than 12 repeated session arguments before network access", async () => {
    const repeated = Array.from({ length: 13 }, () => ["--session", "session:a"]).flat();
    const result = await runMastheadCli(
      ["workbench", "suggestions", ...repeated, "--json"],
      { env: { MASTHEAD_DAEMON_URL: "http://127.0.0.1:1" } }
    );
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "invalid_argument" } });
  });

  test.each([
    { args: ["workbench", "open", "--database-id", "--session", "session:a", "--json"], option: "--database-id" },
    { args: ["workbench", "open", "--database-id", "database", "--session", "--json"], option: "--session" },
    { args: ["workbench", "suggestions", "--session", "--json"], option: "--session" },
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
          bundleVersion: "workbench-authoring-v3",
          capability: "artifact_authoring",
          command: "mastheadctl",
          databaseId: "database",
          evidencePolicy: "selected_session_canonical_evidence",
          maxSessionsPerRun: 12,
          operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
          protocol: "masthead.workbench.authoring/v1",
          suggestionsAreBinding: false,
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
  test("keeps failed V1 recovery audit and prepare dry for the exact historical population", async () => {
    const { dbPath, tempDir } = await makeExactCliRecoveryFixture("masthead-cli-v1-audit-prepare-");

    const audited = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(audited.exitCode).toBe(0);
    const audit = JSON.parse(audited.stdout).audit as { auditHash: string; dossiers: number };
    expect(audit).toMatchObject({ dossiers: 1_283, auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });

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
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });

    const preparedAgain = await runMastheadCli(
      ["workbench", "prepare-v1-recovery", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(preparedAgain.exitCode).toBe(0);
    expect(JSON.parse(preparedAgain.stdout)).toMatchObject({
      audit: { auditHash: audit.auditHash, dossiers: 1_283 },
      backup: { integrityResult: "ok", sizeBytes: expect.any(Number) },
      ok: true
    });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1_283, runs: 66 });
  }, 120_000);

  test("requires exact recovery arguments before opening the population", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-arguments-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);

    const missingHash = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingHash.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });

    const missingConfirmation = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingConfirmation.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });

    for (const omitted of ["backup", "auditHash", "confirmation"] as const) {
      const restoreArgs = ["workbench", "restore-v1-recovery", "--db", dbPath];
      if (omitted !== "backup") restoreArgs.push("--backup", backupPath);
      if (omitted !== "auditHash") restoreArgs.push("--audit-hash", auditHash);
      if (omitted !== "confirmation") restoreArgs.push("--confirm");
      restoreArgs.push("--json");
      const refused = await runMastheadCli(restoreArgs, { env: {} });
      expect(JSON.parse(refused.stderr)).toMatchObject({ error: { code: "missing_argument" }, ok: false });
    }
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("refuses recovery paths and sidecars before auditing population rows", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-paths-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);

    await writeFile(`${dbPath}-wal`, "");
    const nonSelfContainedAudit = await runMastheadCli(
      ["workbench", "audit-v1-generation", "--db", dbPath, "--json"],
      { env: {} }
    );
    expect(nonSelfContainedAudit.exitCode).toBe(1);
    expect(JSON.parse(nonSelfContainedAudit.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "v1_recovery_audit_database_not_self_contained:wal" },
      ok: false
    });
    await rm(`${dbPath}-wal`);

    const missingPreparedBackup = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(missingPreparedBackup.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_path_invalid") },
      ok: false
    });

    await copyFile(dbPath, backupPath);
    await writeFile(`${backupPath}-wal`, "");
    const invalidationSidecar = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(invalidationSidecar.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_sidecar_present") },
      ok: false
    });
    await rm(`${backupPath}-wal`);

    const activeBytes = await readFile(dbPath);
    const backupBytes = await readFile(backupPath);
    const backupSidecars = ["-wal", "-shm", "-journal"].map((suffix) => `${backupPath}${suffix}`);
    for (const sidecarPath of backupSidecars) await writeFile(sidecarPath, "");
    const restoreSidecar = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(restoreSidecar.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_restore_backup_sidecar_present") },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(activeBytes);
    expect(await readFile(backupPath)).toEqual(backupBytes);
    for (const sidecarPath of backupSidecars) expect(await readFile(sidecarPath)).toEqual(Buffer.alloc(0));
    await Promise.all(backupSidecars.map((sidecarPath) => rm(sidecarPath)));

    const outside = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath,
        "--backup", join(tempDir, "outside.backup-current"),
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(outside.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });

    const heldBackupPath = join(tempDir, "held-backup.sqlite");
    await rename(backupPath, heldBackupPath);
    await symlink(heldBackupPath, backupPath, "file");
    const symlinked = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(symlinked.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(await readFile(dbPath)).toEqual(activeBytes);
  });

  test("refuses recovery while another database owner is active", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-ownership-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    const auditHash = "a".repeat(64);
    await copyFile(dbPath, backupPath);

    const writerLease = await acquireDatabaseWriterLock(dbPath);
    try {
      const leased = await runMastheadCli(
        [
          "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
          "--audit-hash", auditHash, "--confirm", "--json"
        ],
        { env: {} }
      );
      expect(JSON.parse(leased.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    } finally {
      await writerLease.release();
    }

    const legacyGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      const guarded = await runMastheadCli(
        ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
        { env: {} }
      );
      expect(JSON.parse(guarded.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    } finally {
      await legacyGuard.release();
    }

    const staleSentinelPath = join(tempDir, "runtime", "database.lock");
    const staleSentinel = JSON.stringify({ createdAt: "2026-07-01T00:00:00.000Z", pid: 999_999_999, token: "stale" });
    await writeFile(staleSentinelPath, staleSentinel, "utf8");
    const staleGuard = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", auditHash, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(staleGuard.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(await readFile(staleSentinelPath, "utf8")).toBe(staleSentinel);
    await rm(staleSentinelPath);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("rejects malformed invalidation hashes before auditing population rows", async () => {
    const { dbPath, tempDir } = await makeEmptyCliRecoveryFixture("masthead-cli-v1-invalidation-hash-");
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    await createNormalizedCliBackup(dbPath, backupPath);

    const refused = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", "not-sha256", "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_recovery_audit_hash_invalid" },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("refuses an altered non-exact V1 population with the smallest generation", async () => {
    const { dbPath } = await makeSmallCliRecoveryFixture("masthead-cli-v1-invalidation-population-");

    const refused = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", "a".repeat(64), "--confirm", "--json"],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_generation_not_exact:1:1283" },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a small recovery backup has another database identity", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-invalidation-identity-"
    );
    const backup = new DatabaseSync(backupPath);
    backup.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(JSON.stringify({ databaseId: "wrong-database-id" }));
    backup.close();

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_identity_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a small prepared backup population changes", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-invalidation-backup-population-"
    );
    const backup = new DatabaseSync(backupPath);
    backup.prepare(
      "UPDATE workbench_session_state SET adr_status = 'required' WHERE session_id = 'session:cli-failed:0000'"
    ).run();
    backup.close();

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_backup_audit_hash_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("refuses invalidation when a valid requested hash differs from the small audit", async () => {
    useSmallCliRecoveryAudit();
    const { dbPath } = await makeSmallCliRecoveryFixture("masthead-cli-v1-invalidation-valid-hash-");

    const refused = await runMastheadCli(
      [
        "workbench", "invalidate-v1-generation", "--db", dbPath,
        "--audit-hash", "0".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(refused.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: expect.stringContaining("database_invalidation_active_audit_hash_mismatch") },
      ok: false
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
  });

  test("invalidates the exact generation while preserving its verified backup", async () => {
    const { auditHash, backupPath, databaseId, dbPath, tempDir } = await makeExactCliRecoveryFixture(
      "masthead-cli-v1-invalidation-success-",
      { backup: true }
    );

    const invalidated = await runMastheadCli(
      ["workbench", "invalidate-v1-generation", "--db", dbPath, "--audit-hash", auditHash, "--confirm", "--json"],
      { env: {} }
    );
    expect(invalidated.exitCode).toBe(0);
    expect(JSON.parse(invalidated.stdout)).toMatchObject({
      ok: true,
      receipt: {
        artifactsInvalidated: 1_283,
        auditHash,
        recoveryBackup: {
          artifacts: 1_283,
          auditHash,
          backupPath,
          backupPreserved: true,
          databaseId,
          device: expect.stringMatching(/^\d+$/u),
          inode: expect.stringMatching(/^\d+$/u),
          integrityResult: "ok",
          runs: 66,
          sessions: 1_283,
          sizeBytes: expect.any(Number)
        },
        sessionsReset: 1_283
      }
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 66 });
    const verified = new DatabaseSync(dbPath, { readOnly: true });
    expect(verified.prepare(
      "SELECT adr_status AS adrStatus, session_dossier_status AS dossierStatus FROM workbench_session_state WHERE session_id = 'session:cli-failed:0000'"
    ).get()).toEqual({ adrStatus: "unknown", dossierStatus: "missing" });
    verified.close();
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${backupPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("refuses restore before population audit for invalid hash, missing identity, or corrupt bytes", async () => {
    const { databaseId, dbPath, tempDir } = await makeEmptyCliRecoveryFixture(
      "masthead-cli-v1-restore-verification-"
    );
    const backupPath = join(tempDir, "masthead.sqlite.backup-current");
    await createNormalizedCliBackup(dbPath, backupPath);
    const activeBytes = await readFile(dbPath);

    const invalidHash = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "not-sha256", "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(invalidHash.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "failed_v1_recovery_audit_hash_invalid" },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(activeBytes);

    const active = new DatabaseSync(dbPath);
    active.prepare("DELETE FROM app_settings WHERE setting_key = 'database_identity'").run();
    active.close();
    const missingIdentityBytes = await readFile(dbPath);
    const missingIdentity = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "a".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(missingIdentity.stderr)).toMatchObject({
      error: { code: "v1_recovery_refused", message: "database_backup_identity_missing" },
      ok: false
    });
    expect(await readFile(dbPath)).toEqual(missingIdentityBytes);

    const resetIdentity = new DatabaseSync(dbPath);
    resetIdentity.prepare(
      "INSERT INTO app_settings (setting_key, setting_json, updated_at) VALUES ('database_identity', ?, ?)"
    ).run(JSON.stringify({ databaseId }), "2026-07-19T12:00:00.000Z");
    resetIdentity.close();
    await writeFile(backupPath, "not a sqlite database", "utf8");
    const corrupt = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "a".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(corrupt.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 0 });
  });

  test("keeps active and backup bytes unchanged when restore fails before promotion", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, dbPath, tempDir } = await makeSmallCliRecoveryFixture("masthead-cli-v1-restore-rollback-");
    clearCliPublishedRecoveryState(dbPath);
    const activeBytes = await readFile(dbPath);
    const backupBytes = await readFile(backupPath);

    await expect(
      withExclusiveDatabaseMaintenance(dbPath, (ownership) =>
        restoreFailedV1RecoveryBackupInsideExclusiveMaintenance(
          dbPath,
          backupPath,
          SMALL_RECOVERY_AUDIT_HASH,
          ownership,
          {
            onBoundary(boundary) {
              if (boundary === "before_promotion") throw new Error("injected:before_promotion");
            }
          }
        )
      )
    ).rejects.toThrow("injected:before_promotion");
    expect(await readFile(dbPath)).toEqual(activeBytes);
    expect(await readFile(backupPath)).toEqual(backupBytes);
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });
    expect((await readdir(tempDir)).some((name) => name.includes("restore-stage"))).toBe(false);
  });

  test("restores a verified failed generation from the preserved sibling backup", async () => {
    useSmallCliRecoveryAudit();
    const { backupPath, databaseId, dbPath, tempDir } = await makeSmallCliRecoveryFixture(
      "masthead-cli-v1-restore-success-"
    );
    clearCliPublishedRecoveryState(dbPath);

    const backup = new DatabaseSync(backupPath);
    const originalIdentity = backup.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string };
    backup.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(JSON.stringify({ databaseId: "wrong-database-id" }));
    backup.close();
    const wrongIdentity = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongIdentity.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });

    const resetIdentity = new DatabaseSync(backupPath);
    resetIdentity.prepare(
      "UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'"
    ).run(originalIdentity.value);
    resetIdentity.close();
    const wrongHash = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", "0".repeat(64), "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(JSON.parse(wrongHash.stderr)).toMatchObject({ error: { code: "v1_recovery_refused" }, ok: false });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 0, runs: 1 });

    for (const suffix of ["-wal", "-shm", "-journal"]) await writeFile(`${dbPath}${suffix}`, "");

    const restored = await runMastheadCli(
      [
        "workbench", "restore-v1-recovery", "--db", dbPath, "--backup", backupPath,
        "--audit-hash", SMALL_RECOVERY_AUDIT_HASH, "--confirm", "--json"
      ],
      { env: {} }
    );
    expect(restored.exitCode).toBe(0);
    expect(JSON.parse(restored.stdout)).toEqual({
      databasePath: dbPath,
      ok: true,
      receipt: {
        artifactsRestored: 1,
        auditHash: SMALL_RECOVERY_AUDIT_HASH,
        backupPath,
        backupPreserved: true,
        databaseId,
        integrityResult: "ok",
        runsRestored: 1,
        sessionsRestored: 1
      }
    });
    expect(readCliRecoveryCounts(dbPath)).toEqual({ artifacts: 1, runs: 1 });
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      "masthead.sqlite.backup-current"
    ]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      await expect(access(`${dbPath}${suffix}`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

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

type ExactCliRecoveryTemplate = {
  auditHash: string;
  databaseId: string;
  databasePath: string;
};

function useSmallCliRecoveryAudit(): void {
  const realAudit = sessionArtifactRepository.auditFailedV1Generation;
  vi.spyOn(sessionArtifactRepository, "auditFailedV1Generation").mockImplementation((database) => {
    const artifacts = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM session_artifacts"
    ).get() as { count: number }).count);
    if (artifacts !== 1) return realAudit(database);
    const alteredPopulation = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM workbench_session_state WHERE adr_status = 'required'"
    ).get() as { count: number }).count) > 0;
    return {
      actorId: "failed-agent",
      adrs: 0,
      auditHash: alteredPopulation ? SMALL_ALTERED_RECOVERY_AUDIT_HASH : SMALL_RECOVERY_AUDIT_HASH,
      contractVersion: "workbench-authoring-v1",
      counts: {
        byKind: { session_dossier: 1 },
        byRun: { "run:cli-failed-v1:000": 1 },
        bySession: { "session:cli-failed:0000": 1 },
        byStatus: { "current/published": 1 }
      },
      createdBy: ["workbench_authoring:failed-agent"],
      dossiers: 1,
      generationFingerprint: "small-recovery-generation",
      generationWindow: { from: "2026-07-11T08:00:00.000Z", to: "2026-07-11T09:00:00.000Z" },
      incidentTimelines: 0,
      publicationWindow: { from: "2026-07-11T08:30:00.000Z", to: "2026-07-11T08:30:00.000Z" },
      runbooks: 0,
      schemaVersions: ["session_dossier-v2"],
      templateFingerprint: "small-recovery-template",
      totalArtifacts: 1,
      totalRuns: 1,
      totalSessions: 1
    };
  });
}

async function exactCliRecoveryTemplate(): Promise<ExactCliRecoveryTemplate> {
  exactCliRecoveryTemplatePromise ??= (async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-v1-template-"));
    suiteTempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const database = await openMastheadDatabase(databasePath);
    migrateDatabase(database);
    const databaseId = getOrCreateDatabaseIdentity(database);
    seedCliFailedV1Generation(database);
    const auditHash = sessionArtifactRepository.auditFailedV1Generation(database).auditHash;
    database.close();
    return { auditHash, databaseId, databasePath };
  })();
  return exactCliRecoveryTemplatePromise;
}

async function makeExactCliRecoveryFixture(
  prefix: string,
  options: { backup?: boolean } = {}
): Promise<{
  auditHash: string;
  backupPath: string;
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const template = await exactCliRecoveryTemplate();
  const tempDir = await makeTempDir(prefix);
  const dbPath = join(tempDir, "masthead.sqlite");
  const backupPath = join(tempDir, "masthead.sqlite.backup-current");
  await copyFile(template.databasePath, dbPath);
  if (options.backup) await createNormalizedCliBackup(dbPath, backupPath);
  return {
    auditHash: template.auditHash,
    backupPath,
    databaseId: template.databaseId,
    dbPath,
    tempDir
  };
}

async function makeEmptyCliRecoveryFixture(prefix: string): Promise<{
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const tempDir = await makeTempDir(prefix);
  const dbPath = join(tempDir, "masthead.sqlite");
  const database = await openMastheadDatabase(dbPath);
  migrateDatabase(database);
  const databaseId = getOrCreateDatabaseIdentity(database);
  database.close();
  return { databaseId, dbPath, tempDir };
}

async function makeSmallCliRecoveryFixture(prefix: string): Promise<{
  backupPath: string;
  databaseId: string;
  dbPath: string;
  tempDir: string;
}> {
  const { databaseId, dbPath, tempDir } = await makeEmptyCliRecoveryFixture(prefix);
  const database = await openMastheadDatabase(dbPath);
  seedCliFailedV1Generation(database, { dossierCount: 1 });
  database.close();
  const backupPath = join(tempDir, "masthead.sqlite.backup-current");
  await createNormalizedCliBackup(dbPath, backupPath);
  return { backupPath, databaseId, dbPath, tempDir };
}

async function createNormalizedCliBackup(databasePath: string, backupPath: string): Promise<void> {
  await copyFile(databasePath, backupPath);
  const backup = new DatabaseSync(backupPath);
  try {
    backup.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    backup.close();
  }
}

function clearCliPublishedRecoveryState(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM session_artifact_search;
      DELETE FROM session_artifact_provenance;
      DELETE FROM session_artifacts;
      UPDATE workbench_session_state
      SET publication_status = 'publish_path',
          next_action = 'create_dossier',
          session_dossier_status = 'missing',
          published_at = NULL;
      PRAGMA foreign_keys = ON;
    `);
  } finally {
    database.close();
  }
}

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
  options: { dossierCount?: number; schema21?: boolean } = {}
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
  for (let index = 0; index < (options.dossierCount ?? 1_283); index += 1) {
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
