import { createHash } from "node:crypto";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { withImmediateTransaction } from "../db/sqlite.ts";

export type ImportRepairPreview = {
  importJobIds: string[];
  affectedSessions: string[];
  pseudoSessionsToRemove: string[];
  sessionsToReparse: string[];
  automaticSuppressionsToReopen: string[];
  outOfRangeSessionsToDefer: string[];
  preservedSessions: string[];
  blockedPublishedSessions: string[];
  affectedArtifacts: string[];
  reimportSources: string[];
  applyAllowed: boolean;
  planHash: string;
};

export type ImportRepairReceipt = {
  importJobIds: string[];
  planHash: string;
  removedSessions: string[];
  resetSessions: string[];
  reopenedSuppressions: string[];
  preservedSessions: string[];
  blockedPublishedSessions: string[];
  reimportSources: string[];
};

type IdRow = { id: string };

export function previewImportRepair(
  db: MastheadDatabase,
  input: { importJobIds: string[] }
): ImportRepairPreview {
  const importJobIds = normalizeIds(input.importJobIds);
  if (importJobIds.length === 0) throw new Error("at least one import job is required");
  requireImportJobs(db, importJobIds);
  const selected = placeholders(importJobIds);
  const affectedSessions = ids(
    db.prepare(`SELECT DISTINCT session_id AS id FROM import_session_impacts WHERE import_job_id IN (${selected}) ORDER BY session_id`)
      .all(...importJobIds) as IdRow[]
  );
  const reimportSources = ids(
    db.prepare(`SELECT DISTINCT source_id AS id FROM import_jobs WHERE import_job_id IN (${selected}) ORDER BY source_id`)
      .all(...importJobIds) as IdRow[]
  );
  const affectedArtifacts = affectedSessions.length === 0 ? [] : ids(
    db.prepare(`SELECT artifact_id AS id FROM session_artifact_provenance WHERE session_id IN (${placeholders(affectedSessions)})
      UNION SELECT artifact_id AS id FROM session_artifacts WHERE session_id IN (${placeholders(affectedSessions)}) ORDER BY id`)
      .all(...affectedSessions, ...affectedSessions) as IdRow[]
  );
  const blockedPublishedSessions = affectedSessions.length === 0 ? [] : ids(
    db.prepare(`SELECT provenance.session_id AS id FROM session_artifact_provenance provenance
      JOIN session_artifacts artifacts ON artifacts.artifact_id = provenance.artifact_id
      WHERE provenance.session_id IN (${placeholders(affectedSessions)}) AND artifacts.publication_status = 'published'
      UNION SELECT session_id AS id FROM session_artifacts
      WHERE session_id IN (${placeholders(affectedSessions)}) AND publication_status = 'published'
      ORDER BY id`).all(...affectedSessions, ...affectedSessions) as IdRow[]
  );
  const automaticSuppressionsToReopen = affectedSessions.length === 0 ? [] : ids(
    db.prepare(`SELECT session_id AS id FROM workbench_session_state
      WHERE session_id IN (${placeholders(affectedSessions)})
        AND publication_status = 'not_added_to_logbook'
        AND quality_decision_source = 'automatic'
        AND suppression_category IN ('confirmed_noise', 'insufficient_evidence')
      ORDER BY session_id`).all(...affectedSessions) as IdRow[]
  );
  const outOfRangeSessionsToDefer = outOfRangeSessions(db, importJobIds);
  const createdSessions = new Set(affectedSessions.length === 0 ? [] : ids(
    db.prepare(`SELECT DISTINCT session_id AS id FROM import_session_impacts
      WHERE import_job_id IN (${selected}) AND impact_kind = 'created' ORDER BY session_id`).all(...importJobIds) as IdRow[]
  ));
  const blocked = new Set(blockedPublishedSessions);
  const deferred = new Set(outOfRangeSessionsToDefer);
  const pseudoSessionsToRemove = affectedSessions.filter((sessionId) =>
    createdSessions.has(sessionId) && !blocked.has(sessionId) && !deferred.has(sessionId) && exclusivelyOwned(db, sessionId, importJobIds, reimportSources)
  );
  const removed = new Set(pseudoSessionsToRemove);
  const sessionsToReparse = affectedSessions.filter((sessionId) => !removed.has(sessionId) && !blocked.has(sessionId) && !deferred.has(sessionId));
  const allSessions = ids(db.prepare("SELECT session_id AS id FROM sessions ORDER BY session_id").all() as IdRow[]);
  const preservedSessions = allSessions.filter((sessionId) => !removed.has(sessionId) && !sessionsToReparse.includes(sessionId));
  const plan = {
    affectedArtifacts,
    affectedSessions,
    applyAllowed: blockedPublishedSessions.length === 0,
    automaticSuppressionsToReopen,
    blockedPublishedSessions,
    importJobIds,
    outOfRangeSessionsToDefer,
    preservedSessions,
    pseudoSessionsToRemove,
    reimportSources,
    sessionsToReparse
  };
  return { ...plan, planHash: hashPlan(plan) };
}

