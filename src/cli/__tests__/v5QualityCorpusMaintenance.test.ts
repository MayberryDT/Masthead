import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { applySessionArtifact, publishSessionArtifact } from "../../daemon/db/sessionArtifactRepository.ts";
import { runWorkbenchAuthoringCli } from "../workbenchAuthoring.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("V5 quality corpus maintenance CLI", () => {
  test("audits an explicit retained-author contract without mutating artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-v5-quality-cli-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    getOrCreateDatabaseIdentity(db);
    for (const [index, createdBy] of ["quality:strict", "quality:bad"].entries()) {
      const sessionId = `session:cli:${index}`;
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: `CLI ${index}` });
      const artifact = applySessionArtifact(db, {
        sessionId,
        artifactKind: "runbook",
        contentFingerprint: `cli-${index}`,
        createdBy,
        schemaVersion: "runbook-v1",
        title: `CLI artifact ${index}`,
        summary: `CLI summary ${index}`,
        content: { index },
        evidenceRefs: [],
        validation: {},
      });
      publishSessionArtifact(db, artifact.artifactId);
    }
    db.close();
    await writeFile(`${databasePath}-wal`, "");

    const result = await runWorkbenchAuthoringCli([
      "audit-v5-quality-corpus",
      "--db", databasePath,
      "--retain-created-by", "quality:strict",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      audit: { totalCurrentPublished: 2, retainedArtifacts: 1, invalidationArtifacts: 1 },
    });
    const reopened = await openMastheadDatabase(databasePath);
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM session_artifacts WHERE status = 'current'").get()).toEqual({ count: 2 });
    reopened.close();
  });
});
