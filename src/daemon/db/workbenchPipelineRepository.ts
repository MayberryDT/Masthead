import { randomUUID } from "node:crypto";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

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
export type WorkbenchBugFixTraceStatus = "unknown" | "required" | "satisfied" | "not_applicable";
export type WorkbenchActor = { kind: "agent" | "system" | "user"; id?: string };

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

export type WorkbenchSessionStateRecord = {
  sessionId: string;
  publicationStatus: WorkbenchPublicationStatus;
  nextAction: WorkbenchNextAction;
  transcriptStatus: WorkbenchTranscriptStatus;
  qualityStatus: WorkbenchQualityStatus;
  sessionEnrichmentStatus: WorkbenchRequirementStatus;
  sessionDossierStatus: WorkbenchRequirementStatus;
  bugFixTraceStatus: WorkbenchBugFixTraceStatus;
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
  | "bug_fix_trace";

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

type WorkbenchSessionStateRow = {
  sessionId: string;
  publicationStatus: WorkbenchPublicationStatus;
  nextAction: WorkbenchNextAction;
  transcriptStatus: WorkbenchTranscriptStatus;
  qualityStatus: WorkbenchQualityStatus;
  sessionEnrichmentStatus: WorkbenchRequirementStatus;
  sessionDossierStatus: WorkbenchRequirementStatus;
  bugFixTraceStatus: WorkbenchBugFixTraceStatus;
  nonPublicationReason: string | null;
  publishedAt: string | null;
  publishedActivityId: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export function readWorkbenchSessionState(db: MastheadDatabase, sessionId: string): WorkbenchSessionStateRecord | undefined {
  const row = db
    .prepare(
      `SELECT
        session_id AS sessionId,
        publication_status AS publicationStatus,
        next_action AS nextAction,
        transcript_status AS transcriptStatus,
        quality_status AS qualityStatus,
        session_enrichment_status AS sessionEnrichmentStatus,
        session_dossier_status AS sessionDossierStatus,
        bug_fix_trace_status AS bugFixTraceStatus,
        non_publication_reason AS nonPublicationReason,
        published_at AS publishedAt,
        published_activity_id AS publishedActivityId,
        last_activity_at AS lastActivityAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM workbench_session_state
      WHERE session_id = ?`
    )
    .get(sessionId) as WorkbenchSessionStateRow | undefined;
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
        next_action = 'none',
        non_publication_reason = NULL,
        published_at = ?,
        published_activity_id = ?,
        last_activity_at = ?,
        updated_at = ?
      WHERE session_id = ?`
    ).run(now, activity.activityId, now, now, input.sessionId);
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
  const now = new Date().toISOString();
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    if (input.status === "passed") {
      db.prepare(
        `UPDATE workbench_session_state
         SET quality_status = 'passed', non_publication_reason = NULL, updated_at = ?
         WHERE session_id = ?`
      ).run(now, input.sessionId);
      updateWorkbenchNextAction(db, input.sessionId, now);
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
  input: { actor: WorkbenchActor; artifactKind: "bug_fix_trace" | "session_dossier"; sessionId: string }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  const eventType = input.artifactKind === "session_dossier" ? "session_dossier_applied" : "bug_fix_trace_applied";
  const summary = input.artifactKind === "session_dossier" ? "Session dossier applied" : "Bug-fix trace applied";
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    if (input.artifactKind === "session_dossier") {
      db.prepare("UPDATE workbench_session_state SET session_dossier_status = 'satisfied', updated_at = ? WHERE session_id = ?").run(
        now,
        input.sessionId
      );
    } else {
      db.prepare("UPDATE workbench_session_state SET bug_fix_trace_status = 'satisfied', updated_at = ? WHERE session_id = ?").run(now, input.sessionId);
    }
    updateWorkbenchNextAction(db, input.sessionId, now);
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
  input: { actor: WorkbenchActor; artifactKind: "bug_fix_trace"; reason: string; sessionId: string; status: "not_applicable" }
): { state: WorkbenchSessionStateRecord; activity: WorkbenchActivityRecord } {
  const now = new Date().toISOString();
  return writeStateTransition(db, () => {
    ensureWorkbenchSessionState(db, input.sessionId);
    db.prepare("UPDATE workbench_session_state SET bug_fix_trace_status = 'not_applicable', updated_at = ? WHERE session_id = ?").run(
      now,
      input.sessionId
    );
    updateWorkbenchNextAction(db, input.sessionId, now);
    const activity = insertWorkbenchActivity(db, {
      activityId: stableRecordId("workbench_activity", [input.sessionId, "bug_fix_trace_not_applicable", input.reason]),
      actor: input.actor,
      details: { artifactKind: input.artifactKind, reason: input.reason, status: input.status },
      eventAt: now,
      eventType: "bug_fix_trace_not_applicable",
      sessionId: input.sessionId,
      summary: "Bug-fix trace marked not applicable"
    });
    db.prepare("UPDATE workbench_session_state SET last_activity_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, input.sessionId);
    return { activity, state: readWorkbenchSessionState(db, input.sessionId)! };
  });
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

export function listWorkbenchQueue(
  db: MastheadDatabase,
  options: { limit: number; publicationStatus?: WorkbenchPublicationStatus }
): WorkbenchSessionStateRecord[] {
  const publicationStatus = options.publicationStatus ?? "publish_path";
  const limit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
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
        workbench_session_state.bug_fix_trace_status AS bugFixTraceStatus,
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
      LIMIT ?`
    )
    .all(publicationStatus, limit) as WorkbenchSessionStateRow[];
  return rows.map((row) => stateRowToRecord(db, row));
}

export function claimWorkbenchSessions(
  db: MastheadDatabase,
  input: { claimedBy: string; expiresAt: string; sessionIds: string[] }
): { claims: WorkbenchClaimRecord[] } {
  const now = new Date().toISOString();
  const claims: WorkbenchClaimRecord[] = [];
  db.exec("BEGIN IMMEDIATE;");
  try {
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
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return { claims };
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
  const state = readWorkbenchSessionState(db, sessionId);
  if (!state || state.publicationStatus !== "publish_path") return;
  const nextAction = nextActionForState(state);
  db.prepare("UPDATE workbench_session_state SET next_action = ?, updated_at = ? WHERE session_id = ?").run(nextAction, updatedAt, sessionId);
}

function nextActionForState(state: WorkbenchSessionStateRecord): WorkbenchNextAction {
  if (state.transcriptStatus === "unchecked") return "check_transcript";
  if (state.transcriptStatus === "missing" || state.transcriptStatus === "permission_needed") return "import_transcript";
  if (state.qualityStatus === "unchecked") return "review_quality";
  if (state.qualityStatus === "failed") return "none";
  if (state.sessionEnrichmentStatus === "missing") return "enrich";
  if (state.sessionDossierStatus === "missing") return "create_dossier";
  if (state.bugFixTraceStatus !== "satisfied" && state.bugFixTraceStatus !== "not_applicable") return "create_dossier";
  return "publish";
}

function publicationGateFailures(state: WorkbenchSessionStateRecord): WorkbenchPublicationGate[] {
  const missing: WorkbenchPublicationGate[] = [];
  if (state.transcriptStatus !== "available" && state.transcriptStatus !== "imported") missing.push("transcript");
  if (state.qualityStatus !== "passed") missing.push("quality");
  if (state.sessionEnrichmentStatus !== "satisfied") missing.push("session_enrichment");
  if (state.sessionDossierStatus !== "satisfied") missing.push("session_dossier");
  if (state.bugFixTraceStatus !== "satisfied" && state.bugFixTraceStatus !== "not_applicable") missing.push("bug_fix_trace");
  return missing;
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
    bugFixTraceStatus: row.bugFixTraceStatus,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt ?? undefined,
    nextAction: row.nextAction,
    nonPublicationReason: row.nonPublicationReason ?? undefined,
    publicationStatus: row.publicationStatus,
    publishedActivityId: row.publishedActivityId ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    qualityStatus: row.qualityStatus,
    sessionDossierStatus: row.sessionDossierStatus,
    sessionEnrichmentStatus: row.sessionEnrichmentStatus,
    sessionId: row.sessionId,
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
