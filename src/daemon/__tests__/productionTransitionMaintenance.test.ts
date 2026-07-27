import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { CURRENT_SCHEMA_VERSION, getOrCreateDatabaseIdentity, migrateDatabase } from "../db/schema.ts";
import { initializeSessionTranscriptFingerprintIndex } from "../db/sessionTranscriptFingerprintIndex.ts";
import {
  cancelProductionTransition,
  preflightProductionTransition,
  prepareProductionTransition,
  productionTransitionJournalPath,
  restoreProductionTransition,
  type ProductionBundleIdentity
} from "../productionTransitionMaintenance.ts";

const cleanup: string[] = [];
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function fixture(throughVersion = 23) {
  const root = await mkdtemp(join(tmpdir(), "masthead-production-transition-"));
  cleanup.push(root);
  const databasePath = join(root, "masthead.sqlite");
  const database = new DatabaseSync(databasePath);
  if (throughVersion === 23) {
    migrateDatabase(database);
  } else {
    database.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    for (const filename of readdirSync(migrationsDirectory).filter((name) => /^\d{3}_.+\.sql$/u.test(name)).sort()) {
      const version = Number(filename.slice(0, 3));
      if (version > throughVersion) break;
      database.exec(readFileSync(join(migrationsDirectory, filename), "utf8"));
      database.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(version, filename.slice(0, -4), "2026-07-13T12:00:00.000Z");
    }
  }
  const databaseId = getOrCreateDatabaseIdentity(database);
  database.prepare(
    "INSERT INTO app_settings(setting_key, setting_json, updated_at) VALUES (?, ?, ?)"
  ).run("transition_marker", JSON.stringify({ value: "before" }), "2026-07-13T12:00:00.000Z");
  database.close();
  const oldBundle = bundle(join(root, "Masthead-linux-x64-old"), "a", "0.1.0");
  const newBundle = bundle(join(root, "Masthead-linux-x64-new"), "b", "0.2.0");
  return { databaseId, databasePath, newBundle, oldBundle, root };
}

function bundle(target: string, character: string, version: string): ProductionBundleIdentity {
  return { bundleDigest: character.repeat(64), gitSha: character.repeat(40), target, version };
}

