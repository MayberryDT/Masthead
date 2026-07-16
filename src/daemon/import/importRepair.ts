import { createHash } from "node:crypto";
import type {
  ImportRepairPreservationReason,
  ImportRepairJobPlan,
  ImportRepairPreview,
  ImportRepairReceipt,
  ImportRepairSourceMapping,
  ImportRepairSourcePlan
} from "../../shared/importRepair.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { recordImportRepairReplacements } from "../db/sessionImportHealthRepository.ts";
import { withImmediateTransaction } from "../db/sqlite.ts";
export type { ImportRepairPreview, ImportRepairReceipt } from "../../shared/importRepair.ts";

type IdRow = { id: string };

export function previewImportRepair(
  db: MastheadDatabase,
  input: { importJobIds: string[]; sourceMappings: ImportRepairSourceMapping[] }
): ImportRepairPreview {
  const importJobIds = normalizeIds(input.importJobIds);
  if (importJobIds.length === 0) throw new Error("at least one import job is required");
  requireImportJobs(db, importJobIds);
  const selected = placeholders(importJobIds);
  const sourcePlans = buildSourcePlans(db, importJobIds, input.sourceMappings);
  const impactedSessions = ids(
    db.prepare(`SELECT DISTINCT session_id AS id FROM import_session_impacts WHERE import_job_id IN (${selected}) ORDER BY session_id`)
      .all(...importJobIds) as IdRow[]
  );
  const selectedSourceIds = sourcePlans.map((source) => source.sourceId);
  const sourceLinkedSessions = selectedSourceIds.length === 0 ? [] : ids(
    db.prepare(`SELECT DISTINCT session_id AS id FROM session_sources WHERE source_id IN (${placeholders(selectedSourceIds)}) ORDER BY session_id`)
      .all(...selectedSourceIds) as IdRow[]
  );
  const affectedSessions = [...new Set([...impactedSessions, ...sourceLinkedSessions])].sort();
  const sourceLinkedOnly = new Set(sourceLinkedSessions.filter((sessionId) => !impactedSessions.includes(sessionId)));
  const unavailableSources = sourcePlans.filter((source) => !source.available).map((source) => source.sourceId);
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
  const outOfRangeSessionsToDefer = outOfRangeSessions(db, importJobIds);
  const createdSessions = new Set(affectedSessions.length === 0 ? [] : ids(
    db.prepare(`SELECT DISTINCT session_id AS id FROM import_session_impacts
      WHERE import_job_id IN (${selected}) AND impact_kind = 'created' ORDER BY session_id`).all(...importJobIds) as IdRow[]
  ));
  const blocked = new Set(blockedPublishedSessions);
  const deferred = new Set(outOfRangeSessionsToDefer);
  const manual = new Set(manualDecisionSessions(db, affectedSessions));
  const unavailable = new Set(sessionsWithUnavailableSources(db, importJobIds, sourcePlans));
  const ownershipBySession = new Map(affectedSessions.map((sessionId) => [
    sessionId,
    exclusivelyOwned(db, sessionId, importJobIds, sourcePlans.map((source) => source.sourceId))
  ]));
  const executionBlocked = new Set(affectedSessions.filter((sessionId) => {
    const reason = ownershipBySession.get(sessionId)?.reason;
    return blocked.has(sessionId) || manual.has(sessionId) || reason === "artifact_preserved" || reason === "live_state" || reason === "shared_ownership";
  }));
  const jobPlans = buildJobPlans(db, importJobIds, sourcePlans, executionBlocked);
  const indivisibleBlockedSessions = new Set(jobPlans.filter((job) => job.repairBlockReason)
    .flatMap((job) => relatedSessionsForJob(db, job.selectedJobId, job.originalSourceId)));
  const eligibleJobPlans = jobPlans.filter((job) => job.available && job.repairEligible);
  const reimportSources = [...new Set(eligibleJobPlans.map((job) => job.correctedSourceId!))].sort();
  const cursorSourcesToReset = [...new Set(eligibleJobPlans
    .flatMap((job) => [job.originalSourceId, job.correctedSourceId!]))].sort();
  const preservationReasons: ImportRepairPreservationReason[] = [];
  const pseudoSessionsToRemove = affectedSessions.filter((sessionId) =>
    createdSessions.has(sessionId) && !blocked.has(sessionId) && !indivisibleBlockedSessions.has(sessionId) && !deferred.has(sessionId) && !manual.has(sessionId) && !unavailable.has(sessionId) &&
      exclusivelyOwned(db, sessionId, importJobIds, sourcePlans.map((source) => source.sourceId)).owned
  );
  const removed = new Set(pseudoSessionsToRemove);
  const sessionsToReparse = affectedSessions.filter((sessionId) =>
    !sourceLinkedOnly.has(sessionId) && !removed.has(sessionId) && !blocked.has(sessionId) && !indivisibleBlockedSessions.has(sessionId) && !deferred.has(sessionId) &&
      !manual.has(sessionId) && !unavailable.has(sessionId)
  );
  for (const sessionId of affectedSessions) {
    const ownership = ownershipBySession.get(sessionId)!;
    const reason = blocked.has(sessionId) ? "published_artifact"
      : manual.has(sessionId) ? "manual_decision"
        : unavailable.has(sessionId) ? "source_unavailable"
          : deferred.has(sessionId) ? "out_of_range"
            : ownership.reason === "artifact_preserved" || ownership.reason === "live_state" || ownership.reason === "shared_ownership"
              ? ownership.reason
              : indivisibleBlockedSessions.has(sessionId) ? "blocked_session_in_indivisible_job"
                : sourceLinkedOnly.has(sessionId) ? "source_linked_only"
                  : ownership.reason;
    if (!removed.has(sessionId) && !sessionsToReparse.includes(sessionId) && reason) preservationReasons.push({ reason, sessionId });
  }
  const automaticSuppressionsToReopen = sessionsToReparse.length === 0 ? [] : ids(
    db.prepare(`SELECT session_id AS id FROM workbench_session_state
      WHERE session_id IN (${placeholders(sessionsToReparse)})
        AND publication_status = 'not_added_to_logbook'
        AND quality_decision_source = 'automatic'
        AND suppression_category IN ('confirmed_noise', 'insufficient_evidence')
      ORDER BY session_id`).all(...sessionsToReparse) as IdRow[]
  );
  const preservedSessions = affectedSessions.filter((sessionId) => !removed.has(sessionId) && !sessionsToReparse.includes(sessionId));
  const plan = {
    affectedArtifacts,
    affectedSessions,
    applyAllowed: blockedPublishedSessions.length === 0,
    automaticSuppressionsToReopen,
    blockedPublishedSessions,
    cursorSourcesToReset,
    importJobIds,
    jobPlans,
    outOfRangeSessionsToDefer,
    preservationReasons,
    preservedSessions,
    pseudoSessionsToRemove,
    reimportSources,
    sessionsToReparse,
    sourcePlans,
    unavailableSources
  };
  return { ...plan, planHash: hashPlan(plan) };
}

