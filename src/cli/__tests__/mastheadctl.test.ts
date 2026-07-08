import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { runMastheadCli } from "../mastheadctl.ts";
import { resolveWorkbenchDatabasePath } from "../dbPath.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { listSessionArtifacts } from "../../daemon/db/sessionArtifactRepository.ts";
import {
  ensureWorkbenchSessionState,
  markWorkbenchNotAdded,
  markWorkbenchArtifactSatisfied,
  markWorkbenchPublished,
  markWorkbenchSessionEnrichmentSatisfied,
  readWorkbenchSessionState
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { setSourcePolicy } from "../../daemon/db/sourcePolicyRepository.ts";

const execFileAsync = promisify(execFile);

describe("mastheadctl workbench CLI foundation", () => {
  test("prints top-level help", async () => {
    const result = await runMastheadCli(["--help"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mastheadctl workbench");
    expect(result.stdout).toContain("status");
    expect(result.stderr).toBe("");
  });

  test("prints workbench help", async () => {
    const result = await runMastheadCli(["workbench", "--help"], { env: {} });

    expect(result.exitCode).toBe(0);
    for (const command of [
      "mastheadctl workbench queue --kind <kind> --scope <scope> --json",
      "mastheadctl workbench next --kind <kind> --scope <scope> --json",
      "mastheadctl workbench instructions --kind <kind> --scope <scope>",
      "mastheadctl workbench schema <kind> --json",
      "mastheadctl workbench evidence --kind <kind> --session <id> --json",
      "mastheadctl workbench validate --kind <kind> --session <id> --file <file> --json",
      "mastheadctl workbench apply --kind <kind> --session <id> --file <file> --json"
    ]) {
      expect(result.stdout).toContain(command);
    }
    expect(result.stdout).toContain("Agent loop:");
    expect(result.stdout).toContain("Use next for a complete packet, write schema JSON, validate with --session, then apply.");
    expect(result.stderr).toBe("");
  });

  test("reports status as JSON with the resolved database path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-status-"));
    const dbPath = join(tempDir, "masthead.sqlite");
    const result = await runMastheadCli(["workbench", "status", "--json"], {
      env: { MASTHEAD_DB_PATH: dbPath }
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      command: "workbench status",
      databasePath: dbPath,
      queue: { notAdded: 0, publishPath: 0, published: 0 },
      activeClaims: 0
    });
    expect(result.stderr).toBe("");
    await rm(tempDir, { force: true, recursive: true });
  });

  test("prints resolved db path", async () => {
    const result = await runMastheadCli(["workbench", "db-path"], {
      env: { MASTHEAD_DATA_DIR: "/tmp/masthead-data" }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("/tmp/masthead-data/masthead.sqlite\n");
    expect(result.stderr).toBe("");
  });

  test("fails unknown commands with a machine-readable error", async () => {
    const result = await runMastheadCli(["workbench", "bogus", "--json"], { env: {} });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      error: {
        code: "unknown_command",
        message: "Unknown workbench command: bogus"
      }
    });
    expect(result.stdout).toBe("");
  });

  test("prints a Workbench schema as JSON", async () => {
    const result = await runMastheadCli(["workbench", "schema", "session_enrichment", "--json"], { env: {} });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      additionalProperties: false,
      title: "SessionEnrichmentOutput"
    });
    expect(result.stderr).toBe("");
  });

  test("prints agent instructions for every Workbench output kind", async () => {
    const expectedRules = {
      bug_fix_trace: "Field rules for bug_fix_trace",
      session_dossier: "Field rules for session_dossier",
      session_enrichment: "Field rules for session_enrichment"
    };

    for (const [kind, fieldRule] of Object.entries(expectedRules)) {
      const result = await runMastheadCli(["workbench", "instructions", "--kind", kind, "--scope", "missing"], { env: {} });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Agent guidance contract");
      expect(result.stdout).toContain(fieldRule);
      expect(result.stderr).toBe("");
    }
  });

  test("validates a Workbench output file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-"));
    try {
      const outputPath = join(tempDir, "enrichment.json");
      await writeFile(
        outputPath,
        JSON.stringify({
          confidence: "medium",
          evidenceRefs: ["message:1"],
          missingEvidence: [],
          searchPhrases: ["workbench cli"],
          summary: "Added Workbench CLI validation.",
          technologies: ["TypeScript"],
          title: "Add Workbench validation",
          topics: ["Workbench"]
        }),
        "utf8"
      );

      const result = await runMastheadCli(["workbench", "validate", "--kind", "session_enrichment", "--file", outputPath, "--json"], { env: {} });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, errors: [], warnings: [] });
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("validates evidence refs against a session evidence packet when --session is provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-validate-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Workbench validation" });
      db.close();

      const outputPath = join(tempDir, "enrichment.json");
      await writeFile(
        outputPath,
        JSON.stringify({
          confidence: "medium",
          evidenceRefs: ["missing:1"],
          missingEvidence: [],
          searchPhrases: ["workbench cli"],
          summary: "Added Workbench CLI validation.",
          technologies: ["TypeScript"],
          title: "Add Workbench validation",
          topics: ["Workbench"]
        }),
        "utf8"
      );

      const result = await runMastheadCli(
        ["workbench", "validate", "--kind", "session_enrichment", "--session", "session:abc", "--file", outputPath, "--db", dbPath, "--json"],
        { env: {} }
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        errors: [{ code: "unknown_evidence_ref", message: "Evidence ref is not present in the packet: missing:1" }],
        ok: false,
        warnings: []
      });
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("runs through a package-bin symlink", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-bin-"));
    try {
      const binPath = join(tempDir, "mastheadctl");
      await symlink(join(process.cwd(), "dist/daemon/src/cli/mastheadctl.js"), binPath);

      const { stdout, stderr } = await execFileAsync(process.execPath, [binPath, "workbench", "status", "--json"], {
        env: { ...process.env, MASTHEAD_DB_PATH: "/tmp/symlink.sqlite" }
      });

      expect(JSON.parse(stdout)).toEqual({
        ok: true,
        command: "workbench status",
        databasePath: "/tmp/symlink.sqlite",
        queue: { notAdded: 0, publishPath: 0, published: 0 },
        activeClaims: 0
      });
      expect(stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("applies session enrichment through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-apply-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Old title" });
      db.close();

      const outputPath = join(tempDir, "enrichment.json");
      await writeFile(
        outputPath,
        JSON.stringify({
          confidence: "medium",
          evidenceRefs: ["message:session:abc:message"],
          missingEvidence: [],
          searchPhrases: ["workbench cli apply"],
          summary: "Applied Workbench session enrichment.",
          technologies: ["TypeScript"],
          title: "Apply Workbench enrichment",
          topics: ["Workbench"]
        }),
        "utf8"
      );

      const result = await runMastheadCli(
        ["workbench", "apply", "--kind", "session_enrichment", "--session", "session:abc", "--file", outputPath, "--db", dbPath, "--json"],
        { env: {} }
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: false, ok: true });
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("applies and lists session dossier artifacts through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-artifact-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });
      db.close();

      const outputPath = join(tempDir, "dossier.json");
      await writeFile(
        outputPath,
        JSON.stringify({
          approach: ["Added local artifact persistence"],
          commandsAndTools: [{ label: "npm test", status: "passed" }],
          confidence: "medium",
          context: "Workbench artifacts",
          evidenceRefs: ["message:session:abc:message"],
          filesTouched: [{ label: "src/daemon/db/sessionArtifactRepository.ts", role: "repository" }],
          keyDecisions: ["Keep artifacts out of MCP read APIs for V1"],
          lessonsLearned: [],
          missingEvidence: [],
          outcome: "Workbench artifacts persist locally.",
          problemStatement: "Need durable local artifact output.",
          risksOrGaps: [],
          title: "Persist Workbench dossier",
          verification: ["npm test"]
        }),
        "utf8"
      );

      const applyResult = await runMastheadCli(
        ["workbench", "apply", "--kind", "session_dossier", "--session", "session:abc", "--file", outputPath, "--db", dbPath, "--json"],
        { env: {} }
      );

      expect(applyResult.exitCode).toBe(0);
      expect(JSON.parse(applyResult.stdout)).toMatchObject({ artifactKind: "session_dossier", dryRun: false, ok: true });

      const afterApply = await openMastheadDatabase(dbPath);
      expect(listSessionArtifacts(afterApply, { sessionId: "session:abc" })).toEqual([
        expect.objectContaining({ artifactKind: "session_dossier", status: "current", title: "Persist Workbench dossier" })
      ]);
      afterApply.close();

      const listResult = await runMastheadCli(["workbench", "artifacts", "--session", "session:abc", "--db", dbPath, "--json"], { env: {} });

      expect(listResult.exitCode).toBe(0);
      expect(JSON.parse(listResult.stdout)).toMatchObject({
        ok: true,
        artifacts: [expect.objectContaining({ artifactKind: "session_dossier", title: "Persist Workbench dossier" })]
      });
      expect(listResult.stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("publishes a ready Workbench session through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-publish-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Publish CLI session" });
      db.close();

      const blocked = await runMastheadCli(["workbench", "publish", "--session", "session:abc", "--db", dbPath, "--json"], { env: {} });
      expect(blocked.exitCode).toBe(1);
      expect(JSON.parse(blocked.stdout)).toMatchObject({
        ok: false,
        code: "publication_gate_failed",
        missing: ["transcript", "quality", "session_enrichment", "session_dossier", "bug_fix_trace"]
      });

      const readyDb = await openMastheadDatabase(dbPath);
      ensureWorkbenchSessionState(readyDb, "session:abc");
      readyDb
        .prepare("UPDATE workbench_session_state SET transcript_status = 'imported', quality_status = 'passed' WHERE session_id = ?")
        .run("session:abc");
      markWorkbenchSessionEnrichmentSatisfied(readyDb, { actor: { kind: "agent", id: "codex" }, sessionId: "session:abc" });
      markWorkbenchArtifactSatisfied(readyDb, { actor: { kind: "agent", id: "codex" }, artifactKind: "session_dossier", sessionId: "session:abc" });
      markWorkbenchArtifactSatisfied(readyDb, { actor: { kind: "agent", id: "codex" }, artifactKind: "bug_fix_trace", sessionId: "session:abc" });
      readyDb.close();

      const published = await runMastheadCli(["workbench", "publish", "--session", "session:abc", "--db", dbPath, "--json"], { env: {} });
      expect(published.exitCode).toBe(0);
      expect(JSON.parse(published.stdout)).toMatchObject({
        ok: true,
        state: { publicationStatus: "published", sessionId: "session:abc" }
      });

      const afterDb = await openMastheadDatabase(dbPath);
      expect(readWorkbenchSessionState(afterDb, "session:abc")?.publicationStatus).toBe("published");
      afterDb.close();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("marks Workbench quality pass and fail through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-quality-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:pass", title: "Quality pass CLI" });
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:fail", title: "Quality fail CLI" });
      ensureWorkbenchSessionState(db, "session:pass");
      ensureWorkbenchSessionState(db, "session:fail");
      db.prepare(
        `UPDATE workbench_session_state
        SET transcript_status = 'imported', quality_status = 'unchecked', next_action = 'review_quality'
        WHERE session_id = ?`
      ).run("session:pass");
      db.close();

      const passed = await runMastheadCli(
        ["workbench", "quality", "pass", "--session", "session:pass", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(passed.exitCode).toBe(0);
      expect(JSON.parse(passed.stdout)).toMatchObject({
        activity: { eventType: "quality_passed" },
        state: { qualityStatus: "passed", nextAction: "enrich", sessionId: "session:pass" }
      });

      const failed = await runMastheadCli(
        ["workbench", "quality", "fail", "--session", "session:fail", "--reason", "hook_only_noise", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(failed.exitCode).toBe(0);
      expect(JSON.parse(failed.stdout)).toMatchObject({
        activity: { eventType: "quality_failed" },
        state: {
          qualityStatus: "failed",
          publicationStatus: "not_added_to_logbook",
          nonPublicationReason: "hook_only_noise",
          sessionId: "session:fail"
        }
      });

      const recovered = await runMastheadCli(
        ["workbench", "quality", "pass", "--session", "session:fail", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(recovered.exitCode).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        activity: { eventType: "quality_passed" },
        state: {
          qualityStatus: "passed",
          publicationStatus: "publish_path",
          sessionId: "session:fail"
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("refuses quality fail on published sessions through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-quality-published-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: "session:published",
        title: "Published quality guard"
      });
      ensureWorkbenchSessionState(db, "session:published");
      db.prepare(
        `UPDATE workbench_session_state
        SET transcript_status = 'imported',
            quality_status = 'passed',
            session_enrichment_status = 'satisfied',
            session_dossier_status = 'satisfied',
            bug_fix_trace_status = 'satisfied'
        WHERE session_id = ?`
      ).run("session:published");
      markWorkbenchPublished(db, {
        actor: { kind: "agent", id: "codex" },
        publishedVia: "workbench_publish",
        sessionId: "session:published"
      });
      db.close();

      const refused = await runMastheadCli(
        [
          "workbench",
          "quality",
          "fail",
          "--session",
          "session:published",
          "--reason",
          "late_reject",
          "--db",
          dbPath,
          "--json"
        ],
        { env: {} }
      );
      expect(refused.exitCode).toBe(1);
      expect(JSON.parse(refused.stderr)).toMatchObject({
        ok: false,
        error: {
          code: "invalid_state",
          message: "cannot_fail_quality_on_published_session"
        }
      });

      const afterDb = await openMastheadDatabase(dbPath);
      expect(readWorkbenchSessionState(afterDb, "session:published")?.publicationStatus).toBe("published");
      afterDb.close();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("runs capture quality precheck and applies the result through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-quality-precheck-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:good", title: "Precheck pass" });
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:empty", title: "Precheck fail" });
      db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:empty");
      db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session:empty");
      db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session:empty");
      db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:empty");
      db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run("session:empty");
      db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:empty");
      ensureWorkbenchSessionState(db, "session:good");
      ensureWorkbenchSessionState(db, "session:empty");
      db.prepare(
        `UPDATE workbench_session_state
        SET transcript_status = 'imported', quality_status = 'unchecked', next_action = 'review_quality'
        WHERE session_id IN (?, ?)`
      ).run("session:good", "session:empty");
      db.close();

      const good = await runMastheadCli(
        ["workbench", "quality", "precheck", "--session", "session:good", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(good.exitCode).toBe(0);
      expect(JSON.parse(good.stdout)).toMatchObject({
        ok: true,
        precheck: { ok: true, sessionId: "session:good" },
        activity: { eventType: "quality_passed" },
        state: { qualityStatus: "passed", nextAction: "enrich", sessionId: "session:good" }
      });

      const empty = await runMastheadCli(
        ["workbench", "quality", "precheck", "--session", "session:empty", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(empty.exitCode).toBe(1);
      expect(JSON.parse(empty.stdout)).toMatchObject({
        ok: false,
        precheck: { ok: false, reason: "metadata_only", sessionId: "session:empty" },
        activity: { eventType: "quality_failed" },
        state: {
          qualityStatus: "failed",
          publicationStatus: "not_added_to_logbook",
          nonPublicationReason: "metadata_only",
          sessionId: "session:empty"
        }
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("default queue and next exclude Not Added sessions while explicit commands can inspect them", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-not-added-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:queue", title: "Queue session" });
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:not-added", title: "Not Added session" });
      ensureWorkbenchSessionState(db, "session:queue");
      markWorkbenchNotAdded(db, {
        actor: { kind: "system", id: "quality" },
        reason: "metadata_only",
        sessionId: "session:not-added"
      });
      db.close();

      const queue = await runMastheadCli(["workbench", "queue", "--kind", "session_enrichment", "--db", dbPath, "--json"], { env: {} });
      const next = await runMastheadCli(["workbench", "next", "--kind", "session_enrichment", "--db", dbPath, "--json"], { env: {} });
      expect(queue.stdout).toContain("session:queue");
      expect(queue.stdout).not.toContain("session:not-added");
      expect(next.stdout).toContain("session:queue");
      expect(next.stdout).not.toContain("session:not-added");

      const summary = await runMastheadCli(["workbench", "not-added", "summary", "--db", dbPath, "--json"], { env: {} });
      expect(JSON.parse(summary.stdout)).toEqual({
        ok: true,
        total: 1,
        reasons: [{ count: 1, reason: "metadata_only" }]
      });
      expect(summary.stdout).not.toContain("session:not-added");

      const list = await runMastheadCli(["workbench", "not-added", "list", "--db", dbPath, "--json"], { env: {} });
      expect(list.stdout).toContain("session:not-added");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("runs Workbench transcript commands with source-scoped permission", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-transcript-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Transcript CLI session" });
      seedCliSessionSource(db, "session:abc", "source:cli");
      seedCliIngestSource(db, "source:other");
      db.close();

      const check = await runMastheadCli(["workbench", "transcript", "check", "--session", "session:abc", "--db", dbPath, "--json"], { env: {} });
      expect(JSON.parse(check.stdout)).toMatchObject({ ok: true, sessionId: "session:abc", transcriptStatus: "imported" });

      const denied = await runMastheadCli(
        ["workbench", "transcript", "preview", "--session", "session:abc", "--source", "source:cli", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(denied.exitCode).toBe(1);
      expect(JSON.parse(denied.stdout)).toMatchObject({ ok: false, code: "transcript_permission_required" });

      const allowedDb = await openMastheadDatabase(dbPath);
      setSourcePolicy(allowedDb, {
        decidedAt: "2026-07-08T12:00:00.000Z",
        enabled: true,
        policyKind: "transcript_import",
        sourceId: "source:cli"
      });
      setSourcePolicy(allowedDb, {
        decidedAt: "2026-07-08T12:00:00.000Z",
        enabled: true,
        policyKind: "transcript_import",
        sourceId: "source:other"
      });
      allowedDb.close();

      const unrelated = await runMastheadCli(
        ["workbench", "transcript", "preview", "--session", "session:abc", "--source", "source:other", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(unrelated.exitCode).toBe(1);
      expect(JSON.parse(unrelated.stdout)).toMatchObject({ ok: false, code: "source_not_linked", sourceId: "source:other" });

      const imported = await runMastheadCli(
        ["workbench", "transcript", "import", "--session", "session:abc", "--source", "source:cli", "--db", dbPath, "--json"],
        { env: {} }
      );
      expect(imported.exitCode).toBe(0);
      expect(JSON.parse(imported.stdout)).toMatchObject({
        ok: true,
        sessionId: "session:abc",
        sourceId: "source:cli",
        transcriptStatus: "available"
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("prepares and applies a Workbench batch through the CLI", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cli-batch-"));
    try {
      const dbPath = join(tempDir, "masthead.sqlite");
      const batchDir = join(tempDir, "batch-001");
      const db = await openMastheadDatabase(dbPath);
      migrateDatabase(db);
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Batch CLI session" });
      ensureWorkbenchSessionState(db, "session:abc");
      db.close();

      const prepareResult = await runMastheadCli(
        ["workbench", "batch", "prepare", "--kind", "session_enrichment", "--scope", "missing", "--limit", "1", "--out", batchDir, "--db", dbPath, "--json"],
        { env: {} }
      );

      expect(prepareResult.exitCode).toBe(0);
      expect(JSON.parse(prepareResult.stdout)).toMatchObject({ batchDir, ok: true });
      expect(await readFile(join(batchDir, "session-001", "instructions.md"), "utf8")).toContain("Agent guidance contract");

      await writeFile(
        join(batchDir, "session-001", "output.json"),
        JSON.stringify({
          confidence: "medium",
          evidenceRefs: ["message:session:abc:message"],
          missingEvidence: [],
          searchPhrases: ["cli batch apply"],
          summary: "Applied a Workbench batch through the CLI.",
          technologies: ["TypeScript"],
          title: "Apply CLI batch",
          topics: ["Workbench"]
        }),
        "utf8"
      );

      const applyResult = await runMastheadCli(["workbench", "batch", "apply", batchDir, "--db", dbPath, "--json"], { env: {} });

      expect(applyResult.exitCode).toBe(0);
      expect(JSON.parse(applyResult.stdout)).toMatchObject({ applied: 1, failed: 0, ok: true });
      expect(applyResult.stderr).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("returns a structured error for invalid queue scope", async () => {
    const result = await runMastheadCli(["workbench", "queue", "--kind", "session_enrichment", "--scope", "team:alpha", "--json"], { env: {} });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      error: {
        code: "invalid_scope",
        message: "invalid_scope: team:alpha"
      }
    });
  });
});

describe("resolveWorkbenchDatabasePath", () => {
  test("prefers --db over environment paths", () => {
    expect(
      resolveWorkbenchDatabasePath({
        args: ["--db", "/tmp/explicit.sqlite"],
        env: {
          MASTHEAD_DB_PATH: "/tmp/env.sqlite",
          MASTHEAD_DATA_DIR: "/tmp/data"
        }
      })
    ).toBe("/tmp/explicit.sqlite");
  });

  test("prefers MASTHEAD_DB_PATH over MASTHEAD_DATA_DIR", () => {
    expect(
      resolveWorkbenchDatabasePath({
        args: [],
        env: {
          MASTHEAD_DB_PATH: "/tmp/env.sqlite",
          MASTHEAD_DATA_DIR: "/tmp/data"
        }
      })
    ).toBe("/tmp/env.sqlite");
  });

  test("derives database path from MASTHEAD_DATA_DIR", () => {
    expect(resolveWorkbenchDatabasePath({ args: [], env: { MASTHEAD_DATA_DIR: "/tmp/data" } })).toBe("/tmp/data/masthead.sqlite");
  });
});

function seedCliSessionSource(db: Awaited<ReturnType<typeof openMastheadDatabase>>, sessionId: string, sourceId: string): void {
  seedCliIngestSource(db, sourceId);
  const now = "2026-07-08T12:00:00.000Z";
  db.prepare(
    `INSERT INTO session_sources (session_id, source_id, first_seen_at, last_seen_at, imported_record_count)
    VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, sourceId, now, now, 1);
}

function seedCliIngestSource(db: Awaited<ReturnType<typeof openMastheadDatabase>>, sourceId: string): void {
  const now = "2026-07-08T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "codex", "jsonl", `/tmp/${sourceId}.jsonl`, "authoritative", now, now);
}