function seedSessionWithoutFingerprint(databasePath: string, suffix: string): void {
  const database = new DatabaseSync(databasePath);
  const at = "2026-07-13T12:00:00.000Z";
  database.prepare(
    "INSERT OR IGNORE INTO hosts(host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)"
  ).run("host:test", "test", at, at);
  database.prepare(
    "INSERT OR IGNORE INTO runtimes(runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run("runtime:test", "codex", "test", at, at);
  database.prepare(
    `INSERT INTO sessions(
      session_id, host_id, runtime_id, source_session_id, title, last_activity_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`session:${suffix}`, "host:test", "runtime:test", `source:${suffix}`, "Transition preflight", at, "authoritative", at, at);
  database.prepare(
    `INSERT INTO messages(
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`message:${suffix}`, `session:${suffix}`, "user", `message ${suffix}`, `hash:${suffix}`, at, "{}", "authoritative");
  database.close();
}

function seedLargeFileEffectTranscript(databasePath: string, suffix: string, rows: number): void {
  const database = new DatabaseSync(databasePath);
  database.prepare(
    `WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < ?
    )
    INSERT INTO file_effects(
      file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json
    )
    SELECT
      ? || value, ?, '/tmp/large-' || value, 'modified', 0, value, 0,
      '2026-07-13T12:00:00.000Z', '{}'
    FROM sequence`
  ).run(rows, `effect:${suffix}:`, `session:${suffix}`);
  database.close();
}

describe("offline production transition maintenance", () => {
  test("completes pre-listen startup indexes during prepare and receipt-bound preflight", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture(21);
    const input = {
      databasePath,
      newBundle,
      nonce: "10101010-1010-4010-8010-101010101010",
      oldBundle
    };
    seedSessionWithoutFingerprint(databasePath, "before-prepare");
    seedLargeFileEffectTranscript(databasePath, "before-prepare", 15_001);

    await prepareProductionTransition(input);
    const prepared = new DatabaseSync(databasePath, { readOnly: true });
    expect(prepared.prepare(
      "SELECT COUNT(*) AS count FROM file_effects WHERE session_id = ?"
    ).get("session:before-prepare")).toEqual({ count: 15_001 });
    expect(prepared.prepare(
      "SELECT fingerprint FROM session_transcript_fingerprints WHERE session_id = ?"
    ).get("session:before-prepare")).toEqual({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    const daemonBudgetStartedAt = Date.now();
    expect(initializeSessionTranscriptFingerprintIndex(prepared)).toEqual({ batches: 0, fingerprintsPopulated: 0 });
    expect(Date.now() - daemonBudgetStartedAt).toBeLessThan(5_000);
    prepared.close();

    seedSessionWithoutFingerprint(databasePath, "before-preflight");
    await expect(preflightProductionTransition({
      ...input,
      newBundle: { ...newBundle, bundleDigest: "c".repeat(64) }
    })).rejects.toThrow("transition_receipt_mismatch");
    await expect(preflightProductionTransition(input)).resolves.toMatchObject({
      databaseId: expect.any(String),
      fingerprintsPopulated: 1,
      state: "ready_to_activate"
    });
    await expect(preflightProductionTransition(input)).resolves.toMatchObject({
      fingerprintsPopulated: 0,
      state: "ready_to_activate"
    });
    const preflighted = new DatabaseSync(databasePath, { readOnly: true });
    expect(preflighted.prepare(
      "SELECT fingerprint FROM session_transcript_fingerprints WHERE session_id = ?"
    ).get("session:before-preflight")).toEqual({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    preflighted.close();
  });

  test("creates one WAL-complete snapshot and a nonce-bound ready receipt after migration validation", async () => {
    const { databaseId, databasePath, newBundle, oldBundle, root } = await fixture(21);
    const abandonedStage = join(root, ".masthead.sqlite.migration-backup-stage-abandoned");
    const abandonedRecoveryStage = join(root, ".masthead.sqlite.recovery-stage-abandoned");
    await writeFile(abandonedStage, "abandoned stage from an interrupted maintenance run");
    await writeFile(abandonedRecoveryStage, "abandoned snapshot stage from an interrupted maintenance child");
    const fullIntegrityChecks: string[] = [];
    const receipt = await prepareProductionTransition({
      databasePath, newBundle, nonce: "11111111-1111-4111-8111-111111111111", oldBundle
    }, {
      onFullIntegrityCheck: (path) => fullIntegrityChecks.push(path)
    });

    expect(receipt).toMatchObject({
      databaseId,
      newBundle,
      nonce: "11111111-1111-4111-8111-111111111111",
      oldBundle,
      state: "ready_to_activate"
    });
    expect(receipt).toMatchObject({ sourceSchemaVersion: 21, targetSchemaVersion: CURRENT_SCHEMA_VERSION });
    expect(receipt.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8"))).toEqual(receipt);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(root)).filter((name) => name.startsWith("masthead.sqlite.backup-")))
      .toEqual(["masthead.sqlite.backup-current"]);
    expect((await readdir(root)).filter((name) => name.includes("transition-stage"))).toEqual([]);
    await expect(readFile(abandonedStage)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(abandonedRecoveryStage)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fullIntegrityChecks).toEqual([]);
  });

  test("resumes an interrupted prepared migration without duplicating its backup and removes abandoned large stages", async () => {
    const { databasePath, newBundle, oldBundle, root } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "12121212-1212-4212-8212-121212121212",
      oldBundle
    };
    const prepared = await prepareProductionTransition(input);
    const backupBefore = await stat(prepared.snapshot.path, { bigint: true });
    const backupBytesBefore = await readFile(prepared.snapshot.path);
    await writeFile(productionTransitionJournalPath(databasePath), `${JSON.stringify({
      ...prepared,
      state: "snapshot_ready"
    })}\n`);
    const abandonedLargeStage = join(root, ".masthead.sqlite.migration-backup-stage-11gb-equivalent");
    const abandonedRecoveryStage = join(root, ".masthead.sqlite.recovery-stage-11gb-equivalent");
    await writeFile(abandonedLargeStage, "interrupted backup stage");
    await writeFile(abandonedRecoveryStage, "interrupted migration recovery stage");

    const resumed = await prepareProductionTransition(input);

    const backupAfter = await stat(resumed.snapshot.path, { bigint: true });
    expect(resumed).toMatchObject({
      databaseId: prepared.databaseId,
      snapshot: prepared.snapshot,
      sourceSchemaVersion: 37,
      state: "ready_to_activate",
      targetSchemaVersion: CURRENT_SCHEMA_VERSION
    });
    expect(backupAfter.ino).toBe(backupBefore.ino);
    expect(await readFile(resumed.snapshot.path)).toEqual(backupBytesBefore);
    expect(readdirSync(root).filter((name) => name.startsWith("masthead.sqlite.backup-")))
      .toEqual(["masthead.sqlite.backup-current"]);
    await expect(readFile(abandonedLargeStage)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(abandonedRecoveryStage)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    "backup_copied",
    "backup_verified",
    "migration_stage_complete",
    "post_migration_verified",
    "ready_to_activate"
  ] as const)("resumes after the durable %s checkpoint without repeating that phase", async (phase) => {
    const { databasePath, newBundle, oldBundle } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "13131313-1313-4313-8313-131313131313",
      oldBundle
    };
    const firstBoundaries: string[] = [];
    await expect(prepareProductionTransition(input, {
      onBoundary: (boundary) => firstBoundaries.push(boundary),
      simulateProcessDeathAfterPhase: phase
    })).rejects.toMatchObject({ code: "simulated_production_transition_process_death" });
    expect(JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8")))
      .toMatchObject({ preparePhase: phase });

    const resumedBoundaries: string[] = [];
    await expect(prepareProductionTransition(input, {
      onBoundary: (boundary) => resumedBoundaries.push(boundary)
    })).resolves.toMatchObject({
      preparePhase: "ready_to_activate",
      sourceSchemaVersion: 37,
      state: "ready_to_activate",
      targetSchemaVersion: CURRENT_SCHEMA_VERSION
    });
    expect(resumedBoundaries).not.toContain(phase);
    if (["backup_verified", "migration_stage_complete", "post_migration_verified", "ready_to_activate"].includes(phase)) {
      expect(resumedBoundaries).not.toContain("backup_copy_started");
    }
  });

  test("resumes backup_copied without entering an unbounded full-database verification pass", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "17171717-1717-4717-8717-171717171717",
      oldBundle
    };
    const initialPageIntegrityChecks: string[] = [];
    await expect(prepareProductionTransition(input, {
      onPageIntegrityCheck: (kind, path) => initialPageIntegrityChecks.push(`${kind}:${path}`),
      simulateProcessDeathAfterPhase: "backup_copied"
    })).rejects.toMatchObject({ code: "simulated_production_transition_process_death" });
    expect(initialPageIntegrityChecks).toEqual([]);

    await expect(prepareProductionTransition(input, {
      onPageIntegrityCheck: (kind) => {
        throw new Error(`unexpected_${kind}_scan_after_backup_copied`);
      }
    })).resolves.toMatchObject({
      preparePhase: "ready_to_activate",
      state: "ready_to_activate"
    });
  });

  test("cancels backup_copied without rewriting the source database or shared backup", async () => {
    const { databaseId, databasePath, newBundle, oldBundle } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "18181818-1818-4818-8818-181818181818",
      oldBundle
    };
    const backupPath = `${databasePath}.backup-current`;
    await copyFile(databasePath, backupPath);
    const databaseBefore = await stat(databasePath, { bigint: true });
    const backupBefore = await stat(backupPath, { bigint: true });
    await expect(prepareProductionTransition(input, {
      simulateProcessDeathAfterPhase: "backup_copied"
    })).rejects.toMatchObject({ code: "simulated_production_transition_process_death" });

    await expect(cancelProductionTransition(input)).resolves.toEqual({
      cancelled: true,
      databaseId,
      databaseRestored: false,
      sourceSchemaVersion: 37,
      targetSchemaVersion: CURRENT_SCHEMA_VERSION
    });
    expect(await stat(databasePath, { bigint: true })).toMatchObject({
      dev: databaseBefore.dev,
      ino: databaseBefore.ino,
      mtimeNs: databaseBefore.mtimeNs,
      size: databaseBefore.size
    });
    expect(await stat(backupPath, { bigint: true })).toMatchObject({
      dev: backupBefore.dev,
      ino: backupBefore.ino,
      mtimeNs: backupBefore.mtimeNs,
      size: backupBefore.size
    });
    await expect(readFile(productionTransitionJournalPath(databasePath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cancels ready_to_activate by restoring the source schema while retaining backup-current", async () => {
    const { databaseId, databasePath, newBundle, oldBundle } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "19191919-1919-4919-8919-191919191919",
      oldBundle
    };
    const prepared = await prepareProductionTransition(input);
    const backupBefore = await stat(prepared.snapshot.path, { bigint: true });

    await expect(cancelProductionTransition(input)).resolves.toMatchObject({
      cancelled: true,
      databaseId,
      databaseRestored: true,
      sourceSchemaVersion: 37,
      targetSchemaVersion: CURRENT_SCHEMA_VERSION
    });
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(getOrCreateDatabaseIdentity(restored)).toBe(databaseId);
    expect(restored.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 37 });
    restored.close();
    expect(await stat(prepared.snapshot.path, { bigint: true })).toMatchObject({
      dev: backupBefore.dev,
      ino: backupBefore.ino,
      mtimeNs: backupBefore.mtimeNs,
      size: backupBefore.size
    });
    await expect(readFile(productionTransitionJournalPath(databasePath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("adopts one complete legacy recovery stage without another database copy", async () => {
    const { databasePath, newBundle, oldBundle, root } = await fixture(37);
    const legacyStage = join(root, ".masthead.sqlite.recovery-stage-legacy-complete");
    await copyFile(databasePath, legacyStage);
    const before = await stat(legacyStage, { bigint: true });
    const boundaries: string[] = [];

    const receipt = await prepareProductionTransition({
      databasePath,
      newBundle,
      nonce: "14141414-1414-4414-8414-141414141414",
      oldBundle
    }, { onBoundary: (boundary) => boundaries.push(boundary) });

    const after = await stat(receipt.snapshot.path, { bigint: true });
    expect(boundaries).not.toContain("backup_copy_started");
    expect(after.ino).toBe(before.ino);
    expect(receipt).toMatchObject({
      preparePhase: "ready_to_activate",
      state: "ready_to_activate"
    });
  });

  test("reuses an existing source-matching backup-current without another database copy", async () => {
    const { databasePath, newBundle, oldBundle, root } = await fixture(37);
    const backupPath = join(root, "masthead.sqlite.backup-current");
    await copyFile(databasePath, backupPath);
    const before = await stat(backupPath, { bigint: true });
    const boundaries: string[] = [];

    const receipt = await prepareProductionTransition({
      databasePath,
      newBundle,
      nonce: "16161616-1616-4616-8616-161616161616",
      oldBundle
    }, { onBoundary: (boundary) => boundaries.push(boundary) });

    const after = await stat(receipt.snapshot.path, { bigint: true });
    expect(boundaries).not.toContain("backup_copy_started");
    expect(after.ino).toBe(before.ino);
    expect(receipt).toMatchObject({ preparePhase: "ready_to_activate", state: "ready_to_activate" });
  });

  test.each(["wrong", "corrupt"] as const)("rejects a %s receipt-owned recovery stage before migration", async (mode) => {
    const { databasePath, newBundle, oldBundle } = await fixture(37);
    const input = {
      databasePath,
      newBundle,
      nonce: "15151515-1515-4515-8515-151515151515",
      oldBundle
    };
    await expect(prepareProductionTransition(input, {
      simulateProcessDeathAfterPhase: "backup_copied"
    })).rejects.toMatchObject({ code: "simulated_production_transition_process_death" });
    const journal = JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8"));
    if (mode === "corrupt") {
      await writeFile(journal.snapshot.stagePath, "not a sqlite database");
    } else {
      const stage = new DatabaseSync(journal.snapshot.stagePath);
      stage.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = 'database_identity'")
        .run(JSON.stringify({ databaseId: "wrong-database" }));
      stage.close();
    }

    await expect(prepareProductionTransition(input)).rejects.toThrow("transition_snapshot_receipt_mismatch");
    const active = new DatabaseSync(databasePath, { readOnly: true });
    expect(active.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 37 });
    active.close();
  });

  test("restores the exact receipt-bound snapshot and source identity before old activation", async () => {
    const { databaseId, databasePath, newBundle, oldBundle } = await fixture();
    const nonce = "22222222-2222-4222-8222-222222222222";
    await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    const changed = new DatabaseSync(databasePath);
    changed.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = ?")
      .run(JSON.stringify({ value: "after" }), "transition_marker");
    changed.close();

    const fullIntegrityChecks: string[] = [];
    const receipt = await restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
      onFullIntegrityCheck: (path) => fullIntegrityChecks.push(path)
    });
    expect(receipt).toMatchObject({ databaseId, nonce, state: "restored" });
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
      .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
    restored.close();
    expect(fullIntegrityChecks).toEqual([receipt.snapshot.path]);
  });

  test("records and restores an offline-only legacy boundary without fabricating a legacy release identity", async () => {
    const { databaseId, databasePath, newBundle, oldBundle } = await fixture(21);
    const nonce = "20202020-2020-4020-8020-202020202020";
    const receipt = await prepareProductionTransition({
      databasePath,
      legacyTarget: { device: "42", inode: "84", path: oldBundle.target },
      newBundle,
      nonce,
      rollbackMode: "offline_only"
    });

    expect(receipt).toMatchObject({
      databaseId,
      databasePath,
      legacyTarget: { device: "42", inode: "84", path: oldBundle.target },
      newBundle,
      nonce,
      rollbackMode: "offline_only",
      sourceSchemaVersion: 21,
      state: "ready_to_activate"
    });
    expect(receipt).not.toHaveProperty("oldBundle");

    await expect(restoreProductionTransition({
      databasePath,
      legacyTarget: { device: "42", inode: "84", path: oldBundle.target },
      newBundle,
      nonce,
      rollbackMode: "offline_only"
    })).resolves.toMatchObject({
      databaseId,
      legacyTarget: { device: "42", inode: "84", path: oldBundle.target },
      rollbackMode: "offline_only",
      sourceSchemaVersion: 21,
      state: "restored"
    });
  });

  test("rejects foreign-key orphans before activation and restores the clean snapshot", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture();
    await expect(prepareProductionTransition({
      databasePath,
      newBundle,
      nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      oldBundle
    }, {
      onBoundary: (boundary, database) => {
        if (boundary !== "after_migrate") return;
        database?.exec("PRAGMA foreign_keys = OFF;");
        database?.prepare(
          "INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)"
        ).run("missing-session", "missing-source", "2026-07-13T12:00:00.000Z", "2026-07-13T12:00:00.000Z");
      }
    })).rejects.toThrow("foreign_key_check");
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    restored.close();
  });

  test.each(["snapshot_ready", "restoring"] as const)(
    "idempotently recovers the durable %s crash state",
    async (state) => {
      const { databasePath, newBundle, oldBundle } = await fixture();
      const nonce = state === "snapshot_ready"
        ? "88888888-8888-4888-8888-888888888888"
        : "99999999-9999-4999-8999-999999999999";
      const receipt = await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
      const active = new DatabaseSync(databasePath);
      active.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = ?")
        .run(JSON.stringify({ value: `crashed-${state}` }), "transition_marker");
      active.close();
      await writeFile(productionTransitionJournalPath(databasePath), `${JSON.stringify({ ...receipt, state })}\n`);

      const fullIntegrityChecks: string[] = [];
      await expect(restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
        onFullIntegrityCheck: (path) => fullIntegrityChecks.push(path)
      }))
        .resolves.toMatchObject({ state: "restored" });
      expect(fullIntegrityChecks).toEqual(state === "snapshot_ready" ? [receipt.snapshot.path] : []);
      const restored = new DatabaseSync(databasePath, { readOnly: true });
      expect(restored.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
        .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
      restored.close();
    }
  );

  test("resumes a restoring receipt without repeating full snapshot integrity while preserving receipt and restore verification", async () => {
    const { databasePath, newBundle, oldBundle, root } = await fixture();
    const nonce = "12121212-1212-4212-8212-121212121212";
    const receipt = await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    const journalPath = productionTransitionJournalPath(databasePath);
    const restoringReceipt = { ...receipt, state: "restoring" as const };

    for (const snapshot of [
      { ...receipt.snapshot, path: `${receipt.snapshot.path}.replacement` },
      { ...receipt.snapshot, sizeBytes: receipt.snapshot.sizeBytes + 1 },
      { ...receipt.snapshot, sha256: "0".repeat(64) }
    ]) {
      await writeFile(journalPath, `${JSON.stringify({ ...restoringReceipt, snapshot })}\n`);
      await expect(restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }))
        .rejects.toThrow(/transition_(?:receipt|snapshot_receipt)_mismatch/u);
    }

    const active = new DatabaseSync(databasePath);
    active.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = ?")
      .run(JSON.stringify({ value: "interrupted-restore" }), "transition_marker");
    active.close();
    const stagePath = join(root, ".masthead.sqlite.production-transition-restore-stage");
    await writeFile(stagePath, "stale interrupted stage");
    await writeFile(journalPath, `${JSON.stringify(restoringReceipt)}\n`);
    const boundaries: string[] = [];
    const fullIntegrityChecks: string[] = [];

    const restoredReceipt = await restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
      onBoundary: (boundary, database) => {
        boundaries.push(boundary);
        if (boundary === "after_restore_promotion") {
          expect(database?.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
            .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
        }
      },
      onFullIntegrityCheck: (path) => fullIntegrityChecks.push(path)
    });

    expect(restoredReceipt.state).toBe("restored");
    expect(fullIntegrityChecks).toEqual([]);
    expect(boundaries).toEqual(["before_restore_promotion", "after_restore_promotion", "restored"]);
    await expect(readFile(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare("PRAGMA quick_check").all()).toEqual([{ quick_check: "ok" }]);
    expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    restored.close();
  });

  test("rolls back a partial migration failure before returning and records no trusted journal", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture(21);
    const nonce = "33333333-3333-4333-8333-333333333333";
    const fullIntegrityChecks: string[] = [];
    await expect(prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
      onFullIntegrityCheck: (path) => fullIntegrityChecks.push(path),
      onBoundary: (boundary, database) => {
        if (boundary !== "after_migrate") return;
        database?.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = ?")
          .run(JSON.stringify({ value: "partially-migrated" }), "transition_marker");
        throw new Error("injected migration validation failure");
      }
    })).rejects.toThrow("injected migration validation failure");
    const active = new DatabaseSync(databasePath, { readOnly: true });
    expect(active.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
      .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
    expect(active.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 21 });
    active.close();
    expect(fullIntegrityChecks).toHaveLength(1);
    await expect(readFile(productionTransitionJournalPath(databasePath), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a migration ledger that only looks current by maximum version", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture();
    const forged = new DatabaseSync(databasePath);
    forged.prepare("UPDATE schema_migrations SET name = ? WHERE version = 23").run("023_forged_name");
    forged.close();
    await expect(prepareProductionTransition({
      databasePath,
      newBundle,
      nonce: "77777777-7777-4777-8777-777777777777",
      oldBundle
    })).rejects.toThrow("does not exactly match");
    await expect(readFile(productionTransitionJournalPath(databasePath), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("accepts the documented historical version 12 alias during production activation", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture();
    const database = new DatabaseSync(databasePath);
    database.prepare("UPDATE schema_migrations SET name = ? WHERE version = 12")
      .run("012_session_enrichment_chunks");
    database.close();

    await expect(prepareProductionTransition({
      databasePath,
      newBundle,
      nonce: "12121212-1212-4212-8212-121212121212",
      oldBundle
    })).resolves.toMatchObject({ state: "ready_to_activate", targetSchemaVersion: CURRENT_SCHEMA_VERSION });
  });

  test("rejects forged stage state and a mismatched restore receipt without mutating the database", async () => {
    const { databasePath, newBundle, oldBundle, root } = await fixture();
    await writeFile(join(root, ".masthead.sqlite.production-transition-stage-forged"), "forged");
    await expect(prepareProductionTransition({
      databasePath, newBundle, nonce: "44444444-4444-4444-8444-444444444444", oldBundle
    })).rejects.toThrow("transition_stage_hygiene_failed");
    await rm(join(root, ".masthead.sqlite.production-transition-stage-forged"));

    const nonce = "55555555-5555-4555-8555-555555555555";
    await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    await expect(restoreProductionTransition({
      databasePath, newBundle: { ...newBundle, bundleDigest: "c".repeat(64) }, nonce, oldBundle
    })).rejects.toThrow("transition_receipt_mismatch");
    const active = new DatabaseSync(databasePath, { readOnly: true });
    expect(active.prepare("PRAGMA quick_check").all()).toEqual([{ quick_check: "ok" }]);
    active.close();
  });

  test("fails closed when restore cannot promote and leaves a restore-failed journal", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture();
    const nonce = "66666666-6666-4666-8666-666666666666";
    await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    await expect(restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
      onBoundary: (boundary) => {
        if (boundary === "before_restore_promotion") throw new Error("injected restore failure");
      }
    })).rejects.toThrow("injected restore failure");
    expect(JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8"))).toMatchObject({
      nonce,
      state: "restore_failed"
    });
  });

  test("rejects a foreign-key orphan introduced after restore promotion", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture();
    const nonce = "abababab-abab-4bab-8bab-abababababab";
    await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    await expect(restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
      onBoundary: (boundary, database) => {
        if (boundary !== "after_restore_promotion") return;
        database?.exec("PRAGMA foreign_keys = OFF;");
        database?.prepare(
          "INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)"
        ).run("missing-session", "missing-source", "2026-07-13T12:00:00.000Z", "2026-07-13T12:00:00.000Z");
      }
    })).rejects.toThrow("foreign_key_check");
    expect(JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8"))).toMatchObject({
      nonce,
      state: "restore_failed"
    });
  });
});
