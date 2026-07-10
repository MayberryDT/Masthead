import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import {
  applySessionArtifact,
  applySessionArtifactInTransaction,
  listSessionArtifacts,
  publishSessionArtifact,
  publishSessionArtifactInTransaction,
  searchPublishedArtifactCapsules,
  wipePublishedArtifactState
} from "../sessionArtifactRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session artifact repository", () => {
  test("applies artifacts idempotently by fingerprint", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));

    expect(second.artifactId).toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: first.artifactId, publicationStatus: "applied", status: "current", title: "First dossier" })
    ]);
  });

  test("lets a caller roll back apply and publish in one owned transaction", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Atomic artifact"
    });

    db.exec("BEGIN IMMEDIATE;");
    const applied = applySessionArtifactInTransaction(db, artifactInput("atomic-fingerprint", "Atomic dossier"));
    publishSessionArtifactInTransaction(db, applied.artifactId);
    db.exec("ROLLBACK;");

    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([]);
  });

  test("normalizes signature keys at the repository persistence boundary", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Signature normalization"
    });

    const signed = applySessionArtifact(db, {
      ...runbookInput("signature-normalized", "Normalized signature"),
      signatureKey: "  signature:cache-lock  "
    });
    const unsigned = applySessionArtifact(db, {
      ...runbookInput("signature-blank", "Blank signature"),
      signatureKey: " \t "
    });

    expect(signed.signatureKey).toBe("signature:cache-lock");
    expect(unsigned.signatureKey).toBeUndefined();
  });

  test("supersedes prior current artifact for the same session and kind", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-2", "Second dossier"));

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: second.artifactId, status: "current", title: "Second dossier" }),
      expect.objectContaining({ artifactId: first.artifactId, status: "superseded", title: "First dossier" })
    ]);
  });

  test("stores multi-session provenance and requires join rationale", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    expect(() =>
      applySessionArtifact(db, {
        ...runbookInput("fp-multi", "Shared runbook", "session:a"),
        provenanceSessionIds: ["session:a", "session:b"]
      })
    ).toThrow(/joinRationale/i);

    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-multi", "Shared runbook", "session:a"),
      joinRationale: "shared error signature: ENOENT cache lock",
      provenanceSessionIds: ["session:a", "session:b"]
    });

    expect(artifact.provenanceSessionIds).toEqual(["session:a", "session:b"]);
    expect(artifact.joinRationale).toContain("ENOENT");
    expect(listSessionArtifacts(db, { sessionId: "session:b" })[0]?.artifactId).toBe(artifact.artifactId);
  });

  test("rejects multi-session provenance for session_dossier", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    expect(() =>
      applySessionArtifact(db, {
        ...artifactInput("fp", "Dossier"),
        joinRationale: "nope",
        provenanceSessionIds: ["session:a", "session:b"]
      })
    ).toThrow(/exactly one session/i);
  });

  test("supersedes by signature key across sessions and preserves lineage", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    const first = applySessionArtifact(db, {
      ...runbookInput("fp-1", "Runbook v1", "session:a"),
      signatureKey: "sig:cache-lock"
    });
    const second = applySessionArtifact(db, {
      ...runbookInput("fp-2", "Runbook v2", "session:b"),
      joinRationale: "same failure signature",
      provenanceSessionIds: ["session:a", "session:b"],
      signatureKey: "sig:cache-lock"
    });

    expect(second.lineageId).toBe(first.lineageId);
    expect(listSessionArtifacts(db, { artifactKind: "runbook" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: second.artifactId, status: "current", title: "Runbook v2" }),
        expect.objectContaining({ artifactId: first.artifactId, status: "superseded", title: "Runbook v1" })
      ])
    );
  });

  test("publish makes artifact searchable in Logbook capsules only after publish", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const applied = applySessionArtifact(db, {
      ...runbookInput("fp-pub", "Published runbook"),
      projectLabel: "Masthead",
      summary: "Fix cache lock races"
    });
    expect(searchPublishedArtifactCapsules(db).total).toBe(0);

    const published = publishSessionArtifact(db, applied.artifactId)!;
    expect(published.publicationStatus).toBe("published");
    expect(published.publishedAt).toBeTruthy();

    const search = searchPublishedArtifactCapsules(db, { kind: "runbook", q: "cache" });
    expect(search.total).toBe(1);
    expect(search.artifacts[0]).toMatchObject({
      artifactId: applied.artifactId,
      kind: "runbook",
      project: "Masthead",
      title: "Published runbook"
    });
  });

  test("filters published artifacts by published_at dateFrom/dateTo bounds", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    // Publish each before applying the next so applied drafts are not superseded.
    const early = applySessionArtifact(db, {
      ...runbookInput("fp-early", "Early runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, early.artifactId);
    const mid = applySessionArtifact(db, {
      ...runbookInput("fp-mid", "Mid runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, mid.artifactId);
    const late = applySessionArtifact(db, {
      ...runbookInput("fp-late", "Late runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, late.artifactId);

    setPublishedAt(db, early.artifactId, "2026-06-01T12:00:00.000Z");
    setPublishedAt(db, mid.artifactId, "2026-06-15T12:00:00.000Z");
    setPublishedAt(db, late.artifactId, "2026-06-30T12:00:00.000Z");

    const fromOnly = searchPublishedArtifactCapsules(db, { dateFrom: "2026-06-15" });
    expect(fromOnly.total).toBe(2);
    expect(fromOnly.artifacts.map((a) => a.artifactId).sort()).toEqual([late.artifactId, mid.artifactId].sort());

    const toOnly = searchPublishedArtifactCapsules(db, { dateTo: "2026-06-15" });
    expect(toOnly.total).toBe(2);
    expect(toOnly.artifacts.map((a) => a.artifactId).sort()).toEqual([early.artifactId, mid.artifactId].sort());

    const range = searchPublishedArtifactCapsules(db, {
      dateFrom: "2026-06-10",
      dateTo: "2026-06-20"
    });
    expect(range.total).toBe(1);
    expect(range.artifacts[0]?.artifactId).toBe(mid.artifactId);

    const isoRange = searchPublishedArtifactCapsules(db, {
      dateFrom: "2026-06-15T00:00:00.000Z",
      dateTo: "2026-06-15T23:59:59.999Z"
    });
    expect(isoRange.total).toBe(1);
    expect(isoRange.artifacts[0]?.artifactId).toBe(mid.artifactId);
  });

  test("wipe removes artifacts and provenance for dogfood cutover", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });
    const artifact = applySessionArtifact(db, runbookInput("fp-wipe", "Wipe me"));
    publishSessionArtifact(db, artifact.artifactId);

    const result = wipePublishedArtifactState(db);
    expect(result.artifactsDeleted).toBeGreaterThan(0);
    expect(listSessionArtifacts(db)).toEqual([]);
    expect(searchPublishedArtifactCapsules(db).total).toBe(0);
  });
});

function artifactInput(contentFingerprint: string, title: string) {
  return {
    artifactKind: "session_dossier" as const,
    content: { title },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: ["message:session:abc:message"],
    schemaVersion: "session_dossier-v1",
    sessionId: "session:abc",
    title,
    validation: { ok: true }
  };
}

function runbookInput(contentFingerprint: string, title: string, sessionId = "session:abc") {
  return {
    artifactKind: "runbook" as const,
    content: { title, problemSignature: { symptoms: ["lock busy"], errorStrings: ["EBUSY"], affectedScope: "cache" } },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: [`message:${sessionId}:message`],
    schemaVersion: "runbook-v1",
    sessionId,
    title,
    validation: { ok: true }
  };
}

function setPublishedAt(db: MastheadDatabase, artifactId: string, publishedAt: string): void {
  db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?").run(
    publishedAt,
    publishedAt,
    artifactId
  );
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-artifact-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
