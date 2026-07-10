import { randomUUID } from "node:crypto";
import type { WorkbenchAuthoringRunDto } from "../../shared/workbenchAuthoring.ts";
import { stableRecordId } from "../identity.ts";
import { listSessionArtifacts, publishSessionArtifact } from "./sessionArtifactRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { getWorkbenchAuthoringRun } from "./workbenchAuthoringRepository.ts";

export type WorkbenchPublicationStatus = "publish_path" | "published" | "not_added_to_logbook";
export type WorkbenchNextAction =
  | "check_transcript"
  | "import_transcript"
  | "review_quality"
  | "enrich"
  | "create_dossier"
  | "publish"
  | "active"
  | "blocked"
  | "none";
export type WorkbenchTranscriptStatus = "unchecked" | "available" | "imported" | "missing" | "permission_needed";
export type WorkbenchQualityStatus = "unchecked" | "passed" | "failed";
export type WorkbenchRequirementStatus = "missing" | "satisfied";
/** Optional automatic kinds: runbook, ADR, incident timeline. */
export type WorkbenchOptionalKindStatus = "unknown" | "required" | "satisfied" | "not_applicable" | "contributed";
/** @deprecated Use WorkbenchOptionalKindStatus / runbookStatus. Kept for transitional call sites. */
export type WorkbenchBugFixTraceStatus = WorkbenchOptionalKindStatus;
export type WorkbenchSessionPackageStatus = "missing" | "applied" | "published";
export type WorkbenchResolutionStatus = "in_progress" | "compile_ready" | "automatic_resolved";
export type WorkbenchActor = { kind: "agent" | "system" | "user"; id?: string };
export type WorkbenchAutomaticKind = "runbook" | "adr" | "incident_timeline";
export type WorkbenchArtifactKind = "session_dossier" | WorkbenchAutomaticKind;

export type WorkbenchClaimRecord = {
  claimId: string;
  sessionId: string;
  claimKind: "publish_path";
  claimedBy: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt?: string;
  releaseReason?: string;
};

export type WorkbenchClaimBatch = { claims: WorkbenchClaimRecord[] };

export type WorkbenchSessionStateRecord = {
  sessionId: string;
  publicationStatus: WorkbenchPublicationStatus;
  nextAction: WorkbenchNextAction;
  transcriptStatus: WorkbenchTranscriptStatus;
  qualityStatus: WorkbenchQualityStatus;
  sessionEnrichmentStatus: WorkbenchRequirementStatus;
  sessionDossierStatus: WorkbenchRequirementStatus;
  /** @deprecated Prefer runbookStatus */
  bugFixTraceStatus: WorkbenchOptionalKindStatus;
  runbookStatus: WorkbenchOptionalKindStatus;
  adrStatus: WorkbenchOptionalKindStatus;
  incidentTimelineStatus: WorkbenchOptionalKindStatus;
  sessionPackageStatus: WorkbenchSessionPackageStatus;
  resolutionStatus: WorkbenchResolutionStatus;
  nonPublicationReason?: string;
  publishedAt?: string;
  publishedActivityId?: string;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt: string;
  activeClaim?: WorkbenchClaimRecord;
};

export type WorkbenchActivityRecord = {
  activityId: string;
  sessionId: string;
  eventType: string;
  eventAt: string;
  actorKind: WorkbenchActor["kind"];
  actorId?: string;
  summary: string;
  details: Record<string, unknown>;
  relatedRunId?: string;
  relatedClaimId?: string;
};

export type WorkbenchPublicationGate =
  | "transcript"
  | "quality"
  | "session_enrichment"
  | "session_dossier"
  | "runbook"
  | "adr"
  | "incident_timeline";

export type PublishWorkbenchSessionResult =
  | {
      ok: true;
      state: WorkbenchSessionStateRecord;
      activity: WorkbenchActivityRecord;
    }
  | {
      ok: false;
      code: "publication_gate_failed";
      missing: WorkbenchPublicationGate[];
      state: WorkbenchSessionStateRecord;
    };

export type WorkbenchEnrollResult = {
  enrolled: boolean;
  sessionId: string;
  state?: WorkbenchSessionStateRecord;
};

export type WorkbenchEnrollMissingResult = {
  enrolled: number;
  skippedExisting: number;
  enrolledSessionIds: string[];
  limit: number;
};

