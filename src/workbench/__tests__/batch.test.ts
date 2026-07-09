import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { readWorkbenchSessionState, ensureWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { applyWorkbenchBatch, prepareWorkbenchBatch } from "../batch.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench batch workflow", () => {
  test("prepares a file-based batch with evidence, schema, instructions, output, and apply files", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:one", title: "First batch session" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:two", title: "Second batch session" });
    ensureWorkbenchSessionState(db, "session:one");
    ensureWorkbenchSessionState(db, "session:two");
    const outDir = join(await tempDir("masthead-batch-out-"), "batch-001");

    const result = await prepareWorkbenchBatch(db, { kind: "session_enrichment", limit: 2, outDir, scope: "missing" });

    expect(result).toMatchObject({ ok: true, batchDir: outDir });
    expect(result.sessions.map((session) => session.directoryName)).toEqual(["session-001", "session-002"]);
    const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")) as { kind: string; sessions: Array<{ sessionId: string }> };
    expect(manifest.kind).toBe("session_enrichment");
    expect(manifest.sessions.map((session) => session.sessionId)).toEqual(["session:two", "session:one"]);
    await expect(stat(join(outDir, "README.md"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "session-001", "evidence.json"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "session-001", "schema.json"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "session-001", "instructions.md"))).resolves.toBeTruthy();
    await expect(readFile(join(outDir, "session-001", "output.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(join(outDir, "session-001", "apply.sh"), "utf8")).resolves.toContain("mastheadctl workbench apply");
  });

  test("applies completed batch outputs and reports partial failures", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:one", title: "First batch session" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:two", title: "Second batch session" });
    ensureWorkbenchSessionState(db, "session:one");
    ensureWorkbenchSessionState(db, "session:two");
    const outDir = join(await tempDir("masthead-batch-apply-"), "batch-001");
    await prepareWorkbenchBatch(db, { kind: "session_enrichment", limit: 2, outDir, scope: "missing" });
    await writeFile(
      join(outDir, "session-001", "output.json"),
      JSON.stringify({
        confidence: "medium",
        evidenceRefs: ["message:session:two:message"],
        missingEvidence: [],
        searchPhrases: ["batch workbench apply"],
        summary: "Applied a Workbench batch output.",
        technologies: ["TypeScript"],
        title: "Apply Workbench batch",
        topics: ["Workbench"]
      }),
      "utf8"
    );

    const result = await applyWorkbenchBatch(db, { batchDir: outDir });

    expect(result).toMatchObject({ applied: 1, failed: 1, ok: false });
    expect(result.failures).toEqual([
      expect.objectContaining({ directoryName: "session-002", sessionId: "session:one" })
    ]);
    expect(readWorkbenchSessionState(db, "session:two")).toMatchObject({
      publicationStatus: "publish_path",
      sessionEnrichmentStatus: "satisfied"
    });
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dbDir = await tempDir("masthead-batch-db-");
  const db = await openMastheadDatabase(join(dbDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
