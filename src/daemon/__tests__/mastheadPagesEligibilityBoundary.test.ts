import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { getPendingMastheadPagesOperation } from "../db/mastheadPagesRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../db/sessionArtifactRepository.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../db/sqlite.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { routeMastheadPagesRequest } from "../mastheadPagesApi.ts";

const tempDirs: string[] = [];
let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal("fetch", () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden at the local review boundary");
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Masthead Pages review eligibility boundary", () => {
  test("prepare and finalize reject missing, stale, and failed body eligibility without staging", async () => {
    const db = await testDatabase();
    const missingId = seedEligibleArtifact(db, "session:eligibility-missing");
    const staleId = seedEligibleArtifact(db, "session:eligibility-stale");
    const errorId = seedEligibleArtifact(db, "session:eligibility-error");

    replaceBody(db, missingId, {
      ...eligibleDossier("session:eligibility-missing"),
      durableEnrichment: undefined
    });
    replaceBody(db, staleId, {
      ...eligibleDossier("session:eligibility-stale"),
      enrichment: { status: "failed" }
    });
    replaceBody(db, errorId, {
      snapshotVersion: "canonical-session-dossier-v1",
      durableEnrichment: {}
    });

    expect(readMaterializedStatuses(db, [missingId, staleId, errorId])).toEqual([
      { artifactId: errorId, status: "eligible" },
      { artifactId: missingId, status: "eligible" },
      { artifactId: staleId, status: "eligible" }
    ].sort((a, b) => a.artifactId.localeCompare(b.artifactId)));

    for (const artifactId of [missingId, staleId]) {
      const prepared = prepare(db, artifactId);
      expect(prepared).toMatchObject({
        status: 200,
        body: {
          ok: true,
          items: [{
            artifactId,
            eligibility: "ineligible",
            ineligibilityReason: "current_enrichment_required"
          }]
        }
      });
      expect(finalize(db, artifactId)).toMatchObject({
        status: 400,
        body: { ok: false, error: { code: "current_enrichment_required" } }
      });
      expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();
    }

    expect(prepare(db, errorId)).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: "invalid_request" } }
    });
    expect(finalize(db, errorId)).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: "invalid_request" } }
    });
    expect(getPendingMastheadPagesOperation(db, errorId)).toBeUndefined();
    expect(pendingOperationCount(db)).toBe(0);
    expect(fetchCalls).toBe(0);
    db.close();
  });

  test("prepare and finalize read current publication state instead of trusting an eligible materialized row", async () => {
    const db = await testDatabase();
    const supersededId = seedEligibleArtifact(db, "session:eligibility-superseded");
    const unpublishedId = seedEligibleArtifact(db, "session:eligibility-unpublished");
    db.prepare("UPDATE session_artifacts SET status = 'superseded' WHERE artifact_id = ?").run(supersededId);
    db.prepare("UPDATE session_artifacts SET publication_status = 'applied' WHERE artifact_id = ?").run(unpublishedId);

    expect(readMaterializedStatuses(db, [supersededId, unpublishedId])).toEqual([
      { artifactId: supersededId, status: "eligible" },
      { artifactId: unpublishedId, status: "eligible" }
    ].sort((a, b) => a.artifactId.localeCompare(b.artifactId)));

    for (const artifactId of [supersededId, unpublishedId]) {
      expect(prepare(db, artifactId)).toMatchObject({
        status: 200,
        body: {
          ok: true,
          items: [{ artifactId, eligibility: "ineligible", ineligibilityReason: "artifact_not_found" }]
        }
      });
      expect(finalize(db, artifactId)).toMatchObject({
        status: 404,
        body: { ok: false, error: { code: "artifact_not_found" } }
      });
      expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();
    }

    expect(pendingOperationCount(db)).toBe(0);
    expect(fetchCalls).toBe(0);
    db.close();
  });
});


async function testDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-eligibility-boundary-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedEligibleArtifact(db: MastheadDatabase, sessionId: string): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Eligibility boundary"
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(sessionId),
    contentFingerprint: `fingerprint:${sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    title: `Eligible ${sessionId}`,
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

function eligibleDossier(sessionId: string): PublishedSessionDossierV1 {
  const title = `Eligible ${sessionId}`;
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId,
      sourceSessionId: sessionId,
      title,
      runtime: "codex",
      project: "Masthead",
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
      keywords: ["selection", "eligibility"],
      sessionTitle: { text: title, basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: `Summary for ${title}`, state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Verified eligible work"],
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

function replaceBody(db: MastheadDatabase, artifactId: string, body: unknown): void {
  db.prepare("UPDATE session_artifacts SET content_json = ? WHERE artifact_id = ?")
    .run(JSON.stringify(body), artifactId);
}

function prepare(db: MastheadDatabase, artifactId: string) {
  return routeMastheadPagesRequest(
    { db },
    {
      method: "POST",
      url: new URL("http://127.0.0.1/masthead-pages/reviews/prepare"),
      body: { artifactIds: [artifactId] }
    }
  );
}

function finalize(db: MastheadDatabase, artifactId: string) {
  return routeMastheadPagesRequest(
    { db },
    {
      method: "POST",
      url: new URL("http://127.0.0.1/masthead-pages/reviews/finalize"),
      body: {
        items: [{
          artifactId,
          publicLogbookId: "11111111-1111-4111-8111-111111111111",
          pagesAccountId: "account:local-19",
          slug: "local-19-fail-closed",
          license: "all-rights-reserved",
          evidenceSelections: []
        }]
      }
    }
  );
}

function readMaterializedStatuses(
  db: MastheadDatabase,
  artifactIds: string[]
): Array<{ artifactId: string; status: string }> {
  const placeholders = artifactIds.map(() => "?").join(", ");
  return db.prepare(
    `SELECT artifact_id AS artifactId, status
     FROM masthead_pages_artifact_eligibility
     WHERE artifact_id IN (${placeholders})
     ORDER BY artifact_id`
  ).all(...artifactIds) as Array<{ artifactId: string; status: string }>;
}

function pendingOperationCount(db: MastheadDatabase): number {
  return Number((db.prepare(
    "SELECT COUNT(*) AS count FROM masthead_pages_release_mappings WHERE pending_operation_kind IS NOT NULL"
  ).get() as { count: number }).count);
}
