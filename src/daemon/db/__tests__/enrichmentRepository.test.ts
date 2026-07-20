import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { GuidedEnrichmentProvenance } from "../../../shared/guidedAuthoring.ts";
import {
  listGuidedEnrichmentProvenance,
  listGuidedEnrichmentProvenanceByEnrichment,
  recordGuidedEnrichmentProvenanceInTransaction,
  upsertSessionEnrichment
} from "../enrichmentRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase, withImmediateTransaction } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment repository", () => {
  test("upserts versioned session capsules by content fingerprint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    db.prepare(
      `INSERT INTO hosts (host_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?)`
    ).run("host:test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("runtime:test", "opencode", "test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "session-1",
      "host:test",
      "runtime:test",
      "source-session-1",
      "unknown",
      "2026-06-24T12:00:00.000Z",
      "authoritative",
      "2026-06-24T12:00:00.000Z",
      "2026-06-24T12:00:00.000Z"
    );

    const id = upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        searchPhrases: ["Masthead"],
        technologies: ["TypeScript"],
        title: "Masthead data layer",
        topics: ["Masthead"],
        unresolved: []
      },
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-24T12:05:00.000Z",
      model: "deterministic",
      promptVersion: "session-capsule-v1",
      provider: "local",
      sessionId: "session-1",
      sourceRefs: [{ id: "event-1", kind: "event", observedAt: "2026-06-24T12:00:00.000Z", source: "opencode.plugin" }],
      status: "current"
    });
    const sameId = upsertSessionEnrichment(db, {
      contentFingerprint: "fingerprint-1",
      enrichmentKind: "session_capsule",
      failureCode: "none",
      promptVersion: "session-capsule-v1",
      sessionId: "session-1",
      sourceRefs: [],
      status: "stale"
    });

    expect(sameId).toBe(id);
    expect(db.prepare("SELECT enrichment_id, status, content_fingerprint FROM session_enrichments").all()).toEqual([
      { content_fingerprint: "fingerprint-1", enrichment_id: id, status: "stale" }
    ]);
    db.close();
  });

  test("round-trips every guided enrichment provenance field in stable assignment order", async () => {
    const db = await guidedDb(["session:2", "session:1"]);
    const enrichmentTwo = insertEnrichment(db, "session:2", "fingerprint:two");
    const enrichmentOne = insertEnrichment(db, "session:1", "fingerprint:one");
    const provenanceTwo = provenance({ enrichmentId: enrichmentTwo, sessionId: "session:2" });
    const provenanceOne = provenance({ enrichmentId: enrichmentOne, sessionId: "session:1" });

    withImmediateTransaction(db, () => {
      recordGuidedEnrichmentProvenanceInTransaction(db, provenanceTwo);
      recordGuidedEnrichmentProvenanceInTransaction(db, provenanceOne);
    });

    expect(listGuidedEnrichmentProvenance(db, "assignment:one")).toEqual([provenanceOne, provenanceTwo]);
    expect(listGuidedEnrichmentProvenanceByEnrichment(db, enrichmentTwo)).toEqual([provenanceTwo]);
    db.close();
  });

  test("rolls back guided provenance with enrichment rows in the caller transaction", async () => {
    const db = await guidedDb(["session:1"]);

    expect(() => withImmediateTransaction(db, () => {
      const enrichmentId = insertEnrichment(db, "session:1", "fingerprint:rollback");
      recordGuidedEnrichmentProvenanceInTransaction(db, provenance({ enrichmentId, sessionId: "session:1" }));
      throw new Error("injected_guided_enrichment_failure");
    })).toThrow("injected_guided_enrichment_failure");

    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM guided_authoring_enrichment_provenance").get()).toEqual({ count: 0 });
    db.close();
  });

  test("associates one stable identical enrichment with two guided assignments", async () => {
    const db = await guidedDb(["session:1"], ["one", "two"]);
    const firstEnrichmentId = insertEnrichment(db, "session:1", "fingerprint:shared");
    const secondEnrichmentId = insertEnrichment(db, "session:1", "fingerprint:shared");

    expect(secondEnrichmentId).toBe(firstEnrichmentId);
    withImmediateTransaction(db, () => {
      recordGuidedEnrichmentProvenanceInTransaction(db, provenance({
        assignmentId: "assignment:two",
        enrichmentId: secondEnrichmentId,
        requestId: "request:two",
        sessionId: "session:1"
      }));
      recordGuidedEnrichmentProvenanceInTransaction(db, provenance({
        assignmentId: "assignment:one",
        enrichmentId: firstEnrichmentId,
        requestId: "request:one",
        sessionId: "session:1"
      }));
    });

    expect(listGuidedEnrichmentProvenanceByEnrichment(db, firstEnrichmentId)).toEqual([
      provenance({ assignmentId: "assignment:one", enrichmentId: firstEnrichmentId, requestId: "request:one", sessionId: "session:1" }),
      provenance({ assignmentId: "assignment:two", enrichmentId: firstEnrichmentId, requestId: "request:two", sessionId: "session:1" })
    ]);
    db.close();
  });

  test("enforces guided provenance membership, foreign keys, literals, revisions, and nonblank fields", async () => {
    const db = await guidedDb(["session:1"]);
    const enrichmentId = insertEnrichment(db, "session:1", "fingerprint:constraints");
    const valid = provenance({ enrichmentId, sessionId: "session:1" });

    for (const invalid of [
      { ...valid, enrichmentId: "enrichment:missing" },
      { ...valid, requestId: "request:wrong" },
      { ...valid, sessionId: "session:wrong" },
      { ...valid, draftRevision: 0 },
      { ...valid, draftRevision: 1.5 },
      { ...valid, evidenceRevision: "   " },
      { ...valid, policyVersion: "guided-authoring-v0" },
      { ...valid, source: "legacy" },
      { ...valid, appliedAt: "" }
    ]) {
      expect(() => withImmediateTransaction(db, () => {
        recordGuidedEnrichmentProvenanceInTransaction(db, invalid as GuidedEnrichmentProvenance);
      })).toThrow();
    }
    withImmediateTransaction(db, () => recordGuidedEnrichmentProvenanceInTransaction(db, valid));
    expect(() => withImmediateTransaction(db, () => {
      recordGuidedEnrichmentProvenanceInTransaction(db, valid);
    })).toThrow();
    expect(listGuidedEnrichmentProvenance(db, "assignment:one")).toEqual([valid]);
    db.close();
  });

  test("rejects provenance when the enrichment belongs to another session in the same assignment", async () => {
    const db = await guidedDb(["session:1", "session:2"]);
    const enrichmentId = insertEnrichment(db, "session:1", "fingerprint:session-one");

    expect(() => withImmediateTransaction(db, () => {
      recordGuidedEnrichmentProvenanceInTransaction(db, provenance({
        enrichmentId,
        sessionId: "session:2"
      }));
    })).toThrow("guided_enrichment_session_mismatch");
    expect(listGuidedEnrichmentProvenance(db, "assignment:one")).toEqual([]);
    db.close();
  });
});

