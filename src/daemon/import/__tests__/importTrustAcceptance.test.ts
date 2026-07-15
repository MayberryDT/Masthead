import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
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
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-trust-"));
    tempDirs.push(tempDir);

    const report = await replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot
    });

    expect(report.productionAccessed).toBe(false);
    expect(report.perRuntime).toMatchObject({
      grok: {
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
    expect(report.workbenchCounts.notAddedReasons).toEqual([]);
    expect(report.workbenchCounts.importFailuresClassifiedAsNotAdded).toBe(0);
    expect(report.workbenchCounts.packagePath).toBe(2);
    expect(report.anomalies).toEqual([]);
    expect(report.repairPreview).toMatchObject({
      applyAllowed: false,
      importJobIds: [],
      planHash: null,
      reason: "No repair-required imports in the isolated replay."
    });
    expect(report.scopeEvidence).toMatchObject({
      changedOldUnitIncludedOnlyWithCursor: true,
      freshOldUnitExcluded: true
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
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-trust-"));
    tempDirs.push(tempDir);

    await expect(replayImportTrustCorpus({
      databasePath: join(tempDir, "acceptance.sqlite"),
      sourceRoot: join(tempDir, "missing-corpus")
    })).rejects.toThrow(/sanitized corpus/i);
  });

  test("rejects a database path whose temporary parent symlinks outside /tmp", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-trust-"));
    tempDirs.push(tempDir);
    const escape = join(tempDir, "escape");
    await symlink(process.cwd(), escape, "dir");

    await expect(validateImportTrustDatabasePath(join(escape, "acceptance.sqlite")))
      .rejects.toThrow(/safe isolated database path/i);
  });
});
