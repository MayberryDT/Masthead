import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { listWorkbenchActivity, listWorkbenchQueue, type WorkbenchNextAction } from "../daemon/db/workbenchPipelineRepository.ts";
import type { WorkbenchOutputKind } from "./types.ts";

export type WorkbenchScope =
  | { kind: "missing" }
  | { kind: "recent" }
  | { kind: "stale" }
  | { kind: "low_confidence" }
  | { kind: "candidates" }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; project: string }
  | { kind: "runtime"; runtime: string };

export type WorkbenchQueueItem = {
  sessionId: string;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  status: "current" | "failed" | "missing" | "stale";
  nextAction: WorkbenchNextAction;
  transcriptStatus: string;
  qualityStatus: string;
  sessionEnrichmentStatus: string;
  sessionDossierStatus: string;
  bugFixTraceStatus: string;
  activeClaim?: { claimedBy: string; expiresAt: string };
  latestActivity?: { eventAt: string; eventType: string; summary: string };
};

type QueueMetadataRow = {
  sessionId: string;
  title: string | null;
  project: string | null;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
};

export function parseWorkbenchScope(scope: string): WorkbenchScope {
  if (scope === "missing" || scope === "recent" || scope === "stale" || scope === "low_confidence" || scope === "candidates") {
    return { kind: scope };
  }
  const separator = scope.indexOf(":");
  if (separator === -1) throw new Error(`invalid_scope: ${scope}`);
  const prefix = scope.slice(0, separator);
  const value = scope.slice(separator + 1);
  if (!value) throw new Error(`invalid_scope: ${scope}`);
  if (prefix === "session") return { kind: "session", sessionId: value };
  if (prefix === "project") return { kind: "project", project: value };
  if (prefix === "runtime") return { kind: "runtime", runtime: value };
  throw new Error(`invalid_scope: ${scope}`);
}

export function queueWorkbenchSessions(
  db: MastheadDatabase,
  options: { kind: WorkbenchOutputKind; scope: string; limit: number }
): WorkbenchQueueItem[] {
  const scope = parseWorkbenchScope(options.scope);
  const normalizedLimit = Math.max(1, Math.min(options.limit, 100));
  const states = listWorkbenchQueue(db, {
    limit: scope.kind === "missing" || scope.kind === "recent" ? normalizedLimit : 5000,
    publicationStatus: "publish_path"
  });
  const metadata = metadataForSessions(db, states.map((state) => state.sessionId));
  return states.flatMap((state) => {
    const session = metadata.get(state.sessionId);
    if (!session || !scopeMatches(scope, session)) return [];
    const latestActivity = listWorkbenchActivity(db, { limit: 1, sessionId: state.sessionId })[0];
    return [
      {
        activeClaim: state.activeClaim
          ? {
              claimedBy: state.activeClaim.claimedBy,
              expiresAt: state.activeClaim.expiresAt
            }
          : undefined,
        bugFixTraceStatus: state.bugFixTraceStatus,
        lastActivityAt: session.lastActivityAt,
        latestActivity: latestActivity
          ? {
              eventAt: latestActivity.eventAt,
              eventType: latestActivity.eventType,
              summary: latestActivity.summary
            }
          : undefined,
        lifecycle: session.lifecycle,
        nextAction: state.nextAction,
        project: session.project ?? undefined,
        qualityStatus: state.qualityStatus,
        runtime: session.runtime,
        sessionDossierStatus: state.sessionDossierStatus,
        sessionEnrichmentStatus: state.sessionEnrichmentStatus,
        sessionId: state.sessionId,
        status: statusForKind(options.kind, state),
        title: session.title ?? state.sessionId,
        transcriptStatus: state.transcriptStatus
      }
    ];
  }).slice(0, normalizedLimit);
}

function metadataForSessions(db: MastheadDatabase, sessionIds: string[]): Map<string, QueueMetadataRow> {
  if (sessionIds.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        COALESCE(sessions.title, sessions.objective, sessions.source_session_id) AS title,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.lifecycle AS lifecycle,
        sessions.last_activity_at AS lastActivityAt
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND sessions.deleted_at IS NULL`
    )
    .all(...sessionIds) as QueueMetadataRow[];
  return new Map(rows.map((row) => [row.sessionId, row]));
}

function scopeMatches(scope: WorkbenchScope, session: QueueMetadataRow): boolean {
  if (scope.kind === "session") return session.sessionId === scope.sessionId;
  if (scope.kind === "project") return session.project === scope.project;
  if (scope.kind === "runtime") return session.runtime === scope.runtime;
  return true;
}

function statusForKind(kind: WorkbenchOutputKind, state: ReturnType<typeof listWorkbenchQueue>[number]): WorkbenchQueueItem["status"] {
  if (kind === "session_enrichment") return state.sessionEnrichmentStatus === "satisfied" ? "current" : "missing";
  if (kind === "session_dossier") return state.sessionDossierStatus === "satisfied" ? "current" : "missing";
  if (kind === "bug_fix_trace") return state.bugFixTraceStatus === "satisfied" ? "current" : "missing";
  return "missing";
}
