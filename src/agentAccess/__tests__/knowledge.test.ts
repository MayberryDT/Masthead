import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { applySessionArtifact, publishSessionArtifact } from "../../daemon/db/sessionArtifactRepository.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { getEvidenceTranscript } from "../evidence.ts";
import { getKnowledge, searchKnowledge } from "../knowledge.ts";
import { getProvenance } from "../provenance.ts";
import { getCorpusStats } from "../corpusStats.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("agentAccess knowledge API", () => {
  test("search and get return stable artifactId and provenance", async () => {
    const db = await openDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:knowledge-1",
      title: "Knowledge search fixture"
    });
    const applied = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: { title: "Published knowledge dossier", outcome: "Stable agentAccess DTOs." },
      contentFingerprint: "agent-access:knowledge:1",
      createdBy: "test",
      evidenceRefs: ["message:session:knowledge-1:1"],
      schemaVersion: "session-dossier-v1",
      sessionId: "session:knowledge-1",
      summary: "Stable agentAccess DTOs.",
      title: "Published knowledge dossier",
      validation: { ok: true }
    });
    publishSessionArtifact(db, applied.artifactId);

    const search = searchKnowledge(db, { query: "Stable agentAccess", limit: 5 });
    expect(search.ok).toBe(true);
    expect(search.total).toBe(1);
    expect(search.artifacts[0]).toMatchObject({
      artifactId: applied.artifactId,
      kind: "session_dossier",
      title: "Published knowledge dossier"
    });

    const detail = getKnowledge(db, applied.artifactId);
    expect(detail.artifact).toMatchObject({
      artifactId: applied.artifactId,
      kind: "session_dossier",
      title: "Published knowledge dossier",
      provenanceSessionIds: ["session:knowledge-1"],
      provenance: { sessionIds: ["session:knowledge-1"], provenanceSize: 1 }
    });
    expect(detail.artifact?.notice).toContain("Published Logbook knowledge");

    const provenance = getProvenance(db, applied.artifactId);
    expect(provenance).toMatchObject({
      artifactId: applied.artifactId,
      ok: true,
      provenance: { sessionIds: ["session:knowledge-1"] }
    });

    const stats = getCorpusStats(db);
    expect(stats.publishedArtifacts).toBe(1);
    expect(stats.byKind).toEqual([{ count: 1, kind: "session_dossier" }]);
    db.close();
  });

  test("evidence tools reject sessions outside optional artifact provenance", async () => {
    const db = await openDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:prov-a",
      title: "Provenance A"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:prov-b",
      title: "Provenance B"
    });
    const applied = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: { title: "Prov gated" },
      contentFingerprint: "agent-access:prov",
      createdBy: "test",
      evidenceRefs: [],
      schemaVersion: "session-dossier-v1",
      sessionId: "session:prov-a",
      title: "Prov gated",
      validation: { ok: true }
    });
    publishSessionArtifact(db, applied.artifactId);

    expect(() =>
      getEvidenceTranscript(db, {
        artifactId: applied.artifactId,
        sessionId: "session:prov-b"
      })
    ).toThrow(/not in provenance/);

    const allowed = getEvidenceTranscript(db, {
      artifactId: applied.artifactId,
      limit: 5,
      sessionId: "session:prov-a"
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.sessionId).toBe("session:prov-a");
    db.close();
  });
});

async function openDb() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-agent-access-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
