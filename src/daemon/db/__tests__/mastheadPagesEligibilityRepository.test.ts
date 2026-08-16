import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { PublishedSessionDossierV1 } from "../../../shared/sessionDossier.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import {
  MASTHEAD_PAGES_ELIGIBILITY_BACKFILL_BATCH_SIZE,
  MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
  MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT,
  MASTHEAD_PAGES_SELECTION_LIMIT,
  backfillMastheadPagesArtifactEligibilityBatch,
  diagnoseMastheadPagesArtifactEligibility,
  explainMaterializedMastheadPagesSelection,
  getMastheadPagesArtifactEligibility,
  resolveMaterializedMastheadPagesSelection
} from "../mastheadPagesEligibilityRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead Pages materialized eligibility", () => {
  test("writes minimal stable eligibility with the artifact and leaves live publication authority canonical", async () => {
    const db = await testDb();
    const artifactId = seedEligible(db, "session:write-through", { publish: false });
    const beforePublish = getMastheadPagesArtifactEligibility(db, artifactId);

    expect(beforePublish).toEqual({
      artifactId,
      evaluatedAt: expect.any(String),
      policyVersion: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
      reasonCode: undefined,
      status: "eligible"
    });
    expect(db.prepare("PRAGMA table_info(masthead_pages_artifact_eligibility)").all()).toHaveLength(5);
    expect(db.prepare("PRAGMA foreign_key_list(masthead_pages_artifact_eligibility)").all()).toEqual([
      expect.objectContaining({ from: "artifact_id", on_delete: "CASCADE", table: "session_artifacts", to: "artifact_id" })
    ]);
    expect(() =>
      db.prepare(
        `INSERT INTO masthead_pages_artifact_eligibility
           (artifact_id, policy_version, status, reason_code, evaluated_at)
         VALUES (?, 'invalid-policy', 'unknown', NULL, ?)`
      ).run(artifactId, "2026-08-16T12:00:00.000Z")
    ).toThrow();
    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({ artifactIds: [], status: "complete" });

    publishSessionArtifact(db, artifactId);

    expect(getMastheadPagesArtifactEligibility(db, artifactId)).toEqual(beforePublish);
    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({ artifactIds: [artifactId], status: "complete" });
  });

  test("reuses stored immutable artifact data when an idempotent apply repeats a fingerprint", async () => {
    const db = await testDb();
    const sessionId = "session:idempotent-eligibility";
    const artifactId = seedEligible(db, sessionId, { publish: false });
    const before = getMastheadPagesArtifactEligibility(db, artifactId);

    const mutatedIncomingContent = eligibleDossier("Mutated incoming title", "Masthead", sessionId);
    mutatedIncomingContent.enrichment = { status: "failed" };
    const repeated = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: mutatedIncomingContent,
      contentFingerprint: `fp-${sessionId}`,
      createdBy: "test",
      evidenceRefs: [],
      schemaVersion: "canonical-session-dossier-v1",
      sessionId,
      title: "Mutated incoming title",
      validation: { ok: true }
    });

    expect(repeated.artifactId).toBe(artifactId);
    expect(getMastheadPagesArtifactEligibility(db, artifactId)).toMatchObject({
      artifactId,
      policyVersion: before?.policyVersion,
      reasonCode: before?.reasonCode,
      status: "eligible"
    });
    const stored = db.prepare("SELECT content_json AS contentJson FROM session_artifacts WHERE artifact_id = ?")
      .get(artifactId) as { contentJson: string };
    expect(JSON.parse(stored.contentJson)).toMatchObject({ enrichment: { status: "current" } });
  });

  test("does not synthesize missing provenance while preserving capsule fallback separately", async () => {
    const db = await testDb();
    const artifactId = seedEligible(db, "session:missing-provenance");
    db.prepare("DELETE FROM session_artifact_provenance WHERE artifact_id = ?").run(artifactId);
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);

    expect(backfillMastheadPagesArtifactEligibilityBatch(db, { batchSize: 1 })).toMatchObject({
      errors: 0,
      materialized: 1,
      scanned: 1
    });
    expect(getMastheadPagesArtifactEligibility(db, artifactId)).toMatchObject({
      reasonCode: "single_session_dossier_required",
      status: "ineligible"
    });
    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({ artifactIds: [], status: "complete" });
  });

  test("materializes deterministic ineligibility without authorizing from the derived row", async () => {
    const db = await testDb();
    const sessionId = "session:stale-enrichment";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Stale enrichment"
    });
    const content = eligibleDossier("Stale enrichment", "Masthead", sessionId);
    content.enrichment = { status: "failed" };
    const artifact = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content,
      contentFingerprint: "fp-stale-enrichment",
      createdBy: "test",
      evidenceRefs: [],
      schemaVersion: "canonical-session-dossier-v1",
      sessionId,
      title: "Stale enrichment",
      validation: { ok: true }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(getMastheadPagesArtifactEligibility(db, artifact.artifactId)).toMatchObject({
      reasonCode: "current_enrichment_required",
      status: "ineligible"
    });
    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({ artifactIds: [], status: "complete" });
  });
  test("backfills in bounded restartable keyset batches and reports all diagnostic classes", async () => {

    const db = await testDb();
    const artifactIds = Array.from({ length: 5 }, (_, index) =>
      seedEligible(db, `session:backfill-${index}`, { publishedAt: `2026-08-16T0${index}:00:00.000Z` })
    ).sort();
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility").run();

    const first = backfillMastheadPagesArtifactEligibilityBatch(db, { batchSize: 2 });
    const second = backfillMastheadPagesArtifactEligibilityBatch(db, {
      afterArtifactId: first.nextCursor,
      batchSize: 2
    });
    const third = backfillMastheadPagesArtifactEligibilityBatch(db, {
      afterArtifactId: second.nextCursor,
      batchSize: 2
    });

    expect(first).toMatchObject({ complete: false, errors: 0, materialized: 2, scanned: 2 });
    expect(second).toMatchObject({ complete: false, errors: 0, materialized: 2, scanned: 2 });
    expect(third).toMatchObject({ complete: true, errors: 0, materialized: 1, scanned: 1 });
    expect(first.nextCursor).toBe(artifactIds[1]);
    expect(second.nextCursor).toBe(artifactIds[3]);
    expect(MASTHEAD_PAGES_ELIGIBILITY_BACKFILL_BATCH_SIZE).toBe(100);

    db.prepare(
      `INSERT INTO masthead_pages_artifact_eligibility
         (artifact_id, policy_version, status, reason_code, evaluated_at)
       VALUES (?, 'stale-policy', 'ineligible', 'unsupported_schema', ?)`
    ).run(artifactIds[0], "2026-08-16T12:00:00.000Z");
    db.prepare("UPDATE masthead_pages_artifact_eligibility SET reason_code = 'impossible' WHERE artifact_id = ? AND policy_version = ?")
      .run(artifactIds[1], MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION);
    db.prepare("UPDATE masthead_pages_artifact_eligibility SET status = 'error', reason_code = 'eligibility_evaluation_error' WHERE artifact_id = ? AND policy_version = ?")
      .run(artifactIds[2], MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION);
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ? AND policy_version = ?")
      .run(artifactIds[3], MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      `INSERT INTO masthead_pages_artifact_eligibility
         (artifact_id, policy_version, status, reason_code, evaluated_at)
       VALUES ('artifact:orphan', ?, 'eligible', NULL, ?)`
    ).run(MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, "2026-08-16T12:00:00.000Z");
    db.exec("PRAGMA foreign_keys = ON");

    const diagnostics = diagnoseMastheadPagesArtifactEligibility(db, 10);
    expect(diagnostics.counts).toMatchObject({
      duplicate: 0,
      error: 1,
      impossible: 1,
      missing: 1,
      orphaned: 1,
      stale_policy: 1
    });
    expect(diagnostics.samples.missing).toContain(artifactIds[3]);
    expect(diagnostics.samples.orphaned).toContain("artifact:orphan");
  });

  test("repairs a bounded miss synchronously but returns honest zero-ID incompleteness beyond the bound", async () => {
    const db = await testDb();
    const repairedId = seedEligible(db, "session:repair-one");
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(repairedId);

    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({
      artifactIds: [repairedId],
      status: "complete"
    });
    expect(getMastheadPagesArtifactEligibility(db, repairedId)?.status).toBe("eligible");

    const withinBound = Array.from({ length: MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT }, (_, index) => {
      const artifactId = seedEligible(db, `session:repair-within-bound-${index}`);
      db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);
      return artifactId;
    });
    const repairedWithinBound = resolveMaterializedMastheadPagesSelection(db);
    expect(repairedWithinBound.status).toBe("complete");
    expect(repairedWithinBound.artifactIds).toEqual(expect.arrayContaining([repairedId, ...withinBound]));

    for (let index = 0; index <= MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT; index += 1) {
      const artifactId = seedEligible(db, `session:repair-overflow-${index}`);
      db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);
    }

    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({
      artifactIds: [],
      reason: "eligibility_backfill_incomplete",
      retryable: true,
      status: "incomplete"
    });
  });

  test("fails closed with zero IDs when bounded repair cannot evaluate an immutable body", async () => {
    const db = await testDb();
    const artifactId = seedEligible(db, "session:corrupt-body");
    db.prepare("UPDATE session_artifacts SET content_json = 'not-json' WHERE artifact_id = ?").run(artifactId);
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);

    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({
      artifactIds: [],
      reason: "eligibility_evaluation_failed",
      retryable: false,
      status: "incomplete"
    });
    expect(getMastheadPagesArtifactEligibility(db, artifactId)).toMatchObject({
      reasonCode: "eligibility_evaluation_error",
      status: "error"
    });
  });

  test("uses only the exact current policy and live current/published admission", async () => {
    const db = await testDb();
    const selected = seedEligible(db, "session:selected", { publishedAt: "2026-08-16T14:00:00.000Z" });
    const appliedOnly = seedEligible(db, "session:applied-only", { publish: false });
    const superseded = seedEligible(db, "session:superseded", { publishedAt: "2026-08-16T13:00:00.000Z" });
    db.prepare("UPDATE session_artifacts SET status = 'superseded' WHERE artifact_id = ?").run(superseded);
    db.prepare(
      `INSERT INTO masthead_pages_artifact_eligibility
         (artifact_id, policy_version, status, reason_code, evaluated_at)
       VALUES (?, 'future-policy', 'eligible', NULL, ?)`
    ).run(appliedOnly, "2026-08-16T15:00:00.000Z");

    expect(resolveMaterializedMastheadPagesSelection(db)).toEqual({
      artifactIds: [selected],
      status: "complete"
    });
  });

  test("preserves complete-corpus filtering, deterministic ordering, FTS plans, and the 500 cap", async () => {
    const db = await testDb();
    const old = seedEligible(db, "session:old", {
      project: "Masthead",
      publishedAt: "2026-08-14T12:00:00.000Z",
      title: "Quartz old"
    });
    const newest = seedEligible(db, "session:new", {
      project: "Masthead",
      publishedAt: "2026-08-16T12:00:00.000Z",
      title: "Quartz new"
    });
    seedEligible(db, "session:other-project", {
      project: "Other",
      publishedAt: "2026-08-15T12:00:00.000Z",
      title: "Quartz other"
    });

    expect(resolveMaterializedMastheadPagesSelection(db, {
      dateFrom: "2026-08-14T00:00:00.000Z",
      dateTo: "2026-08-16T23:59:59.999Z",
      project: "Masthead",

      q: "Quartz"
    })).toEqual({ artifactIds: [newest, old], status: "complete" });
    expect(explainMaterializedMastheadPagesSelection(db, { q: "Quartz" })).not.toEqual([]);
    expect(explainMaterializedMastheadPagesSelection(db, {})).not.toEqual([]);

    const capped = resolveMaterializedMastheadPagesSelection(db, {}, 1);
    expect(capped).toEqual({ artifactIds: [newest], status: "complete" });
    expect(MASTHEAD_PAGES_SELECTION_LIMIT).toBe(500);
  });
  test("normal replacement selection is body-free, hydration-free, provenance-free, and capped at 500", () => {
    const preparedSql: string[] = [];
    let selectionLimit: unknown;
    const fakeDb = {
      prepare(sql: string) {
        preparedSql.push(sql);
        if (sql.includes("eligibility.artifact_id IS NULL")) {
          return { all: () => [] };
        }
        if (sql.includes("eligibility.status = 'error'")) {
          return { get: () => undefined };
        }
        return {
          all: (...params: unknown[]) => {
            selectionLimit = params.at(-1);
            return [{ artifactId: "artifact:selected" }];
          }
        };
      }
    } as unknown as MastheadDatabase;

    expect(resolveMaterializedMastheadPagesSelection(fakeDb, {}, 5_000)).toEqual({
      artifactIds: ["artifact:selected"],
      status: "complete"
    });
    expect(selectionLimit).toBe(500);
    expect(preparedSql).toHaveLength(3);
    expect(
      preparedSql.some((sql) =>
        /\b(content_json|evidence_refs_json|validation_json|session_artifact_provenance)\b/u.test(sql)
      )
    ).toBe(false);
    expect(preparedSql.some((sql) => /getLogbookArtifactDetail|JSON\\.parse/u.test(sql))).toBe(false);
    expect(preparedSql.every((sql) => sql.includes("policy_version = ?"))).toBe(true);
  });
});

