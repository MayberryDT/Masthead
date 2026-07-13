import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../db/schema.ts";
import {
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

describe("offline production transition maintenance", () => {
  test("creates one WAL-complete snapshot and a nonce-bound ready receipt after migration validation", async () => {
    const { databaseId, databasePath, newBundle, oldBundle, root } = await fixture(21);
    const abandonedStage = join(root, ".masthead.sqlite.migration-backup-stage-abandoned");
    const abandonedRecoveryStage = join(root, ".masthead.sqlite.recovery-stage-abandoned");
    await writeFile(abandonedStage, "abandoned stage from an interrupted maintenance run");
    await writeFile(abandonedRecoveryStage, "abandoned snapshot stage from an interrupted maintenance child");
    const receipt = await prepareProductionTransition({
      databasePath, newBundle, nonce: "11111111-1111-4111-8111-111111111111", oldBundle
    });

    expect(receipt).toMatchObject({
      databaseId,
      newBundle,
      nonce: "11111111-1111-4111-8111-111111111111",
      oldBundle,
      state: "ready_to_activate"
    });
    expect(receipt).toMatchObject({ sourceSchemaVersion: 21, targetSchemaVersion: 23 });
    expect(receipt.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(await readFile(productionTransitionJournalPath(databasePath), "utf8"))).toEqual(receipt);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(root)).filter((name) => name.startsWith("masthead.sqlite.backup-")))
      .toEqual(["masthead.sqlite.backup-current"]);
    expect((await readdir(root)).filter((name) => name.includes("transition-stage"))).toEqual([]);
    await expect(readFile(abandonedStage)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(abandonedRecoveryStage)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("restores the exact receipt-bound snapshot and source identity before old activation", async () => {
    const { databaseId, databasePath, newBundle, oldBundle } = await fixture();
    const nonce = "22222222-2222-4222-8222-222222222222";
    await prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    const changed = new DatabaseSync(databasePath);
    changed.prepare("UPDATE app_settings SET setting_json = ? WHERE setting_key = ?")
      .run(JSON.stringify({ value: "after" }), "transition_marker");
    changed.close();

    const receipt = await restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle });
    expect(receipt).toMatchObject({ databaseId, nonce, state: "restored" });
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
      .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
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

      await expect(restoreProductionTransition({ databasePath, newBundle, nonce, oldBundle }))
        .resolves.toMatchObject({ state: "restored" });
      const restored = new DatabaseSync(databasePath, { readOnly: true });
      expect(restored.prepare("SELECT setting_json FROM app_settings WHERE setting_key = ?").get("transition_marker"))
        .toEqual({ setting_json: JSON.stringify({ value: "before" }) });
      restored.close();
    }
  );

  test("rolls back a partial migration failure before returning and records no trusted journal", async () => {
    const { databasePath, newBundle, oldBundle } = await fixture(21);
    const nonce = "33333333-3333-4333-8333-333333333333";
    await expect(prepareProductionTransition({ databasePath, newBundle, nonce, oldBundle }, {
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
});
