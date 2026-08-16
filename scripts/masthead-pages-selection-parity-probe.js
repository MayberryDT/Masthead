#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs = [];

try {
  const [
    { listEligibleMastheadPagesArtifactIds },
    { explainMaterializedMastheadPagesSelection, resolveMaterializedMastheadPagesSelection },
    { compareMastheadPagesSelectionParity },
    { migrateDatabase },
    { applySessionArtifact, publishSessionArtifact },
    { openMastheadDatabase },
  ] = await Promise.all([
    builtImport("src/daemon/db/logbookArtifactRepository.js"),
    builtImport("src/daemon/db/mastheadPagesEligibilityRepository.js"),
    builtImport("src/daemon/db/mastheadPagesSelectionParity.js"),
    builtImport("src/daemon/db/schema.js"),
    builtImport("src/daemon/db/sessionArtifactRepository.js"),
    builtImport("src/daemon/db/sqlite.js"),
  ]);

  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-selection-parity-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

  try {
    migrateDatabase(db);
    seedCorpus(db, { applySessionArtifact, publishSessionArtifact });
    // Repair the deliberately changed provenance row before opening the read-only proof snapshot.
    const readiness = resolveMaterializedMastheadPagesSelection(db, {}, 500);
    assert(readiness.status === "complete", "materialization readiness failed");

    const scenarios = [
      {},
      { q: "parityneedle" },
      { project: "Masthead" },
      { dateFrom: "2026-08-15T12:00:00.000Z" },
      { dateTo: "2026-08-15T12:00:00.000Z" },
      {
        q: "parityneedle",
        project: "Masthead",
        dateFrom: "2026-08-14T00:00:00.000Z",
        dateTo: "2026-08-16T23:59:59.999Z",
      },
    ];
    const limits = [1, 2, 5, 25, 100, 500];
    const classificationCounts = {
      equal: 0,
      legacy_candidate_window_exhausted: 0,
      materialization_incomplete: 0,
      unaccepted_mismatch: 0,
    };
    const queryPlanEvidence = {
      scenarioCount: scenarios.length,
      planRowCount: 0,
      nonemptyPlanScenarioCount: 0,
      eligibilityIndexScenarioCount: 0,
      searchScenarioCount: scenarios.filter((query) => typeof query.q === "string").length,
      searchVirtualTableScenarioCount: 0,
      tempOrderScenarioCount: 0,
    };

    db.exec("BEGIN DEFERRED TRANSACTION;");
    try {
      for (const query of scenarios) {
        const plan = explainMaterializedMastheadPagesSelection(db, query, 500);
        assert(plan.length > 0, "query plan was empty");
        queryPlanEvidence.planRowCount += plan.length;
        queryPlanEvidence.nonemptyPlanScenarioCount += 1;
        const planDetails = plan
          .map((row) => row.detail)
          .filter((detail) => typeof detail === "string")
          .map((detail) => detail.toLowerCase());
        if (planDetails.some((detail) => detail.includes("eligibility") && detail.includes("index"))) {
          queryPlanEvidence.eligibilityIndexScenarioCount += 1;
        }
        const usesSearchVirtualTable = planDetails.some(
          (detail) => detail.includes("session_artifact_search") && detail.includes("virtual table"),
        );
        if (usesSearchVirtualTable) queryPlanEvidence.searchVirtualTableScenarioCount += 1;
        if (typeof query.q === "string") {
          assert(usesSearchVirtualTable, "FTS query plan did not use the search virtual table");
        }
        if (planDetails.some((detail) => detail.includes("temp b-tree"))) {
          queryPlanEvidence.tempOrderScenarioCount += 1;
        }
        for (const limit of limits) {
          const legacy = listEligibleMastheadPagesArtifactIds(db, query, limit);
          const materialized = resolveMaterializedMastheadPagesSelection(db, query, limit);
          assert(materialized.status === "complete", "materialized resolver was incomplete");
          assert(arraysEqual(legacy, materialized.artifactIds), "resolver output mismatch");

          const parity = compareMastheadPagesSelectionParity(db, query, limit);
          classificationCounts[parity.classification] += 1;
          assert(parity.accepted && parity.classification === "equal", "parity classification failed");
        }
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
    assert(
      queryPlanEvidence.nonemptyPlanScenarioCount === queryPlanEvidence.scenarioCount,
      "not every query-plan scenario was observed",
    );
    assert(
      queryPlanEvidence.searchVirtualTableScenarioCount === queryPlanEvidence.searchScenarioCount,
      "not every FTS query-plan scenario used the search virtual table",
    );

    const receipt = {
      receiptVersion: "masthead-pages-selection-parity-probe-v1",
      ok: true,
      snapshotCount: 1,
      corpusCategoryCounts: {
        eligible: 5,
        ineligible: 1,
        malformed: 1,
        superseded: 1,
        multipleProvenance: 1,
        appliedOnly: 1,
      },
      scenarioCount: scenarios.length * limits.length,
      classificationCounts,
      queryPlanEvidence: {
        scenarioCount: queryPlanEvidence.scenarioCount,
        planRowCount: queryPlanEvidence.planRowCount,
        allPlansNonempty:
          queryPlanEvidence.nonemptyPlanScenarioCount === queryPlanEvidence.scenarioCount,
        eligibilityIndexScenarioCount: queryPlanEvidence.eligibilityIndexScenarioCount,
        allSearchPlansUseVirtualTable:
          queryPlanEvidence.searchVirtualTableScenarioCount === queryPlanEvidence.searchScenarioCount,
        searchVirtualTableScenarioCount: queryPlanEvidence.searchVirtualTableScenarioCount,
        tempOrderScenarioCount: queryPlanEvidence.tempOrderScenarioCount,
      },
    };
    const serialized = JSON.stringify(receipt);
    assert(Buffer.byteLength(serialized, "utf8") <= 2_048, "receipt exceeded bound");
    assertPrivacySafeReceipt(receipt);
    console.log(serialized);
  } finally {
    db.close();
  }
} catch {
  console.error(JSON.stringify({ receiptVersion: "masthead-pages-selection-parity-probe-v1", ok: false }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
}

function builtImport(relativePath) {
  return import(pathToFileURL(join(root, "dist/daemon", relativePath)).href);
}

function seedCorpus(db, repositories) {
  seedArtifact(db, repositories, {
    publishedAt: "2026-08-13T12:00:00.000Z",
    sessionId: "session:boundary",
  });
  seedArtifact(db, repositories, {
    publishedAt: "2026-08-14T12:00:00.000Z",
    sessionId: "session:oldest",
  });
  seedArtifact(db, repositories, {
    publishedAt: "2026-08-15T12:00:00.000Z",
    sessionId: "session:middle",
  });
  seedArtifact(db, repositories, {
    project: "Other",
    publishedAt: "2026-08-16T09:00:00.000Z",
    sessionId: "session:other-project",
  });
  seedArtifact(db, repositories, {
    publishedAt: "2026-08-16T10:00:00.000Z",
    sessionId: "session:newest",
  });

  const ineligible = dossier("Masthead", "session:ineligible");
  ineligible.enrichment = { status: "failed" };
  seedArtifact(db, repositories, {
    content: ineligible,
    publishedAt: "2026-08-17T10:00:00.000Z",
    sessionId: "session:ineligible",
  });
  const malformed = dossier("Masthead", "session:malformed");
  malformed.snapshotVersion = "malformed-dossier";
  seedArtifact(db, repositories, {
    content: malformed,
    publishedAt: "2026-08-17T09:00:00.000Z",
    sessionId: "session:malformed",
  });
  const superseded = seedArtifact(db, repositories, {
    publishedAt: "2026-08-18T10:00:00.000Z",
    sessionId: "session:superseded",
  });
  db.prepare("UPDATE session_artifacts SET status = 'superseded' WHERE artifact_id = ?").run(superseded);
  seedArtifact(db, repositories, {
    publish: false,
    publishedAt: "2026-08-19T10:00:00.000Z",
    sessionId: "session:applied-only",
  });
  const multipleProvenance = seedArtifact(db, repositories, {
    publishedAt: "2026-08-17T08:00:00.000Z",
    sessionId: "session:multiple-provenance",
  });
  seedSession(db, "session:second-provenance", "Masthead");
  db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)")
    .run(multipleProvenance, "session:second-provenance");
  db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(multipleProvenance);
}

function seedArtifact(db, repositories, options) {
  const project = options.project ?? "Masthead";
  seedSession(db, options.sessionId, project);
  const applied = repositories.applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: options.content ?? dossier(project, options.sessionId),
    contentFingerprint: `fp-${options.sessionId}`,
    createdBy: "parity-probe",
    evidenceRefs: [],
    projectLabel: project,
    schemaVersion: "canonical-session-dossier-v1",
    sessionId: options.sessionId,
    summary: "Parityneedle summary",
    title: "Parityneedle dossier",
    validation: { ok: true },
  });
  if (options.publish !== false) {
    repositories.publishSessionArtifact(db, applied.artifactId);
    db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?")
      .run(options.publishedAt, options.publishedAt, applied.artifactId);
  }
  return applied.artifactId;
}

function seedSession(db, sessionId, project) {
  const now = "2026-08-16T00:00:00.000Z";
  db.prepare(
    "INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)",
  ).run("host:parity-probe", "parity-probe", now, now);
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).run("runtime:parity-probe", "codex", "probe", now, now);
  db.prepare(
    `INSERT INTO sessions (
       session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
       branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
       source_confidence, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "host:parity-probe",
    "runtime:parity-probe",
    `source:${sessionId}`,
    project,
    "/probe",
    "/probe",
    "main",
    "Parity probe",
    "Verify resolver parity",
    "ended",
    "completed",
    now,
    now,
    now,
    "authoritative",
    now,
    now,
  );
}

function dossier(project, sessionId) {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId,
      sourceSessionId: sessionId,
      title: "Parityneedle dossier",
      runtime: "codex",
      project,
      branch: "main",
      lifecycle: "ended",
    },
    narrative: {
      objective: "Verify selection parity",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["parity"],
      technologies: ["typescript"],
      unresolved: [],
    },
    files: [],
    tools: [],
    verification: { status: "passed", summary: "ok", commands: [] },
    attention: [],
    excerpts: [],
    enrichment: { status: "current" },
    durableEnrichment: {
      keywords: ["parityneedle", "eligible"],
      sessionTitle: {
        text: "Parityneedle dossier",
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionSummary: {
        text: "Parityneedle summary",
        state: "completed",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionDossier: {
        keyWork: ["Compare resolvers"],
        decisions: [],
        blockers: [],
        verification: { status: "passed", summary: "ok", commands: [], failures: [], evidenceRefs: [] },
        continuation: { openQuestions: [], constraints: [] },
        warnings: [],
        evidenceRefs: [],
      },
    },
  };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertPrivacySafeReceipt(receipt) {
  const forbiddenKeys = new Set([
    "artifactId",
    "artifactIds",
    "path",
    "paths",
    "body",
    "bodyText",
    "filter",
    "filters",
    "query",
    "queries",
    "digest",
    "digests",
    "sql",
    "detail",
    "filterValue",
    "filterValues",
    "planRows",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert(!forbiddenKeys.has(key), "receipt contained a forbidden field");
      if (typeof child === "string") {
        assert(
          key === "receiptVersion" && child === "masthead-pages-selection-parity-probe-v1",
          "receipt contained an unapproved string value",
        );
      } else {
        visit(child);
      }
    }
  };
  visit(receipt);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
