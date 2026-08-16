import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { PublishedSessionDossierV1 } from "../../../shared/sessionDossier.ts";
import { parseMastheadPagesSelectionResolverMode } from "../../../mastheadPages/selection.ts";
import { listEligibleMastheadPagesArtifactIds } from "../logbookArtifactRepository.ts";
import {
  MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
  MASTHEAD_PAGES_SELECTION_LIMIT,
  getMastheadPagesArtifactEligibility,
  resolveMaterializedMastheadPagesSelection
} from "../mastheadPagesEligibilityRepository.ts";
import {
  classifyMastheadPagesSelectionParity,
  compareMastheadPagesSelectionParity,
  legacyMastheadPagesCandidateWindowSize,
  type MastheadPagesSelectionParityProof
} from "../mastheadPagesSelectionParity.ts";
import { migrateDatabase } from "../schema.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

const scenarios = [
  { name: "no filter", query: {} },
  { name: "search", query: { q: "parityneedle" } },
  { name: "project", query: { project: "Masthead" } },
  { name: "date lower", query: { dateFrom: "2026-08-15T12:00:00.000Z" } },
  { name: "date upper", query: { dateTo: "2026-08-15T12:00:00.000Z" } },
  {
    name: "combined filters",
    query: {
      q: "parityneedle",
      project: "Masthead",
      dateFrom: "2026-08-14T00:00:00.000Z",
      dateTo: "2026-08-16T23:59:59.999Z"
    }
  }
] as const;

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Masthead Pages selection cutover parity", () => {
  test("defaults unknown resolver modes to legacy and accepts only the exact materialized opt-in", () => {
    expect(parseMastheadPagesSelectionResolverMode(undefined)).toBe("legacy");
    expect(parseMastheadPagesSelectionResolverMode("legacy")).toBe("legacy");
    expect(parseMastheadPagesSelectionResolverMode("materialized")).toBe("materialized");
    expect(parseMastheadPagesSelectionResolverMode("MATERIALIZED")).toBe("legacy");
    expect(parseMastheadPagesSelectionResolverMode("future")).toBe("legacy");
    expect(parseMastheadPagesSelectionResolverMode({ mode: "materialized" })).toBe("legacy");
  });

  test("preserves common ordering, filters, admission, eligibility, and limits through 500", async () => {
    const db = await testDb();
    const corpus = seedCompleteCorpus(db);
    const expectedByScenario: Record<(typeof scenarios)[number]["name"], string[]> = {
      "no filter": [corpus.newest, corpus.otherProject, corpus.middle, corpus.oldest, corpus.boundary],
      search: [corpus.newest, corpus.otherProject, corpus.middle, corpus.oldest, corpus.boundary],
      project: [corpus.newest, corpus.middle, corpus.oldest, corpus.boundary],
      "date lower": [corpus.newest, corpus.otherProject, corpus.middle],
      "date upper": [corpus.middle, corpus.oldest, corpus.boundary],
      "combined filters": [corpus.newest, corpus.middle, corpus.oldest]
    };
    expect(MASTHEAD_PAGES_SELECTION_LIMIT).toBe(500);

    for (const scenario of scenarios) {
      const expected = expectedByScenario[scenario.name];
      for (const limit of [1, 2, 3, 5, 25, 100, MASTHEAD_PAGES_SELECTION_LIMIT]) {
        const limited = expected.slice(0, limit);
        expect(listEligibleMastheadPagesArtifactIds(db, scenario.query, limit), `${scenario.name} legacy ${limit}`)
          .toEqual(limited);
        expect(resolveMaterializedMastheadPagesSelection(db, scenario.query, limit), `${scenario.name} materialized ${limit}`)
          .toEqual({ artifactIds: limited, status: "complete" });
        expect(compareMastheadPagesSelectionParity(db, scenario.query, limit), `${scenario.name} parity ${limit}`)
          .toMatchObject({
            accepted: true,
            classification: "equal",
            legacyArtifactIds: limited,
            materializedResult: { artifactIds: limited, status: "complete" }
          });
      }
    }

    expect(corpus.categories).toEqual({
      appliedOnly: expect.any(String),
      eligible: 5,
      ineligible: expect.any(String),
      malformed: expect.any(String),
      multipleProvenance: expect.any(String),
      superseded: expect.any(String)
    });
    expect(getMastheadPagesArtifactEligibility(db, corpus.newest)).toMatchObject({ status: "eligible" });
    expect(getMastheadPagesArtifactEligibility(db, corpus.categories.appliedOnly)).toMatchObject({
      status: "eligible"
    });
    expect(getMastheadPagesArtifactEligibility(db, corpus.categories.superseded)).toMatchObject({
      status: "eligible"
    });
    expect(getMastheadPagesArtifactEligibility(db, corpus.categories.ineligible)).toMatchObject({
      reasonCode: "current_enrichment_required",
      status: "ineligible"
    });
    expect(getMastheadPagesArtifactEligibility(db, corpus.categories.malformed)).toMatchObject({
      reasonCode: "unsupported_schema",
      status: "ineligible"
    });
    expect(getMastheadPagesArtifactEligibility(db, corpus.categories.multipleProvenance)).toMatchObject({
      reasonCode: "single_session_dossier_required",
      status: "ineligible"
    });
  });

  test("reports retained old-policy history without blocking equal current-policy results", async () => {
    const db = await testDb();
    const selected = seedArtifact(db, {
      publishedAt: "2026-08-16T12:00:00.000Z",
      sessionId: "session:retained-policy-history",
      title: "Parityneedle dossier"
    });
    db.prepare(
      `INSERT INTO masthead_pages_artifact_eligibility
         (artifact_id, policy_version, status, reason_code, evaluated_at)
       VALUES (?, 'retained-policy-v0', 'ineligible', 'unsupported_schema', ?)`
    ).run(selected, "2026-08-15T12:00:00.000Z");

    expect(compareMastheadPagesSelectionParity(db)).toMatchObject({
      accepted: true,
      classification: "equal",
      diagnosticCounts: {
        duplicate: 0,
        error: 0,
        impossible: 0,
        missing: 0,
        orphaned: 0,
        stale_policy: 1
      },
      legacyArtifactIds: [selected],
      materializedResult: { artifactIds: [selected], status: "complete" }
    });
  });

  test("blocks cutover when materialization is incomplete", async () => {
    const db = await testDb();
    const selected = seedArtifact(db, {
      publishedAt: "2026-08-16T12:00:00.000Z",
      sessionId: "session:incomplete",
      title: "Parityneedle dossier"
    });
    db.prepare(
      `UPDATE masthead_pages_artifact_eligibility
       SET status = 'error', reason_code = 'eligibility_evaluation_error'
       WHERE artifact_id = ? AND policy_version = ?`
    ).run(selected, MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION);

    expect(compareMastheadPagesSelectionParity(db)).toMatchObject({
      accepted: false,
      classification: "materialization_incomplete",
      legacyArtifactIds: [selected],
      materializedResult: {
        artifactIds: [],
        reason: "eligibility_evaluation_failed",
        retryable: false,
        status: "incomplete"
      }
    });
  });

  test("rejects arbitrary reorder and omission even when handed an otherwise affirmative proof", () => {
    const proof = {
      filtersMatched: true,
      legacyCandidateWindowExhausted: true,
      legacyCandidateWindowSize: 8,
      legacyResultUnderfilled: true,
      materializedOrderAndCapVerified: true,
      newOnlyArtifactIds: [],
      newOnlyArtifactsEligibleUnderCurrentPolicy: true,
      newOnlyArtifactsStrictlyAfterLegacyWindow: true,
      orderedPrefixPreserved: true,
      requestedLimit: 2
    } satisfies MastheadPagesSelectionParityProof;

    expect(classifyMastheadPagesSelectionParity(
      ["artifact:alpha", "artifact:beta"],
      { artifactIds: ["artifact:beta", "artifact:alpha"], status: "complete" },
      proof
    )).toEqual({ accepted: false, classification: "unaccepted_mismatch" });
    expect(classifyMastheadPagesSelectionParity(
      ["artifact:alpha", "artifact:beta"],
      { artifactIds: ["artifact:alpha"], status: "complete" },
      proof
    )).toEqual({ accepted: false, classification: "unaccepted_mismatch" });
  });

  test("accepts only a reproducibly exhausted legacy candidate window", async () => {
    const db = await testDb();
    const candidateWindowSize = legacyMastheadPagesCandidateWindowSize(1);
    expect(candidateWindowSize).toBe(4);
    for (let index = 0; index < candidateWindowSize; index += 1) {
      const content = eligibleDossier("Parityneedle dossier", "Masthead", `session:window-ineligible-${index}`);
      content.enrichment = { status: "failed" };
      seedArtifact(db, {
        content,
        publishedAt: `2026-08-16T1${index}:00:00.000Z`,
        sessionId: `session:window-ineligible-${index}`,
        title: "Parityneedle dossier"
      });
    }
    const beyondLegacyWindow = seedArtifact(db, {
      publishedAt: "2026-08-15T12:00:00.000Z",
      sessionId: "session:beyond-window",
      title: "Parityneedle dossier"
    });

    expect(listEligibleMastheadPagesArtifactIds(db, {}, 1)).toEqual([]);
    expect(resolveMaterializedMastheadPagesSelection(db, {}, 1)).toEqual({
      artifactIds: [beyondLegacyWindow],
      status: "complete"
    });
    expect(compareMastheadPagesSelectionParity(db, {}, 1)).toMatchObject({
      accepted: true,
      classification: "legacy_candidate_window_exhausted",
      legacyArtifactIds: [],
      materializedResult: { artifactIds: [beyondLegacyWindow], status: "complete" },
      proof: {
        filtersMatched: true,
        legacyCandidateWindowExhausted: true,
        legacyCandidateWindowSize: candidateWindowSize,
        legacyResultUnderfilled: true,
        materializedOrderAndCapVerified: true,
        newOnlyArtifactIds: [beyondLegacyWindow],
        newOnlyArtifactsEligibleUnderCurrentPolicy: true,
        newOnlyArtifactsStrictlyAfterLegacyWindow: true,
        orderedPrefixPreserved: true,
        requestedLimit: 1
      }
    });
  });
});