async function guidedDb(sessionIds: string[], suffixes = ["one"]): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-guided-enrichment-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  const now = "2026-07-19T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
  db.prepare(
    "INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run("runtime:test", "opencode", "test", now, now);
  for (const sessionId of sessionIds) {
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at,
        source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, "host:test", "runtime:test", `source:${sessionId}`, "ended", now, "authoritative", now, now);
  }
  for (const suffix of suffixes) {
    db.prepare(
      `INSERT INTO guided_authoring_requests (
        request_id, actor_id, creation_instance_id, instance_manifest, base_url, database_id,
        build_sha, policy_version, status, created_at, updated_at
      ) VALUES (?, 'codex', 'instance:test', 'manifest:test', 'http://127.0.0.1:17373',
        'database:test', 'build:test', 'guided-authoring-v1', 'open', ?, ?)`
    ).run(`request:${suffix}`, now, now);
    const insertRequestSession = db.prepare(
      `INSERT INTO guided_authoring_request_sessions
       (request_id, session_id, ordinal, state) VALUES (?, ?, ?, 'assigned')`
    );
    sessionIds.forEach((sessionId, ordinal) => insertRequestSession.run(`request:${suffix}`, sessionId, ordinal));
    db.prepare(
      `INSERT INTO guided_authoring_assignments (
        assignment_id, request_id, ordinal, status, canary, evidence_revision, created_at, updated_at
      ) VALUES (?, ?, 0, 'ready_to_finish', 1, 'evidence:current', ?, ?)`
    ).run(`assignment:${suffix}`, `request:${suffix}`, now, now);
    const insertAssignmentSession = db.prepare(
      `INSERT INTO guided_authoring_assignment_sessions
       (assignment_id, request_id, session_id, ordinal) VALUES (?, ?, ?, ?)`
    );
    sessionIds.forEach((sessionId, ordinal) => {
      insertAssignmentSession.run(`assignment:${suffix}`, `request:${suffix}`, sessionId, ordinal);
    });
  }
  return db;
}

function insertEnrichment(db: MastheadDatabase, sessionId: string, contentFingerprint: string): string {
  return upsertSessionEnrichment(db, {
    contentFingerprint,
    enrichmentKind: "session_capsule",
    generatedAt: "2026-07-19T12:05:00.000Z",
    promptVersion: "guided-authoring-v1",
    sessionId,
    sourceRefs: [],
    status: "current"
  });
}

function provenance(overrides: Partial<GuidedEnrichmentProvenance> & Pick<GuidedEnrichmentProvenance, "enrichmentId" | "sessionId">): GuidedEnrichmentProvenance {
  return {
    appliedAt: "2026-07-19T12:10:00.000Z",
    assignmentId: "assignment:one",
    draftRevision: 1,
    evidenceRevision: "evidence:current",
    policyVersion: "guided-authoring-v1",
    requestId: "request:one",
    source: "guided_authoring",
    ...overrides
  };
}