type WorkbenchSessionStateRow = {
  sessionId: string;
  publicationStatus: WorkbenchPublicationStatus;
  nextAction: WorkbenchNextAction;
  transcriptStatus: WorkbenchTranscriptStatus;
  qualityStatus: WorkbenchQualityStatus;
  sessionEnrichmentStatus: WorkbenchRequirementStatus;
  sessionDossierStatus: WorkbenchRequirementStatus;
  bugFixTraceStatus: WorkbenchOptionalKindStatus;
  runbookStatus: WorkbenchOptionalKindStatus;
  adrStatus: WorkbenchOptionalKindStatus;
  incidentTimelineStatus: WorkbenchOptionalKindStatus;
  sessionPackageStatus: WorkbenchSessionPackageStatus;
  resolutionStatus: WorkbenchResolutionStatus;
  nonPublicationReason: string | null;
  publishedAt: string | null;
  publishedActivityId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const WORKBENCH_STATE_SELECT = `SELECT
  session_id AS sessionId,
  publication_status AS publicationStatus,
  next_action AS nextAction,
  transcript_status AS transcriptStatus,
  quality_status AS qualityStatus,
  session_enrichment_status AS sessionEnrichmentStatus,
  session_dossier_status AS sessionDossierStatus,
  COALESCE(runbook_status, bug_fix_trace_status) AS bugFixTraceStatus,
  COALESCE(runbook_status, bug_fix_trace_status) AS runbookStatus,
  COALESCE(adr_status, 'unknown') AS adrStatus,
  COALESCE(incident_timeline_status, 'unknown') AS incidentTimelineStatus,
  COALESCE(session_package_status, 'missing') AS sessionPackageStatus,
  COALESCE(resolution_status, 'in_progress') AS resolutionStatus,
  non_publication_reason AS nonPublicationReason,
  published_at AS publishedAt,
  published_activity_id AS publishedActivityId,
  last_activity_at AS lastActivityAt,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM workbench_session_state`;

type WorkbenchActivityRow = {
  activityId: string;
  sessionId: string;
  eventType: string;
  eventAt: string;
  actorKind: WorkbenchActor["kind"];
  actorId: string | null;
  summary: string;
  detailsJson: string;
  relatedRunId: string | null;
  relatedClaimId: string | null;
};

type WorkbenchClaimRow = {
  claimId: string;
  sessionId: string;
  claimKind: "publish_path";
  claimedBy: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
};

export function ensureWorkbenchSessionState(db: MastheadDatabase, sessionId: string): WorkbenchSessionStateRecord {
  const existing = readWorkbenchSessionState(db, sessionId);
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workbench_session_state (
      session_id, publication_status, next_action, transcript_status, quality_status,
      session_enrichment_status, session_dossier_status, bug_fix_trace_status,
      created_at, updated_at
    ) VALUES (?, 'publish_path', 'check_transcript', 'unchecked', 'unchecked', 'missing', 'missing', 'unknown', ?, ?)`
  ).run(sessionId, now, now);
  return readWorkbenchSessionState(db, sessionId)!;
}

/** Create publish_path state only when no workbench_session_state row exists. Never demotes published/not_added. */
export function enrollWorkbenchSession(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): WorkbenchEnrollResult {
  const existing = readWorkbenchSessionState(db, input.sessionId);
  if (existing) {
    return { enrolled: false, sessionId: input.sessionId, state: existing };
  }
  try {
    // ensure creates publish_path / check_transcript defaults
    const state = ensureWorkbenchSessionState(db, input.sessionId);
    return { enrolled: true, sessionId: input.sessionId, state };
  } catch (error) {
    // INSERT race: unique session_id — re-read and report not newly enrolled
    const raced = readWorkbenchSessionState(db, input.sessionId);
    if (raced) {
      return { enrolled: false, sessionId: input.sessionId, state: raced };
    }
    throw error;
  }
}

/** Enroll non-deleted sessions that have never entered Workbench (no pipeline row). */
export function enrollMissingWorkbenchSessions(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; limit?: number }
): WorkbenchEnrollMissingResult {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 500), 2000));

  const skippedExisting = (
    db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM sessions s
         INNER JOIN workbench_session_state w ON w.session_id = s.session_id
         WHERE s.deleted_at IS NULL`
      )
      .get() as { c: number }
  ).c;

  const missing = db
    .prepare(
      `SELECT s.session_id AS sessionId
       FROM sessions s
       LEFT JOIN workbench_session_state w ON w.session_id = s.session_id
       WHERE w.session_id IS NULL
         AND s.deleted_at IS NULL
       ORDER BY COALESCE(s.last_activity_at, s.updated_at, s.created_at) DESC, s.session_id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ sessionId: string }>;

  const enrolledSessionIds: string[] = [];
  for (const row of missing) {
    const result = enrollWorkbenchSession(db, { actor: input.actor, sessionId: row.sessionId });
    if (result.enrolled) enrolledSessionIds.push(row.sessionId);
  }

  const result: WorkbenchEnrollMissingResult = {
    enrolled: enrolledSessionIds.length,
    skippedExisting,
    enrolledSessionIds,
    limit
  };

  if (enrolledSessionIds.length > 0) {
    recordWorkbenchActivity(db, {
      actor: input.actor,
      details: {
        enrolled: result.enrolled,
        enrolledSessionIds: enrolledSessionIds.slice(0, 20),
        limit,
        skippedExisting
      },
      eventType: "enroll_missing_completed",
      sessionId: enrolledSessionIds[0]!,
      summary: `Enrolled ${result.enrolled} missing session${result.enrolled === 1 ? "" : "s"} into Workbench`
    });
  }

  return result;
}

export function readWorkbenchSessionState(db: MastheadDatabase, sessionId: string): WorkbenchSessionStateRecord | undefined {
  const row = db.prepare(`${WORKBENCH_STATE_SELECT} WHERE session_id = ?`).get(sessionId) as WorkbenchSessionStateRow | undefined;
  return row ? stateRowToRecord(db, row) : undefined;
}

export function markWorkbenchPublished(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; publishedVia: string; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const existing = readWorkbenchSessionState(db, input.sessionId);
  if (existing?.publicationStatus === "published" && existing.publishedActivityId) {
    const activity = readWorkbenchActivity(db, existing.publishedActivityId);
    if (activity) return { activity, state: existing };
  }
  const now = new Date().toISOString();
  const activityId = stableRecordId("workbench_activity", [input.sessionId, "published", input.publishedVia]);
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    const activity = insertWorkbenchActivity(db, {
      activityId,
      actor: input.actor,
      details: { publishedVia: input.publishedVia },
      eventAt: now,
      eventType: "published",
      sessionId: input.sessionId,
      summary: "Session published to Logbook"
    });
    db.prepare(
      `UPDATE workbench_session_state
      SET publication_status = 'published',
        session_package_status = 'published',
        non_publication_reason = NULL,
        published_at = ?,
        published_activity_id = ?,
        last_activity_at = ?,
        updated_at = ?
      WHERE session_id = ?`
    ).run(now, activity.activityId, now, now, input.sessionId);
    // Session package publish admits the current session dossier into the artifact book.
    for (const artifact of listSessionArtifacts(db, {
      artifactKind: "session_dossier",
      sessionId: input.sessionId
    })) {
      if (artifact.status === "current" && artifact.publicationStatus !== "published") {
        publishSessionArtifact(db, artifact.artifactId);
      }
    }
    refreshResolutionAndNextAction(db, input.sessionId, now);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function publishWorkbenchSession(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): PublishWorkbenchSessionResult {
  const state = ensureWorkbenchSessionState(db, input.sessionId);
  const missing = publicationGateFailures(state);
  if (missing.length > 0) {
    return { code: "publication_gate_failed", missing, ok: false, state };
  }
  const result = markWorkbenchPublished(db, {
    actor: input.actor,
    publishedVia: "workbench_publish",
    sessionId: input.sessionId
  });
  return { activity: result.activity, ok: true, state: result.state };
}

export function markWorkbenchNotAdded(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; reason: string; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const existing = readWorkbenchSessionState(db, input.sessionId);
  if (existing?.publicationStatus === "not_added_to_logbook") {
    const existingReason = existing.nonPublicationReason ?? input.reason;
    const activity = readWorkbenchActivity(
      db,
      stableRecordId("workbench_activity", [input.sessionId, "not_added_to_logbook", existingReason])
    );
    if (activity) return { activity, state: existing };
  }
  const now = new Date().toISOString();
  const activityId = stableRecordId("workbench_activity", [input.sessionId, "not_added_to_logbook", input.reason]);
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    const activity = insertWorkbenchActivity(db, {
      activityId,
      actor: input.actor,
      details: { reason: input.reason },
      eventAt: now,
      eventType: "not_added_to_logbook",
      sessionId: input.sessionId,
      summary: "Session not added to Logbook"
    });
    db.prepare(
      `UPDATE workbench_session_state
      SET publication_status = 'not_added_to_logbook',
        next_action = 'none',
        non_publication_reason = ?,
        last_activity_at = ?,
        updated_at = ?
      WHERE session_id = ?`
    ).run(input.reason, now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function markWorkbenchQuality(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    sessionId: string;
    status: "passed" | "failed";
    reason?: string;
  }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  return writeStateTransition(db, () => {
    if (input.status === "passed") {
      return applyWorkbenchQualityPassedInTransaction(db, input);
    }

    const now = new Date().toISOString();
    const current = ensureWorkbenchSessionState(db, input.sessionId);
    if (current.publicationStatus === "published") {
      throw new Error("cannot_fail_quality_on_published_session");
    }

    const reason = input.reason?.trim() || "quality_failed";
    db.prepare(
      `UPDATE workbench_session_state
       SET quality_status = 'failed',
           publication_status = 'not_added_to_logbook',
           next_action = 'none',
           non_publication_reason = ?,
           updated_at = ?
       WHERE session_id = ?`
    ).run(reason, now, input.sessionId);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, "quality_failed", now]),
      actor: input.actor,
      details: { reason },
      eventAt: now,
      eventType: "quality_failed",
      sessionId: input.sessionId,
      summary: "Quality failed; not added to Logbook"
    });
    db.prepare(`UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?`).run(
      now,
      now,
      input.sessionId
    );
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function markWorkbenchQualityPassedInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): void {
  applyWorkbenchQualityPassedInTransaction(db, input);
}

function applyWorkbenchQualityPassedInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  const current = ensureWorkbenchSessionState(db, input.sessionId);
  // Re-admit failed / not-added sessions to the publish path. Leave published rows published.
  if (current.publicationStatus === "published") {
    db.prepare(
      `UPDATE workbench_session_state
       SET quality_status = 'passed', non_publication_reason = NULL, updated_at = ?
       WHERE session_id = ?`
    ).run(now, input.sessionId);
  } else {
    db.prepare(
      `UPDATE workbench_session_state
       SET quality_status = 'passed',
           publication_status = 'publish_path',
           non_publication_reason = NULL,
           updated_at = ?
       WHERE session_id = ?`
    ).run(now, input.sessionId);
    updateWorkbenchNextAction(db, input.sessionId, now);
  }
  const activity = insertWorkbenchActivity(db, {
    activityId: stableRecordId("workbench_activity", [input.sessionId, "quality_passed", now]),
    actor: input.actor,
    details: {},
    eventAt: now,
    eventType: "quality_passed",
    sessionId: input.sessionId,
    summary: "Quality accepted"
  });
  db.prepare(`UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?`).run(
    now,
    now,
    input.sessionId
  );
  return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
}

export function recordWorkbenchActivity(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    details?: Record<string, unknown>;
    eventType: string;
    relatedClaimId?: string;
    relatedRunId?: string;
    sessionId: string;
    summary: string;
  }
): WorkbenchActivityRecord {
  const now = new Date().toISOString();
  return insertWorkbenchActivity(db, {
    activityId: stableRecordId("workbench_activity", [input.sessionId, input.eventType, now]),
    actor: input.actor,
    details: input.details ?? {},
    eventAt: now,
    eventType: input.eventType,
    relatedClaimId: input.relatedClaimId,
    relatedRunId: input.relatedRunId,
    sessionId: input.sessionId,
    summary: input.summary
  });
}

export function markWorkbenchSessionEnrichmentSatisfied(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    db.prepare(
      `UPDATE workbench_session_state
      SET session_enrichment_status = 'satisfied',
        session_package_status = CASE
          WHEN session_dossier_status = 'satisfied' THEN 'applied'
          ELSE session_package_status
        END,
        updated_at = ?
      WHERE session_id = ?`
    ).run(now, input.sessionId);
    updateWorkbenchNextAction(db, input.sessionId, now);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, "session_enrichment_applied", now]),
      actor: input.actor,
      details: { provider: "workbench_cli", outputKind: "session_enrichment" },
      eventAt: now,
      eventType: "session_enrichment_applied",
      sessionId: input.sessionId,
      summary: "Session enrichment applied"
    });
    db.prepare("UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function markWorkbenchArtifactSatisfied(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; artifactKind: WorkbenchArtifactKind; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  const eventType = `${input.artifactKind}_applied`;
  const summary = `${kindLabel(input.artifactKind)} applied`;
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    if (input.artifactKind === "session_dossier") {
      db.prepare(
        `UPDATE workbench_session_state
         SET session_dossier_status = 'satisfied',
             session_package_status = CASE
               WHEN session_enrichment_status = 'satisfied' THEN 'applied'
               ELSE session_package_status
             END,
             updated_at = ?
         WHERE session_id = ?`
      ).run(now, input.sessionId);
    } else {
      setOptionalKindStatus(db, input.sessionId, input.artifactKind, "satisfied", now);
    }
    refreshResolutionAndNextAction(db, input.sessionId, now);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, eventType, now]),
      actor: input.actor,
      details: { artifactKind: input.artifactKind },
      eventAt: now,
      eventType,
      sessionId: input.sessionId,
      summary
    });
    db.prepare("UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function setWorkbenchArtifactApplicability(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    artifactKind: WorkbenchAutomaticKind;
    reason: string;
    sessionId: string;
    status: "not_applicable" | "contributed";
  }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  const eventType = `${input.artifactKind}_${input.status}`;
  const summary =
    input.status === "contributed"
      ? `${kindLabel(input.artifactKind)} satisfied via contribution`
      : `${kindLabel(input.artifactKind)} marked not applicable`;
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    setOptionalKindStatus(db, input.sessionId, input.artifactKind, input.status, now);
    refreshResolutionAndNextAction(db, input.sessionId, now);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, eventType, input.reason]),
      actor: input.actor,
      details: { artifactKind: input.artifactKind, reason: input.reason, status: input.status },
      eventAt: now,
      eventType,
      sessionId: input.sessionId,
      summary
    });
    db.prepare("UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

/** Mark seed sessions contributed when they appear in a published multi-session artifact's provenance. */
export function markContributionSatisfactionForProvenance(
  db: MastheadDatabase,
  input: {
    actor: WorkbenchActor;
    artifactKind: WorkbenchAutomaticKind;
    provenanceSessionIds: string[];
    publishedArtifactId: string;
  }
): void {
  for (const sessionId of input.provenanceSessionIds) {
    const state = readWorkbenchSessionState(db, sessionId);
    if (!state) continue;
    const status = optionalKindStatus(state, input.artifactKind);
    if (status === "satisfied" || status === "not_applicable" || status === "contributed") continue;
    setWorkbenchArtifactApplicability(db, {
      actor: input.actor,
      artifactKind: input.artifactKind,
      reason: `contributed_to:${input.publishedArtifactId}`,
      sessionId,
      status: "contributed"
    });
  }
}

export function markWorkbenchTranscriptStatus(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; details?: Record<string, unknown>; eventType: string; sessionId: string; status: WorkbenchTranscriptStatus; summary: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    db.prepare("UPDATE workbench_session_state SET transcript_status = ?, updated_at = ? WHERE session_id = ?").run(
      input.status,
      now,
      input.sessionId
    );
    updateWorkbenchNextAction(db, input.sessionId, now);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, input.eventType, now]),
      actor: input.actor,
      details: input.details ?? {},
      eventAt: now,
      eventType: input.eventType,
      sessionId: input.sessionId,
      summary: input.summary
    });
    db.prepare("UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
}

export function markWorkbenchTranscriptAvailableInTransaction(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; sessionId: string }
): void {
  const now = new Date().toISOString();
  ensureWorkbenchSessionState(db, input.sessionId);
  db.prepare(
    `UPDATE workbench_session_state
     SET transcript_status = CASE
           WHEN transcript_status = 'imported' THEN 'imported'
           ELSE 'available'
         END,
         updated_at = ?
     WHERE session_id = ?`
  ).run(now, input.sessionId);
  insertWorkbenchActivity(db, {
    activityId: stableRecordId("workbench_activity", [input.sessionId, "authoring_evidence_ready"]),
    actor: input.actor,
    details: { source: "canonical_redacted_evidence" },
    eventAt: now,
    eventType: "authoring_evidence_ready",
    sessionId: input.sessionId,
    summary: "Canonical redacted evidence ready for authoring"
  });
}

export function listWorkbenchActivity(db: MastheadDatabase, options: { limit: number; sessionId?: string }): WorkbenchActivityRecord[] {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
  const rows = options.sessionId
    ? (db
        .prepare(
          `SELECT
            activity_id AS activityId,
            session_id AS sessionId,
            event_type AS eventType,
            event_at AS eventAt,
            actor_kind AS actorKind,
            actor_id AS actorId,
            summary,
            details_json AS detailsJson,
            related_run_id AS relatedRunId,
            related_claim_id AS relatedClaimId
          FROM workbench_activity
          WHERE session_id = ?
          ORDER BY event_at DESC, activity_id DESC
          LIMIT ?`
        )
        .all(options.sessionId, limit) as WorkbenchActivityRow[])
    : (db
        .prepare(
          `SELECT
            activity_id AS activityId,
            session_id AS sessionId,
            event_type AS eventType,
            event_at AS eventAt,
            actor_kind AS actorKind,
            actor_id AS actorId,
            summary,
            details_json AS detailsJson,
            related_run_id AS relatedRunId,
            related_claim_id AS relatedClaimId
          FROM workbench_activity
          ORDER BY event_at DESC, activity_id DESC
          LIMIT ?`
        )
        .all(limit) as WorkbenchActivityRow[]);
  return rows.map(activityRowToRecord);
}

export function countWorkbenchQueue(
  db: MastheadDatabase,
  options: { publicationStatus?: WorkbenchPublicationStatus } = {}
): number {
  const publicationStatus = options.publicationStatus ?? "publish_path";
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
      FROM workbench_session_state
      JOIN sessions ON sessions.session_id = workbench_session_state.session_id
      WHERE workbench_session_state.publication_status = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(publicationStatus) as { count: number };
  return Number(row?.count ?? 0);
}

export function listWorkbenchQueue(
  db: MastheadDatabase,
  options: { limit: number; offset?: number; publicationStatus?: WorkbenchPublicationStatus }
): WorkbenchSessionStateRecord[] {
  const publicationStatus = options.publicationStatus ?? "publish_path";
  const limit = Math.max(1, Math.min(Math.trunc(options.limit), 500));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = db
    .prepare(
      `SELECT
        workbench_session_state.session_id AS sessionId,
        workbench_session_state.publication_status AS publicationStatus,
        workbench_session_state.next_action AS nextAction,
        workbench_session_state.transcript_status AS transcriptStatus,
        workbench_session_state.quality_status AS qualityStatus,
        workbench_session_state.session_enrichment_status AS sessionEnrichmentStatus,
        workbench_session_state.session_dossier_status AS sessionDossierStatus,
        COALESCE(workbench_session_state.runbook_status, workbench_session_state.bug_fix_trace_status) AS bugFixTraceStatus,
        COALESCE(workbench_session_state.runbook_status, workbench_session_state.bug_fix_trace_status) AS runbookStatus,
        COALESCE(workbench_session_state.adr_status, 'unknown') AS adrStatus,
        COALESCE(workbench_session_state.incident_timeline_status, 'unknown') AS incidentTimelineStatus,
        COALESCE(workbench_session_state.session_package_status, 'missing') AS sessionPackageStatus,
        COALESCE(workbench_session_state.resolution_status, 'in_progress') AS resolutionStatus,
        workbench_session_state.non_publication_reason AS nonPublicationReason,
        workbench_session_state.published_at AS publishedAt,
        workbench_session_state.published_activity_id AS publishedActivityId,
        workbench_session_state.last_activity_at AS lastActivityAt,
        workbench_session_state.created_at AS createdAt,
        workbench_session_state.updated_at AS updatedAt
      FROM workbench_session_state
      JOIN sessions ON sessions.session_id = workbench_session_state.session_id
      WHERE workbench_session_state.publication_status = ?
        AND sessions.deleted_at IS NULL
      ORDER BY COALESCE(workbench_session_state.last_activity_at, sessions.last_activity_at, workbench_session_state.updated_at) DESC,
        workbench_session_state.session_id DESC
      LIMIT ? OFFSET ?`
    )
    .all(publicationStatus, limit, offset) as WorkbenchSessionStateRow[];
  return rows.map((row) => stateRowToRecord(db, row));
}

export function claimWorkbenchSessions(
  db: MastheadDatabase,
  input: { claimedBy: string; expiresAt: string; sessionIds: string[] }
): WorkbenchClaimBatch {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const batch = claimWorkbenchSessionsInTransaction(db, input);
    db.exec("COMMIT;");
    return batch;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function claimWorkbenchSessionsInTransaction(
  db: MastheadDatabase,
  input: { claimedBy: string; expiresAt: string; sessionIds: string[] }
): WorkbenchClaimBatch {
  const now = new Date().toISOString();
  const claims: WorkbenchClaimRecord[] = [];
  for (const sessionId of input.sessionIds) {
    ensureWorkbenchSessionState(db, sessionId);
    db.prepare(
      `UPDATE workbench_claims
       SET released_at = ?, release_reason = ?
       WHERE session_id = ? AND released_at IS NULL`
    ).run(now, "replaced", sessionId);
    const claimId = randomUUID();
    db.prepare(
      `INSERT INTO workbench_claims (
        claim_id, session_id, claim_kind, claimed_by, claimed_at, heartbeat_at, expires_at
      ) VALUES (?, ?, 'publish_path', ?, ?, ?, ?)`
    ).run(claimId, sessionId, input.claimedBy, now, now, input.expiresAt);
    insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [sessionId, "claimed", claimId]),
      actor: { kind: "agent", id: input.claimedBy },
      details: { expiresAt: input.expiresAt },
      eventAt: now,
      eventType: "claimed",
      relatedClaimId: claimId,
      sessionId,
      summary: "Workbench session claimed"
    });
    claims.push(readWorkbenchClaim(db, claimId)!);
  }
  return { claims };
}

export function renewOrReacquireAuthoringClaimsInTransaction(
  db: MastheadDatabase,
  input: { actorId: string; expiresAt: string; runId: string }
): WorkbenchAuthoringRunDto {
  const run = getWorkbenchAuthoringRun(db, input.runId);
  if (!run) throw new Error(`authoring_run_not_found:${input.runId}`);
  if (run.actorId !== input.actorId) throw new Error(`authoring_actor_mismatch:${input.runId}`);
  const now = new Date().toISOString();

  for (const sessionId of run.sessionIds) {
    const runClaim = db
      .prepare(
        `SELECT claims.claim_id AS claimId,
                claims.claimed_by AS claimedBy,
                claims.expires_at AS expiresAt,
                claims.released_at AS releasedAt
         FROM workbench_authoring_run_sessions AS run_sessions
         JOIN workbench_claims AS claims ON claims.claim_id = run_sessions.claim_id
         WHERE run_sessions.run_id = ? AND run_sessions.session_id = ?`
      )
      .get(input.runId, sessionId) as
      | { claimId: string; claimedBy: string; expiresAt: string; releasedAt: string | null }
      | undefined;
    if (!runClaim) throw new Error(`authoring_claim_missing:${sessionId}`);

    const conflicting = db
      .prepare(
        `SELECT claim_id AS claimId
         FROM workbench_claims
         WHERE session_id = ?
           AND claim_id <> ?
           AND released_at IS NULL
           AND expires_at > ?
         LIMIT 1`
      )
      .get(sessionId, runClaim.claimId, now) as { claimId: string } | undefined;
    if (conflicting || (runClaim.releasedAt === null && runClaim.expiresAt > now && runClaim.claimedBy !== input.actorId)) {
      throw new Error(`authoring_claim_conflict:${sessionId}`);
    }

    if (runClaim.releasedAt === null && runClaim.expiresAt > now) {
      db.prepare("UPDATE workbench_claims SET heartbeat_at = ?, expires_at = ? WHERE claim_id = ?").run(
        now,
        input.expiresAt,
        runClaim.claimId
      );
      continue;
    }

    const replacement = claimWorkbenchSessionsInTransaction(db, {
      claimedBy: input.actorId,
      expiresAt: input.expiresAt,
      sessionIds: [sessionId]
    }).claims[0]!;
    db.prepare(
      `UPDATE workbench_authoring_run_sessions
       SET claim_id = ?
       WHERE run_id = ? AND session_id = ?`
    ).run(replacement.claimId, input.runId, sessionId);
  }

  return getWorkbenchAuthoringRun(db, input.runId)!;
}

export function releaseWorkbenchClaim(db: MastheadDatabase, input: { claimId: string; reason: string }): WorkbenchClaimRecord | undefined {
  const now = new Date().toISOString();
  const existing = readWorkbenchClaim(db, input.claimId);
  if (!existing) return undefined;
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("UPDATE workbench_claims SET released_at = ?, release_reason = ? WHERE claim_id = ?").run(now, input.reason, input.claimId);
    insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [existing.sessionId, "claim_released", input.claimId]),
      actor: { kind: "agent", id: existing.claimedBy },
      details: { reason: input.reason },
      eventAt: now,
      eventType: "claim_released",
      relatedClaimId: input.claimId,
      sessionId: existing.sessionId,
      summary: "Workbench claim released"
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return readWorkbenchClaim(db, input.claimId);
}

function writeStateTransition<T>(db: MastheadDatabase, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function updateWorkbenchNextAction(db: MastheadDatabase, sessionId: string, updatedAt: string): void {
  refreshResolutionAndNextAction(db, sessionId, updatedAt);
}

function refreshResolutionAndNextAction(db: MastheadDatabase, sessionId: string, updatedAt: string): void {
  const state = readWorkbenchSessionState(db, sessionId);
  if (!state) return;
  const resolutionStatus = resolutionStatusForState(state);
  const nextAction = nextActionForState({ ...state, resolutionStatus });
  db.prepare(
    `UPDATE workbench_session_state
     SET next_action = ?, resolution_status = ?, updated_at = ?
     WHERE session_id = ?`
  ).run(nextAction, resolutionStatus, updatedAt, sessionId);
}

function resolutionStatusForState(state: WorkbenchSessionStateRecord): WorkbenchResolutionStatus {
  if (state.publicationStatus === "not_added_to_logbook") return "in_progress";
  const packageReady =
    (state.transcriptStatus === "available" || state.transcriptStatus === "imported") &&
    state.qualityStatus === "passed" &&
    state.sessionEnrichmentStatus === "satisfied" &&
    state.sessionDossierStatus === "satisfied";
  if (!packageReady) return "in_progress";
  const automaticResolved =
    state.sessionPackageStatus === "published" &&
    isOptionalKindResolved(state.runbookStatus) &&
    isOptionalKindResolved(state.adrStatus) &&
    isOptionalKindResolved(state.incidentTimelineStatus);
  if (automaticResolved) return "automatic_resolved";
  return "compile_ready";
}

function isOptionalKindResolved(status: WorkbenchOptionalKindStatus): boolean {
  return status === "satisfied" || status === "not_applicable" || status === "contributed";
}

function nextActionForState(state: WorkbenchSessionStateRecord): WorkbenchNextAction {
  if (state.publicationStatus === "not_added_to_logbook") return "none";
  // Session package already published: remaining work is automatic kinds (or done).
  if (state.publicationStatus === "published" || state.sessionPackageStatus === "published") {
    if (
      isOptionalKindResolved(state.runbookStatus) &&
      isOptionalKindResolved(state.adrStatus) &&
      isOptionalKindResolved(state.incidentTimelineStatus)
    ) {
      return "none";
    }
    return "enrich";
  }
  if (state.transcriptStatus === "unchecked") return "check_transcript";
  if (state.transcriptStatus === "missing" || state.transcriptStatus === "permission_needed") return "import_transcript";
  if (state.qualityStatus === "unchecked") return "review_quality";
  if (state.qualityStatus === "failed") return "none";
  if (state.sessionEnrichmentStatus === "missing") return "enrich";
  if (state.sessionDossierStatus === "missing") return "create_dossier";
  return "publish";
}

/** Session package publish gates (automatic kinds resolve separately). */
function publicationGateFailures(state: WorkbenchSessionStateRecord): WorkbenchPublicationGate[] {
  const missing: WorkbenchPublicationGate[] = [];
  if (state.transcriptStatus !== "available" && state.transcriptStatus !== "imported") missing.push("transcript");
  if (state.qualityStatus !== "passed") missing.push("quality");
  if (state.sessionEnrichmentStatus !== "satisfied") missing.push("session_enrichment");
  if (state.sessionDossierStatus !== "satisfied") missing.push("session_dossier");
  return missing;
}

function setOptionalKindStatus(
  db: MastheadDatabase,
  sessionId: string,
  kind: WorkbenchAutomaticKind,
  status: WorkbenchOptionalKindStatus,
  now: string
): void {
  if (kind === "runbook") {
    db.prepare(
      `UPDATE workbench_session_state
       SET runbook_status = ?, bug_fix_trace_status = ?, updated_at = ?
       WHERE session_id = ?`
    ).run(status, status === "contributed" ? "satisfied" : status, now, sessionId);
    return;
  }
  if (kind === "adr") {
    db.prepare(`UPDATE workbench_session_state SET adr_status = ?, updated_at = ? WHERE session_id = ?`).run(status, now, sessionId);
    return;
  }
  db.prepare(`UPDATE workbench_session_state SET incident_timeline_status = ?, updated_at = ? WHERE session_id = ?`).run(
    status,
    now,
    sessionId
  );
}

function optionalKindStatus(state: WorkbenchSessionStateRecord, kind: WorkbenchAutomaticKind): WorkbenchOptionalKindStatus {
  if (kind === "runbook") return state.runbookStatus;
  if (kind === "adr") return state.adrStatus;
  return state.incidentTimelineStatus;
}

function kindLabel(kind: WorkbenchArtifactKind): string {
  if (kind === "session_dossier") return "Session dossier";
  if (kind === "runbook") return "Runbook";
  if (kind === "adr") return "ADR";
  return "Incident timeline";
}

function insertWorkbenchActivity(
  db: MastheadDatabase,
  input: {
    activityId: string;
    actor: WorkbenchActor;
    details: Record<string, unknown>;
    eventAt: string;
    eventType: string;
    relatedClaimId?: string;
    relatedRunId?: string;
    sessionId: string;
    summary: string;
  }
): WorkbenchActivityRecord {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_activity (
      activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary,
      details_json, related_run_id, related_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.activityId,
    input.sessionId,
    input.eventType,
    input.eventAt,
    input.actor.kind,
    input.actor.id ?? null,
    input.summary,
    JSON.stringify(input.details),
    input.relatedRunId ?? null,
    input.relatedClaimId ?? null
  );
  return readWorkbenchActivity(db, input.activityId)!;
}

function readWorkbenchActivity(db: MastheadDatabase, activityId: string): WorkbenchActivityRecord | undefined {
  const row = db
    .prepare(
      `SELECT
        activity_id AS activityId,
        session_id AS sessionId,
        event_type AS eventType,
        event_at AS eventAt,
        actor_kind AS actorKind,
        actor_id AS actorId,
        summary,
        details_json AS detailsJson,
        related_run_id AS relatedRunId,
        related_claim_id AS relatedClaimId
      FROM workbench_activity
      WHERE activity_id = ?`
    )
    .get(activityId) as WorkbenchActivityRow | undefined;
  return row ? activityRowToRecord(row) : undefined;
}

function readActiveClaim(db: MastheadDatabase, sessionId: string): WorkbenchClaimRecord | undefined {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT
        claim_id AS claimId,
        session_id AS sessionId,
        claim_kind AS claimKind,
        claimed_by AS claimedBy,
        claimed_at AS claimedAt,
        heartbeat_at AS heartbeatAt,
        expires_at AS expiresAt,
        released_at AS releasedAt,
        release_reason AS releaseReason
      FROM workbench_claims
      WHERE session_id = ? AND released_at IS NULL AND expires_at > ?
      ORDER BY expires_at DESC, claimed_at DESC
      LIMIT 1`
    )
    .get(sessionId, now) as WorkbenchClaimRow | undefined;
  return row ? claimRowToRecord(row) : undefined;
}