export function applyImportRepair(
  db: MastheadDatabase,
  input: {
    importJobIds: string[];
    planHash: string;
    sourceMappings: ImportRepairSourceMapping[];
    stageReimports?: (jobPlans: ImportRepairJobPlan[]) => string[];
  }
): ImportRepairReceipt {
  const preview = previewImportRepair(db, { importJobIds: input.importJobIds, sourceMappings: input.sourceMappings });
  if (preview.planHash !== input.planHash) throw new Error("repair plan changed");
  if (!preview.applyAllowed) throw new Error("published artifacts block repair");
  if (preview.reimportSources.length > 0 && !input.stageReimports) throw new Error("replacement job staging required");

  return withImmediateTransaction(db, () => {
    const lockedPreview = previewImportRepair(db, { importJobIds: input.importJobIds, sourceMappings: input.sourceMappings });
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
    if (lockedPreview.cursorSourcesToReset.length > 0) {
      db.prepare(`DELETE FROM ingest_cursors WHERE source_id IN (${placeholders(lockedPreview.cursorSourcesToReset)})`)
        .run(...lockedPreview.cursorSourcesToReset);
    }
    const viableJobPlans = lockedPreview.jobPlans.filter((job) => job.available && job.repairEligible);
    const reimportJobIds = input.stageReimports?.(viableJobPlans) ?? [];
    if (lockedPreview.reimportSources.length > 0 && reimportJobIds.length === 0) throw new Error("replacement job staging required");
    if (lockedPreview.reimportSources.length > 0 && !exactReimportsMatchPlans(db, reimportJobIds, viableJobPlans)) {
      throw new Error("exact replacement jobs required");
    }
    recordImportRepairReplacements(db, viableJobPlans.map((job, index) => ({
      originalImportJobId: job.selectedJobId,
      replacementImportJobId: reimportJobIds[index]!
    })));
    return {
      blockedPublishedSessions: lockedPreview.blockedPublishedSessions,
      cursorSourcesToReset: lockedPreview.cursorSourcesToReset,
      importJobIds: lockedPreview.importJobIds,
      planHash: lockedPreview.planHash,
      preservedSessions: lockedPreview.preservedSessions,
      reimportSources: lockedPreview.reimportSources,
      reimportJobIds,
      removedSessions: lockedPreview.pseudoSessionsToRemove,
      reopenedSuppressions: lockedPreview.automaticSuppressionsToReopen,
      resetSessions: lockedPreview.sessionsToReparse
    };
  });
}