export function applyImportRepair(
  db: MastheadDatabase,
  input: { importJobIds: string[]; planHash: string }
): ImportRepairReceipt {
  const preview = previewImportRepair(db, { importJobIds: input.importJobIds });
  if (preview.planHash !== input.planHash) throw new Error("repair plan changed");
  if (!preview.applyAllowed) throw new Error("published artifacts block repair");

  return withImmediateTransaction(db, () => {
    const lockedPreview = previewImportRepair(db, { importJobIds: input.importJobIds });
    if (lockedPreview.planHash !== input.planHash) throw new Error("repair plan changed");
    for (const sessionId of lockedPreview.automaticSuppressionsToReopen) {
      db.prepare(`UPDATE workbench_session_state SET publication_status = 'publish_path', next_action = 'review_quality',
        quality_status = 'unchecked', non_publication_reason = NULL, suppression_category = NULL,
        quality_decision_source = 'automatic', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`).run(sessionId);
    }
    for (const sessionId of lockedPreview.pseudoSessionsToRemove) {
      db.prepare("DELETE FROM session_search WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    }
    const jobs = placeholders(lockedPreview.importJobIds);
    db.prepare(`UPDATE import_work_units SET status = 'queued', status_reason = 'import_repair', cursor_after_json = NULL,
      processed_records = 0, imported_records = 0, skipped_records = 0, failed_records = 0,
      heartbeat_at = NULL, started_at = NULL, finished_at = NULL, failure_group_id = NULL, summary_json = NULL
      WHERE import_job_id IN (${jobs})`).run(...lockedPreview.importJobIds);
    if (lockedPreview.reimportSources.length > 0) {
      db.prepare(`DELETE FROM ingest_cursors WHERE source_id IN (${placeholders(lockedPreview.reimportSources)})`)
        .run(...lockedPreview.reimportSources);
    }
    return {
      blockedPublishedSessions: [],
      importJobIds: lockedPreview.importJobIds,
      planHash: lockedPreview.planHash,
      preservedSessions: lockedPreview.preservedSessions,
      reimportSources: lockedPreview.reimportSources,
      removedSessions: lockedPreview.pseudoSessionsToRemove,
      reopenedSuppressions: lockedPreview.automaticSuppressionsToReopen,
      resetSessions: lockedPreview.sessionsToReparse
    };
  });
}

function exclusivelyOwned(db: MastheadDatabase, sessionId: string, jobIds: string[], sourceIds: string[]): boolean {
  const unselectedImpact = db.prepare(`SELECT 1 FROM import_session_impacts
    WHERE session_id = ? AND import_job_id NOT IN (${placeholders(jobIds)}) LIMIT 1`).get(sessionId, ...jobIds);
  if (unselectedImpact) return false;
  const foreignSource = sourceIds.length === 0 ? true : db.prepare(`SELECT 1 FROM session_sources
    WHERE session_id = ? AND source_id NOT IN (${placeholders(sourceIds)}) LIMIT 1`).get(sessionId, ...sourceIds);
  if (foreignSource) return false;
  const artifact = db.prepare(`SELECT 1 FROM session_artifact_provenance WHERE session_id = ?
    UNION SELECT 1 FROM session_artifacts WHERE session_id = ? LIMIT 1`).get(sessionId, sessionId);
  if (artifact) return false;
  const live = db.prepare("SELECT 1 FROM live_state_reports WHERE canonical_session_id = ? LIMIT 1").get(sessionId);
  return !live;
}

function outOfRangeSessions(db: MastheadDatabase, jobIds: string[]): string[] {
  const rows = db.prepare(`SELECT DISTINCT impacts.session_id AS sessionId, sessions.last_activity_at AS lastActivityAt,
      manifests.scope_json AS scopeJson, manifests.generated_at AS generatedAt
    FROM import_session_impacts impacts
    JOIN sessions ON sessions.session_id = impacts.session_id
    JOIN import_manifests manifests ON manifests.import_job_id = impacts.import_job_id
    WHERE impacts.import_job_id IN (${placeholders(jobIds)}) AND impacts.impact_kind = 'created'`)
    .all(...jobIds) as Array<{ generatedAt: string; lastActivityAt: string; scopeJson: string; sessionId: string }>;
  return [...new Set(rows.filter((row) => {
    const scope = JSON.parse(row.scopeJson) as { days?: number; mode?: string };
    if (scope.mode !== "transcript_recent" || scope.days === undefined) return false;
    return new Date(row.lastActivityAt).getTime() < new Date(row.generatedAt).getTime() - scope.days * 86_400_000;
  }).map((row) => row.sessionId))].sort();
}

function requireImportJobs(db: MastheadDatabase, jobIds: string[]): void {
  const found = ids(db.prepare(`SELECT import_job_id AS id FROM import_jobs WHERE import_job_id IN (${placeholders(jobIds)}) ORDER BY import_job_id`)
    .all(...jobIds) as IdRow[]);
  const missing = jobIds.filter((id) => !found.includes(id));
  if (missing.length > 0) throw new Error(`import jobs not found: ${missing.join(", ")}`);
}

function normalizeIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function ids(rows: IdRow[]): string[] {
  return rows.map((row) => row.id);
}

function hashPlan(plan: Omit<ImportRepairPreview, "planHash">): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}
