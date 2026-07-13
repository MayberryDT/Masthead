import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import { getSessionDossier } from "../sessionDossierRepository.ts";
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
import {
  buildPublishedDossierSnapshot,
  dossierSnapshotFingerprint
} from "../../../workbench/authoring/dossierSnapshot.ts";

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

  test("finds a published artifact by a body-only phrase", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Body search"
    });
    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-body-search", "Repair cache lock"),
      content: {
        fixSteps: ["Close the inherited descriptor before retrying."],
        rootCause: "orphaned flock descriptor after worker cancellation",
        title: "Repair cache lock"
      }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(
      searchPublishedArtifactCapsules(db, { q: "orphaned flock descriptor" }).artifacts.map(
        (entry) => entry.artifactId
      )
    ).toEqual([artifact.artifactId]);
  });

  test.each([
    ["title", "Canonical OAuth repair"],
    ["narrative", "callback state mismatch"],
    ["topic", "redirect-security"],
    ["technology", "TypeScript"],
    ["file", "callback-router"],
    ["tool", "oauth_probe"],
    ["verification", "callback smoke test"],
    ["attention", "stale client secret"]
  ])("indexes canonical dossier %s text explicitly", async (_label, query) => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:canonical-search",
      title: "Canonical OAuth repair"
    });
    const canonical = getSessionDossier(db, "session:canonical-search")!;
    const snapshot = buildPublishedDossierSnapshot(canonical, "2026-07-12T18:00:00.000Z");
    snapshot.narrative.objective = "Repair the callback state mismatch in the OAuth return path.";
    snapshot.narrative.topics = ["redirect-security"];
    snapshot.narrative.technologies = ["TypeScript"];
    snapshot.files[0]!.displayPath = "src/auth/callback-router.ts";
    snapshot.files[0]!.basename = "callback-router.ts";
    snapshot.tools[0]!.toolName = "oauth_probe";
    snapshot.verification = {
      commands: [],
      status: "passed",
      summary: "Verification passed with the callback smoke test."
    };
    snapshot.attention = [
      {
        detail: "The OAuth client secret must be replaced before deployment.",
        kind: "high_risk_change",
        severity: "P1",
        sourceRefs: [],
        title: "Rotate the stale client secret"
      }
    ];
    const artifact = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: snapshot,
      contentFingerprint: dossierSnapshotFingerprint(snapshot),
      createdBy: "workbench_authoring_v2:test",
      evidenceRefs: [],
      schemaVersion: snapshot.snapshotVersion,
      sessionId: snapshot.identity.sessionId,
      title: snapshot.identity.title,
      validation: { canonicalSnapshot: true }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(searchPublishedArtifactCapsules(db, { q: query }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
    db.close();
  });

  test("sanitizes FTS syntax and treats punctuation-only queries as unfiltered", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Sanitized search"
    });
    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-sanitized-search", "Repair parser"),
      content: { rootCause: "worker cancellation broke the parser", title: "Repair parser" }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(() => searchPublishedArtifactCapsules(db, { q: 'worker OR "unterminated' })).not.toThrow();
    expect(searchPublishedArtifactCapsules(db, { q: "worker*" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
    expect(searchPublishedArtifactCapsules(db, { q: "!!! (( ))" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
  });

  test("removes superseded artifacts from body search and indexes the published replacement", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Superseded search"
    });
    const first = applySessionArtifact(db, {
      ...runbookInput("fp-old-search", "Old runbook"),
      content: { rootCause: "legacy descriptor leak", title: "Old runbook" },
      signatureKey: "signature:descriptor-lock"
    });
    publishSessionArtifact(db, first.artifactId);
    expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor" }).total).toBe(1);

    const replacement = applySessionArtifact(db, {
      ...runbookInput("fp-new-search", "New runbook"),
      content: { rootCause: "replacement ownership race", title: "New runbook" },
      signatureKey: "signature:descriptor-lock"
    });

    expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor" }).total).toBe(0);
    expect(searchPublishedArtifactCapsules(db, { q: "replacement ownership" }).total).toBe(0);
    publishSessionArtifact(db, replacement.artifactId);
    expect(searchPublishedArtifactCapsules(db, { q: "replacement ownership" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: replacement.artifactId })
    ]);
  });

  test.each([
    { label: "blank", signatureKey: " " },
    { label: "different", signatureKey: "signature:different" }
  ])(
    "reindexes the persisted signature scope when a published fingerprint is reactivated with a $label signature",
    async ({ signatureKey }) => {
      const db = await testDb();
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: "session:a",
        title: "Original signature artifact"
      });
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: "session:b",
        title: "Replacement signature artifact"
      });
      const originalInput = {
        ...runbookInput("fp-reactivated", "Original runbook", "session:a"),
        content: { rootCause: "legacy descriptor ownership", title: "Original runbook" },
        signatureKey: "signature:descriptor-ownership"
      };
      const original = applySessionArtifact(db, originalInput);
      publishSessionArtifact(db, original.artifactId);
      const replacement = applySessionArtifact(db, {
        ...runbookInput("fp-replacement", "Replacement runbook", "session:b"),
        content: { rootCause: "replacement descriptor ownership", title: "Replacement runbook" },
        signatureKey: "signature:descriptor-ownership"
      });
      publishSessionArtifact(db, replacement.artifactId);

      const reactivated = applySessionArtifact(db, { ...originalInput, signatureKey });

      expect(reactivated).toMatchObject({ artifactId: original.artifactId, status: "current" });
      expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor ownership" }).artifacts).toEqual([
        expect.objectContaining({ artifactId: original.artifactId })
      ]);
      expect(searchPublishedArtifactCapsules(db, { q: "replacement descriptor ownership" }).total).toBe(0);
      expect(
        db
          .prepare(
            `SELECT artifact_id AS artifactId
             FROM session_artifact_search
             WHERE artifact_id IN (?, ?)
             ORDER BY artifact_id`
          )
          .all(original.artifactId, replacement.artifactId)
      ).toEqual([{ artifactId: original.artifactId }]);
      expect(listSessionArtifacts(db, { artifactKind: "runbook" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ artifactId: original.artifactId, status: "current" }),
          expect.objectContaining({ artifactId: replacement.artifactId, status: "superseded" })
        ])
      );
    }
  );

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
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifact_search").get()).toEqual({ count: 0 });
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