function readWorkbenchClaim(db: MastheadDatabase, claimId: string): WorkbenchClaimRecord | undefined {
  const row = db
    .prepare(
      `SELECT
        claim_id AS claimId,
        session_id AS sessionId,
        claim_kind AS claimKind,
        claimed_by AS claimedBy,
        claimed_at AS claimedAt,
        heartbeat_at AS heartbeatAt,
        expires_at AS expiresAt,
        released_at AS releasedAt,
        release_reason AS releaseReason
      FROM workbench_claims
      WHERE claim_id = ?`
    )
    .get(claimId) as WorkbenchClaimRow | undefined;
  return row ? claimRowToRecord(row) : undefined;
}

function stateRowToRecord(db: MastheadDatabase, row: WorkbenchSessionStateRow): WorkbenchSessionStateRecord {
  return {
    activeClaim: readActiveClaim(db, row.sessionId),
    adrStatus: row.adrStatus ?? "unknown",
    bugFixTraceStatus: row.runbookStatus ?? row.bugFixTraceStatus ?? "unknown",
    createdAt: row.createdAt,
    incidentTimelineStatus: row.incidentTimelineStatus ?? "unknown",
    lastActivityAt: row.lastActivityAt ?? undefined,
    nextAction: row.nextAction,
    nonPublicationReason: row.nonPublicationReason ?? undefined,
    publicationStatus: row.publicationStatus,
    publishedActivityId: row.publishedActivityId ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    qualityStatus: row.qualityStatus,
    resolutionStatus: row.resolutionStatus ?? "in_progress",
    runbookStatus: row.runbookStatus ?? row.bugFixTraceStatus ?? "unknown",
    sessionDossierStatus: row.sessionDossierStatus,
    sessionEnrichmentStatus: row.sessionEnrichmentStatus,
    sessionId: row.sessionId,
    sessionPackageStatus: row.sessionPackageStatus ?? "missing",
    transcriptStatus: row.transcriptStatus,
    updatedAt: row.updatedAt
  };
}

function activityRowToRecord(row: WorkbenchActivityRow): WorkbenchActivityRecord {
  return {
    activityId: row.activityId,
    actorId: row.actorId ?? undefined,
    actorKind: row.actorKind,
    details: JSON.parse(row.detailsJson) as Record<string, unknown>,
    eventAt: row.eventAt,
    eventType: row.eventType,
    relatedClaimId: row.relatedClaimId ?? undefined,
    relatedRunId: row.relatedRunId ?? undefined,
    sessionId: row.sessionId,
    summary: row.summary
  };
}

function claimRowToRecord(row: WorkbenchClaimRow): WorkbenchClaimRecord {
  return {
    claimId: row.claimId,
    claimKind: row.claimKind,
    claimedAt: row.claimedAt,
    claimedBy: row.claimedBy,
    expiresAt: row.expiresAt,
    heartbeatAt: row.heartbeatAt,
    releaseReason: row.releaseReason ?? undefined,
    releasedAt: row.releasedAt ?? undefined,
    sessionId: row.sessionId
  };
}