function exactReimportsMatchPlans(db: MastheadDatabase, importJobIds: string[], plans: ImportRepairJobPlan[]): boolean {
  if (importJobIds.length !== plans.length) return false;
  const uniqueJobIds = [...new Set(importJobIds)];
  if (uniqueJobIds.length !== importJobIds.length) return false;
  return importJobIds.every((importJobId, index) => {
    const row = db.prepare(`SELECT source_id AS sourceId, import_kind AS importKind, scope_json AS scopeJson, status
      FROM import_jobs WHERE import_job_id = ?`).get(importJobId) as
      | { importKind: string; scopeJson: string | null; sourceId: string; status: string }
      | undefined;
    const plan = plans[index];
    return Boolean(row && plan && row.status === "queued" && row.sourceId === plan.correctedSourceId &&
      row.importKind === plan.importKind && normalizedScopeJson(row.scopeJson) === stableStringify(plan.scope));
  });
}

function normalizedScopeJson(value: string | null): string {
  return stableStringify(value ? JSON.parse(value) : null);
}

function exclusivelyOwned(
  db: MastheadDatabase,
  sessionId: string,
  jobIds: string[],
  sourceIds: string[]
): { owned: boolean; reason?: ImportRepairPreservationReason["reason"] } {
  const unselectedImpact = db.prepare(`SELECT 1 FROM import_session_impacts
    WHERE session_id = ? AND import_job_id NOT IN (${placeholders(jobIds)}) LIMIT 1`).get(sessionId, ...jobIds);
  if (unselectedImpact) return { owned: false, reason: "shared_ownership" };
  const foreignSource = sourceIds.length === 0 ? true : db.prepare(`SELECT 1 FROM session_sources
    WHERE session_id = ? AND source_id NOT IN (${placeholders(sourceIds)}) LIMIT 1`).get(sessionId, ...sourceIds);
  if (foreignSource) return { owned: false, reason: "shared_ownership" };
  const artifact = db.prepare(`SELECT 1 FROM session_artifact_provenance WHERE session_id = ?
    UNION SELECT 1 FROM session_artifacts WHERE session_id = ? LIMIT 1`).get(sessionId, sessionId);
  if (artifact) return { owned: false, reason: "artifact_preserved" };
  const live = db.prepare("SELECT 1 FROM live_state_reports WHERE canonical_session_id = ? LIMIT 1").get(sessionId);
  return live ? { owned: false, reason: "live_state" } : { owned: true };
}

