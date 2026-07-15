import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { applyImportRepair, previewImportRepair } from "../importRepair.ts";
import type { ImportRepairJobPlan } from "../../../shared/importRepair.ts";

const availableSources = [
  { adapterRuntime: "grok" as const, available: true, correctedSourceId: "source:grok", sourceId: "source:grok" },
  { adapterRuntime: "hermes" as const, available: true, correctedSourceId: "source:hermes", sourceId: "source:hermes" },
  { adapterRuntime: "grok" as const, available: true, correctedSourceId: "source:published", sourceId: "source:published" }
];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import repair", () => {
  test("repair preview scopes every deletion and reimport to selected import jobs without writing", async () => {
    const db = await repairDatabase();
    const before = databaseChanges(db);

    const preview = previewImportRepair(db, { importJobIds: ["job:hermes", "job:grok", "job:grok"], sourceMappings: availableSources });

    expect(preview).toMatchObject({
      importJobIds: ["job:grok", "job:hermes"],
      affectedSessions: ["session:grok-fragment", "session:hermes-old", "session:manual"],
      pseudoSessionsToRemove: ["session:grok-fragment"],
      sessionsToReparse: [],
      automaticSuppressionsToReopen: [],
      preservedSessions: ["session:hermes-old", "session:manual"],
      blockedPublishedSessions: [],
      reimportSources: ["source:grok"],
      sourcePlans: [
        expect.objectContaining({ available: true, correctedSourceId: "source:grok", sourceId: "source:grok" }),
        expect.objectContaining({ available: true, correctedSourceId: "source:hermes", sourceId: "source:hermes" })
      ],
      applyAllowed: true
    });
    expect(preview.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(databaseChanges(db)).toBe(before);
  });

  test("apply fails closed when the preview hash is wrong or its provenance drifts", async () => {
    const db = await repairDatabase();
    const input = { importJobIds: ["job:grok", "job:hermes"], sourceMappings: availableSources };
    expect(() => applyImportRepair(db, { ...input, planHash: "wrong" })).toThrow("repair plan changed");

    const preview = previewImportRepair(db, input);
    seedImpact(db, "job:other", "source:other", "session:grok-fragment", "updated");
    expect(() => applyImportRepair(db, { ...input, planHash: preview.planHash })).toThrow("repair plan changed");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("replacement-job staging failure rolls back cleanup", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"],
      planHash: preview.planHash,
      sourceMappings: availableSources,
      stageReimports: () => { throw new Error("stage failed"); }
    })).toThrow("stage failed");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("apply refuses viable cleanup without durable replacement-job staging", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: availableSources
    })).toThrow("replacement job staging required");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("apply rolls back when staging returns non-durable replacement ids", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: availableSources,
      stageReimports: () => ["job:not-durable"]
    })).toThrow("exact replacement jobs required");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("distinct corrected sources reset both original and corrected cursors", async () => {
    const db = await repairDatabase();
    const now = "2026-07-15T12:00:00.000Z";
    db.prepare(`INSERT INTO ingest_sources(source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at)
      VALUES ('source:grok:moved', 'grok', 'jsonl', '/tmp/moved.jsonl', 'heuristic', ?, ?)`).run(now, now);
    for (const sourceId of ["source:grok", "source:grok:moved"]) {
      db.prepare(`INSERT INTO ingest_cursors(cursor_id, source_id, byte_offset, updated_at) VALUES (?, ?, 10, ?)`)
        .run(`cursor:${sourceId}`, sourceId, now);
    }
    const mappings = [
      { adapterRuntime: "grok" as const, available: true, correctedSourceId: "source:grok:moved", sourceId: "source:grok" }
    ];
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: mappings });

    applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: mappings,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });

    expect(db.prepare("SELECT source_id FROM ingest_cursors ORDER BY source_id").all()).toEqual([]);
  });

  test("unrelated session arrival does not change the selected-job plan hash", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });
    expect(preview.preservedSessions).not.toContain("session:unrelated");
    seedSession(db, "session:unrelated-late", "codex", "unrelated-late");

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: availableSources,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    })).not.toThrow();
    expect(readSession(db, "session:unrelated-late")).toBeDefined();
  });

  test("selected job kind or scope drift changes the immutable plan hash", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });
    db.prepare("UPDATE import_jobs SET scope_json = ? WHERE import_job_id = 'job:grok'")
      .run(JSON.stringify({ includeChangedSinceCursor: true, mode: "transcript_full" }));

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: availableSources,
      stageReimports: (plans: ImportRepairJobPlan[]) => stageReplacementJobs(db, plans)
    })).toThrow("repair plan changed");
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
  });

  test("scope key order does not create a false execution-spec conflict", async () => {
    const db = await repairDatabase();
    db.prepare("UPDATE import_jobs SET scope_json = ? WHERE import_job_id = 'job:grok'")
      .run('{"mode":"transcript_recent","days":30,"includeChangedSinceCursor":true,"unitLimit":500}');
    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });
    db.prepare("UPDATE import_jobs SET scope_json = ? WHERE import_job_id = 'job:grok'")
      .run('{"unitLimit":500,"includeChangedSinceCursor":true,"days":30,"mode":"transcript_recent"}');

    expect(() => applyImportRepair(db, {
      importJobIds: ["job:grok"], planHash: preview.planHash, sourceMappings: availableSources,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    })).not.toThrow();
  });

  test("replacement jobs must match every selected execution spec exactly once", async () => {
    const missingDb = await repairDatabase();
    seedImpact(missingDb, "job:other", "source:other", "session:unrelated", "created");
    const missingMappings = [
      ...availableSources,
      { adapterRuntime: "codex" as const, available: true, correctedSourceId: "source:other", sourceId: "source:other" }
    ];
    const missingPreview = previewImportRepair(missingDb, { importJobIds: ["job:grok", "job:other"], sourceMappings: missingMappings });
    expect(() => applyImportRepair(missingDb, {
      importJobIds: missingPreview.importJobIds, planHash: missingPreview.planHash, sourceMappings: missingMappings,
      stageReimports: (plans: ImportRepairJobPlan[]) => stageReplacementJobs(missingDb, plans.slice(0, 1))
    })).toThrow("exact replacement jobs required");

    const wrongDb = await repairDatabase();
    const wrongPreview = previewImportRepair(wrongDb, { importJobIds: ["job:grok"], sourceMappings: availableSources });
    expect(() => applyImportRepair(wrongDb, {
      importJobIds: ["job:grok"], planHash: wrongPreview.planHash, sourceMappings: availableSources,
      stageReimports: (plans: ImportRepairJobPlan[]) => stageReplacementJobs(wrongDb, plans, { importKind: "metadata" })
    })).toThrow("exact replacement jobs required");

    const extraDb = await repairDatabase();
    const extraPreview = previewImportRepair(extraDb, { importJobIds: ["job:grok"], sourceMappings: availableSources });
    expect(() => applyImportRepair(extraDb, {
      importJobIds: ["job:grok"], planHash: extraPreview.planHash, sourceMappings: availableSources,
      stageReimports: (plans: ImportRepairJobPlan[]) => [
        ...stageReplacementJobs(extraDb, plans),
        ...stageReplacementJobs(extraDb, plans, { idSuffix: ":extra" })
      ]
    })).toThrow("exact replacement jobs required");
  });

  test("published provenance blocks apply and remains untouched", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:published", "source:published", "session:published", "created");

    const preview = previewImportRepair(db, { importJobIds: ["job:published"], sourceMappings: availableSources });

    expect(preview.applyAllowed).toBe(false);
    expect(preview.blockedPublishedSessions).toEqual(["session:published"]);
    expect(preview.affectedArtifacts).toEqual(["artifact:published"]);
    expect(() => applyImportRepair(db, { importJobIds: ["job:published"], planHash: preview.planHash, sourceMappings: availableSources })).toThrow(
      "published artifacts block repair"
    );
    expect(readSession(db, "session:published")).toBeDefined();
    expect(db.prepare("SELECT artifact_id FROM session_artifacts WHERE artifact_id = ?").get("artifact:published")).toBeDefined();
  });

  test("mixed plans preserve published sessions and continue independent eligible repairs", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:published", "source:published", "session:published", "created");
    const mappings = [
      ...availableSources,
      { adapterRuntime: "grok" as const, available: true, correctedSourceId: "source:published", sourceId: "source:published" }
    ];
    const preview = previewImportRepair(db, {
      importJobIds: ["job:grok", "job:published"],
      sourceMappings: mappings
    });

    expect(preview.applyAllowed).toBe(true);
    expect(preview.preservationReasons).toContainEqual({ reason: "published_artifact", sessionId: "session:published" });
    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: mappings,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });

    expect(receipt.removedSessions).toEqual(["session:grok-fragment"]);
    expect(receipt.reimportJobIds).toEqual(["job:replacement:job:grok"]);
    expect(readSession(db, "session:published")).toBeDefined();
    expect(db.prepare("SELECT artifact_id FROM session_artifacts WHERE artifact_id = ?").get("artifact:published")).toBeDefined();
  });

  test("a published session blocks its indivisible job while an independent safe job repairs", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:grok", "source:grok", "session:published", "updated");
    db.prepare(`INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at)
      VALUES ('session:published', 'source:grok', '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z')`).run();
    seedImpact(db, "job:other", "source:other", "session:unrelated", "created");
    const mappings = [
      ...availableSources,
      { adapterRuntime: "codex" as const, available: true, correctedSourceId: "source:other", sourceId: "source:other" }
    ];
    const preview = previewImportRepair(db, {
      importJobIds: ["job:grok", "job:other"],
      sourceMappings: mappings
    });

    expect(preview.jobPlans).toEqual([
      expect.objectContaining({
        blockedSessionIds: ["session:published"],
        repairBlockReason: "blocked_session_in_indivisible_job",
        repairEligible: false,
        selectedJobId: "job:grok"
      }),
      expect.objectContaining({ repairEligible: true, selectedJobId: "job:other" })
    ]);
    expect(preview.pseudoSessionsToRemove).toEqual(["session:unrelated"]);
    expect(preview.preservationReasons).toContainEqual({
      reason: "blocked_session_in_indivisible_job",
      sessionId: "session:grok-fragment"
    });

    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: mappings,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });
    expect(receipt.reimportJobIds).toEqual(["job:replacement:job:other"]);
    expect(readSession(db, "session:grok-fragment")).toBeDefined();
    expect(readSession(db, "session:published")).toBeDefined();
    expect(readSession(db, "session:unrelated")).toBeUndefined();
  });

  test("a manual decision blocks its indivisible job while an independent safe job repairs", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, {
      importJobIds: ["job:grok", "job:hermes"],
      sourceMappings: availableSources
    });

    expect(preview.jobPlans).toEqual([
      expect.objectContaining({ repairEligible: true, selectedJobId: "job:grok" }),
      expect.objectContaining({
        blockedSessionIds: ["session:manual"],
        repairBlockReason: "blocked_session_in_indivisible_job",
        repairEligible: false,
        selectedJobId: "job:hermes"
      })
    ]);
    expect(preview.sessionsToReparse).toEqual([]);
    expect(preview.automaticSuppressionsToReopen).toEqual([]);
    expect(preview.preservationReasons).toContainEqual({
      reason: "blocked_session_in_indivisible_job",
      sessionId: "session:hermes-old"
    });

    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: availableSources,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });
    expect(receipt.reimportJobIds).toEqual(["job:replacement:job:grok"]);
    expect(receipt.reopenedSuppressions).toEqual([]);
    expect(readSession(db, "session:hermes-old")).toBeDefined();
  });

  test("live state blocks its indivisible job while an independent safe job repairs", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:other", "source:other", "session:live-codex", "updated");
    seedImpact(db, "job:other", "source:other", "session:unrelated", "created");
    db.prepare(`INSERT INTO live_state_reports(report_id, runtime, source, source_session_id, canonical_session_id,
        state, authority, observed_at, created_at)
      VALUES ('report:live-repair', 'codex', 'test:codex', 'live', 'session:live-codex',
        'working', 'hook', '2026-07-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z')`).run();
    const mappings = [
      ...availableSources,
      { adapterRuntime: "codex" as const, available: true, correctedSourceId: "source:other", sourceId: "source:other" }
    ];
    const preview = previewImportRepair(db, {
      importJobIds: ["job:grok", "job:other"],
      sourceMappings: mappings
    });

    expect(preview.jobPlans).toEqual([
      expect.objectContaining({ repairEligible: true, selectedJobId: "job:grok" }),
      expect.objectContaining({
        blockedSessionIds: ["session:live-codex"],
        repairBlockReason: "blocked_session_in_indivisible_job",
        repairEligible: false,
        selectedJobId: "job:other"
      })
    ]);
    expect(preview.preservationReasons).toContainEqual({ reason: "live_state", sessionId: "session:live-codex" });
    expect(preview.preservationReasons).toContainEqual({
      reason: "blocked_session_in_indivisible_job",
      sessionId: "session:unrelated"
    });

    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: mappings,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });
    expect(receipt.reimportJobIds).toEqual(["job:replacement:job:grok"]);
    expect(readSession(db, "session:live-codex")).toBeDefined();
    expect(readSession(db, "session:unrelated")).toBeDefined();
  });

  test("apply repairs only safe indivisible jobs and preserves manual-scoped sessions", async () => {
    const db = await repairDatabase();
    const preview = previewImportRepair(db, { importJobIds: ["job:grok", "job:hermes"], sourceMappings: availableSources });

    const receipt = applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: availableSources,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });

    expect(receipt).toMatchObject({
      planHash: preview.planHash,
      removedSessions: ["session:grok-fragment"],
      resetSessions: [],
      reopenedSuppressions: [],
      reimportSources: ["source:grok"]
    });
    expect(readSession(db, "session:grok-fragment")).toBeUndefined();
    expect(readSession(db, "session:hermes-old")).toBeDefined();
    expect(readSession(db, "session:live-codex")).toBeDefined();
    expect(readSession(db, "session:manual")).toBeDefined();
    expect(readSession(db, "session:unrelated")).toBeDefined();
    expect(db.prepare("SELECT publication_status, suppression_category FROM workbench_session_state WHERE session_id = ?").get("session:hermes-old"))
      .toEqual({ publication_status: "not_added_to_logbook", suppression_category: "insufficient_evidence" });
    expect(db.prepare("SELECT publication_status, suppression_category FROM workbench_session_state WHERE session_id = ?").get("session:manual"))
      .toEqual({ publication_status: "not_added_to_logbook", suppression_category: "manual_exclusion" });
  });

  test("unavailable corrected sources preserve their sessions while available sources remain repairable", async () => {
    const db = await repairDatabase();
    const sourceMappings = [
      availableSources[0],
      { available: false as const, reason: "source_not_discovered" as const, sourceId: "source:hermes" }
    ];

    const preview = previewImportRepair(db, { importJobIds: ["job:grok", "job:hermes"], sourceMappings });

    expect(preview.pseudoSessionsToRemove).toEqual(["session:grok-fragment"]);
    expect(preview.sessionsToReparse).toEqual([]);
    expect(preview.reimportSources).toEqual(["source:grok"]);
    expect(preview.unavailableSources).toEqual(["source:hermes"]);
    expect(preview.preservationReasons).toContainEqual({ reason: "source_unavailable", sessionId: "session:hermes-old" });
    const driftedMappings = [...sourceMappings.slice(0, 1), availableSources[1]];
    expect(() => applyImportRepair(db, {
      importJobIds: preview.importJobIds,
      planHash: preview.planHash,
      sourceMappings: driftedMappings
    })).toThrow("repair plan changed");
  });

  test("source-linked-only sessions are included in planning and explicitly preserved", async () => {
    const db = await repairDatabase();
    seedSession(db, "session:source-only", "grok", "source-only");
    db.prepare("INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .run("session:source-only", "source:grok", "2026-07-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z");

    const preview = previewImportRepair(db, { importJobIds: ["job:grok"], sourceMappings: availableSources });

    expect(preview.affectedSessions).toContain("session:source-only");
    expect(preview.pseudoSessionsToRemove).not.toContain("session:source-only");
    expect(preview.sessionsToReparse).not.toContain("session:source-only");
    expect(preview.preservedSessions).toContain("session:source-only");
    expect(preview.preservationReasons).toContainEqual({ reason: "source_linked_only", sessionId: "session:source-only" });
  });

  test("affected manual decisions are explicitly preserved and never reopened or deleted", async () => {
    const db = await repairDatabase();
    seedImpact(db, "job:hermes", "source:hermes", "session:manual", "created");

    const preview = previewImportRepair(db, { importJobIds: ["job:hermes"], sourceMappings: availableSources });

    expect(preview.sessionsToReparse).not.toContain("session:manual");
    expect(preview.pseudoSessionsToRemove).not.toContain("session:manual");
    expect(preview.automaticSuppressionsToReopen).not.toContain("session:manual");
    expect(preview.preservationReasons).toContainEqual({ reason: "manual_decision", sessionId: "session:manual" });
  });

  test("deferred sessions keep automatic suppression and selected jobs remain immutable audit records", async () => {
    const db = await repairDatabase();
    seedImportUnit(db, "job:hermes", "source:hermes");
    db.prepare("UPDATE sessions SET last_activity_at = '2020-01-01T00:00:00.000Z' WHERE session_id = 'session:hermes-old'").run();
    db.prepare("UPDATE import_manifests SET scope_json = ? WHERE import_job_id = 'job:hermes'")
      .run(JSON.stringify({ days: 30, mode: "transcript_recent" }));

    const preview = previewImportRepair(db, { importJobIds: ["job:hermes"], sourceMappings: availableSources });
    expect(preview.outOfRangeSessionsToDefer).toEqual([]);
    seedImpact(db, "job:hermes", "source:hermes", "session:hermes-old", "created");
    const deferred = previewImportRepair(db, { importJobIds: ["job:hermes"], sourceMappings: availableSources });
    expect(deferred.outOfRangeSessionsToDefer).toEqual(["session:hermes-old"]);
    expect(deferred.automaticSuppressionsToReopen).not.toContain("session:hermes-old");

    applyImportRepair(db, {
      importJobIds: ["job:hermes"], planHash: deferred.planHash, sourceMappings: availableSources,
      stageReimports: (plans) => stageReplacementJobs(db, plans)
    });
    expect(db.prepare("SELECT status, status_reason FROM import_work_units WHERE import_job_id = 'job:hermes'").get())
      .toEqual({ status: "succeeded", status_reason: null });
    expect(db.prepare("SELECT publication_status, suppression_category FROM workbench_session_state WHERE session_id = 'session:hermes-old'").get())
      .toEqual({ publication_status: "not_added_to_logbook", suppression_category: "insufficient_evidence" });
  });
});

