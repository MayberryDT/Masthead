import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase } from "../../db/sqlite.ts";
import { getRuntimePolicy, setRuntimePolicy } from "../runtimePolicyRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("runtime policy repository", () => {
  test("stores transcript approval by coding harness runtime", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-runtime-policy-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    expect(getRuntimePolicy(db, "codex", "transcript_import")).toBe(false);

    setRuntimePolicy(db, {
      decidedAt: "2026-07-01T00:00:00.000Z",
      enabled: true,
      policyKind: "transcript_import",
      reason: "Approved from Sources import modal.",
      runtime: "codex"
    });

    expect(getRuntimePolicy(db, "codex", "transcript_import")).toBe(true);
    expect(getRuntimePolicy(db, "cursor", "transcript_import")).toBe(false);
    db.close();
  });
});