function buildSourcePlans(db: MastheadDatabase, jobIds: string[], mappings: ImportRepairSourceMapping[]): ImportRepairSourcePlan[] {
  const rows = db.prepare(`SELECT import_job_id AS importJobId, source_id AS sourceId FROM import_jobs
    WHERE import_job_id IN (${placeholders(jobIds)}) ORDER BY source_id, import_job_id`)
    .all(...jobIds) as Array<{ importJobId: string; sourceId: string }>;
  const mappingBySource = new Map(mappings.map((mapping) => [mapping.sourceId, mapping]));
  const sourceIds = [...new Set(rows.map((row) => row.sourceId))].sort();
  return sourceIds.map((sourceId) => {
    const mapping = mappingBySource.get(sourceId);
    const viable = Boolean(mapping?.available && mapping.correctedSourceId && mapping.adapterRuntime);
    return {
      adapterRuntime: viable ? mapping!.adapterRuntime : undefined,
      available: viable,
      correctedSourceId: viable ? mapping!.correctedSourceId : undefined,
      importJobIds: rows.filter((row) => row.sourceId === sourceId).map((row) => row.importJobId),
      reason: viable ? undefined : mapping?.reason ?? "source_not_discovered",
      sourceId
    };
  });
}

function buildJobPlans(
  db: MastheadDatabase,
  jobIds: string[],
  sourcePlans: ImportRepairSourcePlan[],
  executionBlockedSessions: Set<string>
): ImportRepairJobPlan[] {
  const sourcePlanById = new Map(sourcePlans.map((plan) => [plan.sourceId, plan]));
  const rows = db.prepare(`SELECT import_job_id AS selectedJobId, source_id AS originalSourceId,
      import_kind AS importKind, scope_json AS scopeJson
    FROM import_jobs WHERE import_job_id IN (${placeholders(jobIds)}) ORDER BY import_job_id`)
    .all(...jobIds) as Array<{
      importKind: ImportRepairJobPlan["importKind"];
      originalSourceId: string;
      scopeJson: string | null;
      selectedJobId: string;
    }>;
  return rows.map((row) => {
    const source = sourcePlanById.get(row.originalSourceId)!;
    const relatedSessions = relatedSessionsForJob(db, row.selectedJobId, row.originalSourceId);
    const blockedSessionIds = relatedSessions.filter((sessionId) => executionBlockedSessions.has(sessionId));
    const storedScope = row.scopeJson ? JSON.parse(row.scopeJson) as ImportRepairJobPlan["scope"] : null;
    const scope = storedScope ?? (row.importKind === "transcript"
      ? { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 }
      : null);
    return {
      available: source.available,
      blockedSessionIds,
      correctedSourceId: source.correctedSourceId,
      importKind: row.importKind,
      originalSourceId: row.originalSourceId,
      repairBlockReason: blockedSessionIds.length > 0 ? "blocked_session_in_indivisible_job" : undefined,
      repairEligible: blockedSessionIds.length === 0,
      scope,
      selectedJobId: row.selectedJobId
    };
  });
}

function relatedSessionsForJob(db: MastheadDatabase, importJobId: string, sourceId: string): string[] {
  return ids(db.prepare(`SELECT session_id AS id FROM import_session_impacts WHERE import_job_id = ?
    UNION SELECT session_id AS id FROM session_sources WHERE source_id = ? ORDER BY id`)
    .all(importJobId, sourceId) as IdRow[]);
}

function sessionsWithUnavailableSources(db: MastheadDatabase, jobIds: string[], plans: ImportRepairSourcePlan[]): string[] {
  const unavailable = new Set(plans.filter((plan) => !plan.available).map((plan) => plan.sourceId));
  if (unavailable.size === 0) return [];
  const rows = db.prepare(`SELECT DISTINCT impacts.session_id AS id, COALESCE(impacts.source_id, jobs.source_id) AS sourceId
    FROM import_session_impacts impacts JOIN import_jobs jobs ON jobs.import_job_id = impacts.import_job_id
    WHERE impacts.import_job_id IN (${placeholders(jobIds)})`).all(...jobIds) as Array<IdRow & { sourceId: string }>;
  return [...new Set(rows.filter((row) => unavailable.has(row.sourceId)).map((row) => row.id))].sort();
}

function manualDecisionSessions(db: MastheadDatabase, sessionIds: string[]): string[] {
  if (sessionIds.length === 0) return [];
  return ids(db.prepare(`SELECT session_id AS id FROM workbench_session_state
    WHERE session_id IN (${placeholders(sessionIds)})
      AND (quality_decision_source = 'user' OR suppression_category = 'manual_exclusion') ORDER BY session_id`)
    .all(...sessionIds) as IdRow[]);
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
  return createHash("sha256").update(stableStringify(plan)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
