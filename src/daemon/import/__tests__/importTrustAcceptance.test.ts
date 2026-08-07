import { cp, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  replayImportTrustCorpus,
  validateImportTrustDatabasePath
} from "../../../../scripts/replay-import-trust-corpus.js";

const tempDirs: string[] = [];
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "adapters", "__fixtures__");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("isolated import trust corpus replay", () => {
  test("proves canonical runtime identity, strict scope, structured tools, and honest Workbench disposition", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);

    const report = await replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot
    });

    expect(report.productionAccessed).toBe(false);
    expect(report.perRuntime).toMatchObject({
      grok: {
        evidence: {
          messagesByRole: { assistant: 1, system: 1, user: 1 },
          reasoningCheckpoints: 1,
          toolCalls: 1,
          toolResults: 1
        },
        reasoningFragmentPseudoSessions: 0,
        sessions: 1,
        sourceSessionIds: ["019f42f6-8ada-7001-afff-c722e75faf45"]
      },
      hermes: { sessions: 1, structuredToolCalls: 1, structuredToolResults: 1 }
    });
    expect(report.importReports).toHaveLength(2);
    for (const importReport of report.importReports) {
      expect(importReport).toMatchObject({
        anomalies: [],
        importHealth: { repairRequired: 0 },
        outOfRangeSessions: 0,
        recordsRejected: 0,
        sessionsRepairRequired: 0
      });
    }
    expect(report.importReports.find((item) => item.runtime === "hermes")).toMatchObject({
      skippedUnits: 1,
      sourceUnitsDeferred: 1,
      sourceUnitsDiscovered: 2,
      sourceUnitsHydrated: 1
    });
    expect(report.workbenchCounts.notAddedReasons).toEqual([]);
    expect(report.workbenchCounts.importFailuresClassifiedAsNotAdded).toBe(0);
    expect(report.workbenchCounts.packagePath).toBe(2);
    expect(report.anomalies).toEqual([]);
    expect(report.repairPreview).toMatchObject({
      affectedSessions: expect.any(Array),
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourcePlans: expect.arrayContaining([
        expect.objectContaining({ available: true, sourceId: "acceptance:grok" }),
        expect.objectContaining({ available: true, sourceId: "acceptance:hermes" })
      ])
    });
    expect(report.repairPreview.affectedSessions).toHaveLength(2);
    expect(report.repairPreview.importJobIds).toHaveLength(2);
    expect(new Set(report.repairPreview.importJobIds).size).toBe(2);
    expect(report.repairPreview.jobPlans).toHaveLength(2);
    expect(report.repairPreview.jobPlans.every((plan) =>
      plan.available && plan.repairEligible && plan.scope?.mode === "transcript_recent" && plan.scope.days === 30
    )).toBe(true);
    expect(report.scopeEvidence).toMatchObject({
      currentUnitsAdmitted: 2,
      oldSemanticUnit: {
        canonicalSessions: 0,
        scopeReason: "outside_recent_range",
        status: "skipped",
        timestampBasis: "semantic"
      },
      reportDeferredUnits: 1
    });
  });

  test.each([
    "/var/lib/masthead/acceptance.sqlite",
    "/tmp/masthead-production/acceptance.sqlite",
    "/tmp/masthead-production-eval-copy.sqlite"
  ])("rejects unsafe database path %s", async (databasePath) => {
    await expect(replayImportTrustCorpus({ databasePath, sourceRoot })).rejects.toThrow(/safe isolated database path/i);
  });

  test("requires an existing sanitized corpus root", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);

    await expect(replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot: join(tempDir, "missing-corpus")
    })).rejects.toThrow(/sanitized corpus/i);
  });

  test("rejects a database path whose temporary parent symlinks outside /tmp", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const escape = join(tempDir, "escape");
    await symlink(process.cwd(), escape, "dir");

    await expect(validateImportTrustDatabasePath(join(escape, "acceptance.sqlite")))
      .rejects.toThrow(/safe isolated database path/i);
  });

  test("uses literal /tmp even when TMPDIR points outside it", async () => {
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = process.cwd();
    try {
      await expect(validateImportTrustDatabasePath(join(process.cwd(), "acceptance.sqlite")))
        .rejects.toThrow(/safe isolated database path/i);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  });

  test("rejects a dangling symlink at the database leaf", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "acceptance.sqlite");
    await symlink(join(tempDir, "missing.sqlite"), databasePath, "file");

    await expect(validateImportTrustDatabasePath(databasePath))
      .rejects.toThrow(/safe isolated database path/i);
  });

  test("exclusive-creates the database under a private 0700 directory", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const requested = join(tempDir, "acceptance.sqlite");

    const created = await validateImportTrustDatabasePath(requested);
    expect(created).not.toBe(requested);
    expect(created.startsWith(`${tempDir}/`)).toBe(true);
    expect(created).toMatch(/masthead-import-trust-db-[^/]+\/acceptance\.sqlite$/);
    const parentMode = (await lstat(dirname(created))).mode & 0o777;
    expect(parentMode).toBe(0o700);
    expect((await lstat(created)).isSymbolicLink()).toBe(false);
    // A second call with the same requested leaf still exclusive-creates a fresh path.
    const createdAgain = await validateImportTrustDatabasePath(requested);
    expect(createdAgain).not.toBe(created);
    expect(createdAgain).toMatch(/acceptance\.sqlite$/);
  });

  test("rejects a corpus root that is a symlink", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const linkedRoot = join(tempDir, "linked-corpus");
    await symlink(sourceRoot, linkedRoot, "dir");

    await expect(replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot: linkedRoot
    })).rejects.toThrow(/symlink/i);
  });

  test("rejects a corpus fixture path that is a symlink escape", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const corpus = join(tempDir, "corpus");
    await cp(sourceRoot, corpus, { recursive: true });
    const fixturePath = join(corpus, "hermes", "session.jsonl");
    const outside = join(tempDir, "outside-session.jsonl");
    await writeFile(outside, "escaped\n");
    await rm(fixturePath);
    await symlink(outside, fixturePath, "file");

    await expect(replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot: corpus
    })).rejects.toThrow(/symlink/i);
  });

  test("rejects a corpus fixture directory symlink escape", async () => {
    const tempDir = await mkdtemp(join("/tmp", "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const corpus = join(tempDir, "corpus");
    await cp(sourceRoot, corpus, { recursive: true });
    const hermesDir = join(corpus, "hermes");
    const outsideDir = join(tempDir, "outside-hermes");
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, "session.jsonl"), "escaped\n");
    await writeFile(join(outsideDir, "old-session.jsonl"), "escaped\n");
    await rm(hermesDir, { recursive: true, force: true });
    await symlink(outsideDir, hermesDir, "dir");

    await expect(replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot: corpus
    })).rejects.toThrow(/symlink|escapes the corpus root/i);
  });

});