async function repairDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-repair-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  const now = "2026-07-15T12:00:00.000Z";
  db.prepare("INSERT INTO hosts(host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run("host:test", "test", now, now);
  for (const runtime of ["grok", "hermes", "codex"]) {
    db.prepare("INSERT INTO runtimes(runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(`runtime:${runtime}`, runtime, now, now);
  }
  for (const [sourceId, runtime] of [["source:grok", "grok"], ["source:hermes", "hermes"], ["source:other", "codex"], ["source:published", "grok"]]) {
    db.prepare(`INSERT INTO ingest_sources(source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at)
      VALUES (?, ?, 'jsonl', ?, 'authoritative', ?, ?)`).run(sourceId, runtime, `/tmp/${sourceId}`, now, now);
  }
  for (const [jobId, sourceId] of [["job:grok", "source:grok"], ["job:hermes", "source:hermes"], ["job:other", "source:other"], ["job:published", "source:published"]]) {
    db.prepare("INSERT INTO import_jobs(import_job_id, source_id, import_kind, status, updated_at) VALUES (?, ?, 'transcript', 'succeeded', ?)")
      .run(jobId, sourceId, now);
  }
  seedSession(db, "session:grok-fragment", "grok", "fragment");
  seedSession(db, "session:hermes-old", "hermes", "old");
  seedSession(db, "session:live-codex", "codex", "live");
  seedSession(db, "session:unrelated", "codex", "unrelated");
  seedSession(db, "session:manual", "hermes", "manual");
  seedSession(db, "session:published", "grok", "published");
  seedImpact(db, "job:grok", "source:grok", "session:grok-fragment", "created");
  seedImpact(db, "job:hermes", "source:hermes", "session:hermes-old", "updated");
  for (const [sessionId, sourceId] of [["session:grok-fragment", "source:grok"], ["session:hermes-old", "source:hermes"], ["session:manual", "source:hermes"], ["session:published", "source:published"]]) {
    db.prepare("INSERT INTO session_sources(session_id, source_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(sessionId, sourceId, now, now);
  }
  db.prepare(`INSERT INTO workbench_session_state(session_id, publication_status, next_action, quality_status, non_publication_reason,
      suppression_category, quality_decision_source)
    VALUES (?, 'not_added_to_logbook', 'none', 'failed', 'partial_parse', 'insufficient_evidence', 'automatic')`).run("session:hermes-old");
  db.prepare(`INSERT INTO workbench_session_state(session_id, publication_status, next_action, quality_status, non_publication_reason,
      suppression_category, quality_decision_source)
    VALUES (?, 'not_added_to_logbook', 'none', 'failed', 'user_suppressed', 'manual_exclusion', 'user')`).run("session:manual");
  db.prepare(`INSERT INTO session_artifacts(artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
      created_by, schema_version, content_json, evidence_refs_json, validation_json, publication_status, lineage_id)
    VALUES ('artifact:published', 'session:published', 'session_dossier', 'current', 'sha256:x', ?, ?, 'test', 'v1', '{}', '[]', '{}', 'published', 'artifact:published')`)
    .run(now, now);
  db.prepare("INSERT INTO session_artifact_provenance(artifact_id, session_id) VALUES ('artifact:published', 'session:published')").run();
  return db;
}

function seedSession(db: MastheadDatabase, sessionId: string, runtime: string, sourceSessionId: string): void {
  const now = "2026-07-15T12:00:00.000Z";
  db.prepare(`INSERT INTO sessions(session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at)
    VALUES (?, 'host:test', ?, ?, 'unknown', ?, 'authoritative', ?, ?)`).run(sessionId, `runtime:${runtime}`, sourceSessionId, now, now, now);
}

function seedImpact(db: MastheadDatabase, jobId: string, sourceId: string, sessionId: string, kind: "created" | "updated"): void {
  db.prepare(`INSERT INTO import_session_impacts(impact_id, import_job_id, source_id, runtime_kind, session_id, impact_kind, observed_at)
    VALUES (?, ?, ?, 'grok', ?, ?, '2026-07-15T12:00:00.000Z')`).run(`impact:${jobId}:${sessionId}:${kind}`, jobId, sourceId, sessionId, kind);
}

function readSession(db: MastheadDatabase, sessionId: string): unknown {
  return db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(sessionId);
}

function databaseChanges(db: MastheadDatabase): number {
  return (db.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes;
}

function seedImportUnit(db: MastheadDatabase, jobId: string, sourceId: string): void {
  db.prepare(`INSERT INTO import_manifests(manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json, generated_at)
    VALUES (?, ?, ?, 'hermes', 'transcript', ?, '2026-07-15T12:00:00.000Z')`)
    .run(`manifest:${jobId}`, jobId, sourceId, JSON.stringify({ mode: "transcript_all" }));
  db.prepare(`INSERT INTO import_work_units(work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, status, source_path)
    VALUES (?, ?, ?, ?, 'hermes', 'jsonl', 'authoritative', 'transcript_file', 'succeeded', '/tmp/hermes.jsonl')`)
    .run(`unit:${jobId}`, `manifest:${jobId}`, jobId, sourceId);
}

function stageReplacementJobs(
  db: MastheadDatabase,
  plans: ImportRepairJobPlan[],
  overrides: { idSuffix?: string; importKind?: "metadata" | "transcript" } = {}
): string[] {
  return plans.map((plan) => {
    const importJobId = `job:replacement:${plan.selectedJobId}${overrides.idSuffix ?? ""}`;
    db.prepare(`INSERT INTO import_jobs(import_job_id, source_id, import_kind, status, scope_json, updated_at)
      VALUES (?, ?, ?, 'queued', ?, '2026-07-15T12:30:00.000Z')`)
      .run(importJobId, plan.correctedSourceId!, overrides.importKind ?? plan.importKind, plan.scope ? JSON.stringify(plan.scope) : null);
    return importJobId;
  });
}