type SeedOptions = {
  project?: string;
  publish?: boolean;
  publishedAt?: string;
  title?: string;
};

function seedEligible(db: MastheadDatabase, sessionId: string, options: SeedOptions = {}): string {
  const title = options.title ?? sessionId;
  const project = options.project ?? "Masthead";
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project,
    sessionId,
    title
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(title, project, sessionId),
    contentFingerprint: `fp-${sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    projectLabel: project,
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    summary: `Summary for ${title}`,
    title,
    validation: { ok: true }
  });
  if (options.publish !== false) {
    publishSessionArtifact(db, applied.artifactId);
    if (options.publishedAt) {
      db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?")
        .run(options.publishedAt, options.publishedAt, applied.artifactId);
    }
  }
  return applied.artifactId;
}

function eligibleDossier(title: string, project: string, sessionId: string): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId,
      sourceSessionId: sessionId,
      title,
      runtime: "codex",
      project,
      branch: "main",
      lifecycle: "ended"
    },
    narrative: {
      objective: "Eligible work",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["pages"],
      technologies: ["typescript"],
      unresolved: []
    },
    files: [],
    tools: [],
    verification: { status: "passed", summary: "ok", commands: [] },
    attention: [],
    excerpts: [],
    enrichment: { status: "current" },
    durableEnrichment: {
      keywords: ["quartz", "eligible"],
      sessionTitle: { text: title, basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: `Summary for ${title}`, state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Work"],
        decisions: [],
        blockers: [],
        verification: { status: "passed", summary: "ok", commands: [], failures: [], evidenceRefs: [] },
        continuation: { openQuestions: [], constraints: [] },
        warnings: [],
        evidenceRefs: []
      }
    }
  } as unknown as PublishedSessionDossierV1;
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-eligibility-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