type SeedArtifactOptions = {
  content?: PublishedSessionDossierV1 | Record<string, unknown>;
  project?: string;
  publish?: boolean;
  publishedAt: string;
  sessionId: string;
  title: string;
};

function seedCompleteCorpus(db: MastheadDatabase) {
  const boundary = seedArtifact(db, {
    publishedAt: "2026-08-13T12:00:00.000Z",
    sessionId: "session:boundary",
    title: "Parityneedle dossier"
  });
  const oldest = seedArtifact(db, {
    publishedAt: "2026-08-14T12:00:00.000Z",
    sessionId: "session:oldest",
    title: "Parityneedle dossier"
  });
  const middle = seedArtifact(db, {
    publishedAt: "2026-08-15T12:00:00.000Z",
    sessionId: "session:middle",
    title: "Parityneedle dossier"
  });
  const otherProject = seedArtifact(db, {
    project: "Other",
    publishedAt: "2026-08-16T09:00:00.000Z",
    sessionId: "session:other-project",
    title: "Parityneedle dossier"
  });
  const newest = seedArtifact(db, {
    publishedAt: "2026-08-16T10:00:00.000Z",
    sessionId: "session:newest",
    title: "Parityneedle dossier"
  });

  const ineligibleContent = eligibleDossier("Parityneedle dossier", "Masthead", "session:ineligible");
  ineligibleContent.enrichment = { status: "failed" };
  const ineligible = seedArtifact(db, {
    content: ineligibleContent,
    publishedAt: "2026-08-17T10:00:00.000Z",
    sessionId: "session:ineligible",
    title: "Parityneedle dossier"
  });
  const malformed = seedArtifact(db, {
    content: {
      ...eligibleDossier("Parityneedle dossier", "Masthead", "session:malformed"),
      snapshotVersion: "malformed-dossier"
    } as unknown as Record<string, unknown>,
    publishedAt: "2026-08-17T09:00:00.000Z",
    sessionId: "session:malformed",
    title: "Parityneedle dossier"
  });
  const superseded = seedArtifact(db, {
    publishedAt: "2026-08-18T10:00:00.000Z",
    sessionId: "session:superseded",
    title: "Parityneedle dossier"
  });
  db.prepare("UPDATE session_artifacts SET status = 'superseded' WHERE artifact_id = ?").run(superseded);
  const appliedOnly = seedArtifact(db, {
    publish: false,
    publishedAt: "2026-08-19T10:00:00.000Z",
    sessionId: "session:applied-only",
    title: "Parityneedle dossier"
  });
  const multipleProvenance = seedArtifact(db, {
    publishedAt: "2026-08-17T08:00:00.000Z",
    sessionId: "session:multiple-provenance",
    title: "Parityneedle dossier"
  });
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:second-provenance",
    title: "Second provenance"
  });
  db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)")
    .run(multipleProvenance, "session:second-provenance");
  db.prepare(
    "DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ? AND policy_version = ?"
  ).run(multipleProvenance, MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION);

  return {
    boundary,
    categories: { appliedOnly, eligible: 5, ineligible, malformed, multipleProvenance, superseded },
    middle,
    newest,
    oldest,
    otherProject
  };
}

function seedArtifact(db: MastheadDatabase, options: SeedArtifactOptions): string {
  const project = options.project ?? "Masthead";
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project,
    sessionId: options.sessionId,
    title: options.title
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: options.content ?? eligibleDossier(options.title, project, options.sessionId),
    contentFingerprint: `fp-${options.sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    projectLabel: project,
    schemaVersion: "canonical-session-dossier-v1",
    sessionId: options.sessionId,
    summary: "Parityneedle summary",
    title: options.title,
    validation: { ok: true }
  });
  if (options.publish !== false) {
    publishSessionArtifact(db, applied.artifactId);
    db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?")
      .run(options.publishedAt, options.publishedAt, applied.artifactId);
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
      objective: "Exercise parityneedle selection",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["parity"],
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
      keywords: ["parityneedle", "eligible"],
      sessionTitle: { text: title, basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: "Parityneedle summary", state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Compare resolvers"],
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
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-selection-parity-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
