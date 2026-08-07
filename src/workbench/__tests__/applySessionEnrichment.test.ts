import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SESSION_CAPSULE_PROMPT_VERSION } from "../../enrichment/sessionCompiler.ts";
import { currentSessionEnrichmentView } from "../../daemon/db/enrichmentViewRepository.ts";
import { readCurrentSessionEnrichment } from "../../daemon/db/enrichmentRepository.ts";
import { searchSessions } from "../../daemon/db/searchRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { publishSessionToLogbook, seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { listWorkbenchActivity, readWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import { applySessionEnrichment } from "../applySessionEnrichment.ts";
import type { SessionEnrichmentOutput } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("applySessionEnrichment", () => {
  test("dry-run validates and reports planned rows without mutating the database", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Old title" });

    const result = applySessionEnrichment(db, { dryRun: true, output: validOutput(), sessionId: "session:abc" });

    expect(result).toMatchObject({ dryRun: true, ok: true, plannedRows: ["session_capsule", "live_summary", "search_projection"] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE provider = 'workbench_cli'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_runs").get()).toEqual({ count: 0 });
  });

  test("writes current enrichment rows, reindexes search, and satisfies Workbench readiness without publishing", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Old title" });

    const result = applySessionEnrichment(db, { output: validOutput(), sessionId: "session:abc" });

    expect(result).toMatchObject({ dryRun: false, ok: true });
    expect(currentSessionEnrichmentView(db, "session:abc")).toMatchObject({
      model: "external_agent",
      provider: "workbench_cli",
      title: "Add Workbench apply",
      liveSummary: "Implemented Workbench apply for session enrichment."
    });
    expect(readCurrentSessionEnrichment(db, "session:abc", "session_capsule", SESSION_CAPSULE_PROMPT_VERSION)).toMatchObject({
      model: "external_agent",
      provider: "workbench_cli",
      status: "current"
    });
    expect(readWorkbenchSessionState(db, "session:abc")).toMatchObject({
      publicationStatus: "publish_path",
      sessionEnrichmentStatus: "satisfied"
    });
    expect(listWorkbenchActivity(db, { limit: 10, sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ eventType: "session_enrichment_applied", summary: "Session enrichment applied" })
    ]);
    expect(searchSessions(db, { limit: 10, query: "Workbench apply" }).sessions).toEqual([]);
    publishSessionToLogbook(db, "session:abc");
    expect(searchSessions(db, { limit: 10, query: "Workbench apply" }).sessions).toEqual([
      expect.objectContaining({ sessionId: "session:abc", title: "Add Workbench apply" })
    ]);
    expect(db.prepare("SELECT command, status, session_id AS sessionId FROM workbench_runs").all()).toEqual([
      { command: "apply session_enrichment", sessionId: "session:abc", status: "succeeded" }
    ]);
  });

  test("rejects evidence refs that are not in the session evidence packet", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Old title" });

    expect(() => applySessionEnrichment(db, { output: { ...validOutput(), evidenceRefs: ["missing:ref"] }, sessionId: "session:abc" })).toThrow(
      "Evidence ref is not present in the packet: missing:ref"
    );
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE provider = 'workbench_cli'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_runs").get()).toEqual({ count: 0 });
  });

  test("reapply is idempotent by content fingerprint", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Old title" });

    applySessionEnrichment(db, { output: validOutput(), sessionId: "session:abc" });
    applySessionEnrichment(db, { output: validOutput(), sessionId: "session:abc" });

    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE provider = 'workbench_cli'").get()).toEqual({ count: 3 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE provider = 'workbench_cli' AND status = 'current'").get()).toEqual({
      count: 3
    });
  });

  test("maps verification summary language to status instead of forcing passed", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Verify mapping" });
    const failed = applySessionEnrichment(db, {
      output: { ...validOutput(), verificationSummary: "Focused tests failed with exit code 1." },
      sessionId: "session:abc"
    });
    expect(failed.ok).toBe(true);
    const capsule = readCurrentSessionEnrichment(db, "session:abc", "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
    expect(capsule?.content).toMatchObject({
      sessionDossier: {
        verification: {
          status: "failed",
          summary: "Focused tests failed with exit code 1."
        }
      }
    });
  });
});

function validOutput(): SessionEnrichmentOutput {
  return {
    confidence: "high",
    evidenceRefs: ["message:session:abc:message", "file:session:abc:file", "tool_call:session:abc:tool"],
    filesSummary: "Updated Workbench apply files.",
    missingEvidence: [],
    searchPhrases: ["Workbench apply", "session enrichment"],
    summary: "Implemented Workbench apply for session enrichment.",
    technologies: ["TypeScript", "SQLite"],
    title: "Add Workbench apply",
    topics: ["Workbench", "Session enrichment"],
    verificationSummary: "Focused tests passed."
  };
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-apply-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
