import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import { sourcePolicyExplicitlyEnabled } from "../daemon/db/sourcePolicyRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  markWorkbenchTranscriptStatus,
  recordWorkbenchActivity,
  type WorkbenchActor
} from "../daemon/db/workbenchPipelineRepository.ts";

export type WorkbenchTranscriptActionResult =
  | {
      ok: true;
      sessionId: string;
      sourceId?: string;
      transcriptStatus: "available" | "imported" | "missing";
    }
  | {
      ok: false;
      code: "source_not_linked" | "source_required" | "transcript_permission_required";
      sessionId: string;
      sourceId?: string;
    };

export function checkWorkbenchTranscript(
  db: MastheadDatabase,
  input: { actor?: WorkbenchActor; sessionId: string }
): WorkbenchTranscriptActionResult {
  const coverage = getTranscriptCoverage(db, input.sessionId);
  const transcriptStatus = coverage.hasUsableTranscript ? "imported" : coverage.messages > 0 ? "available" : "missing";
  markWorkbenchTranscriptStatus(db, {
    actor: input.actor ?? { kind: "agent", id: "workbench" },
    details: { coverage },
    eventType: "transcript_checked",
    sessionId: input.sessionId,
    status: transcriptStatus,
    summary: "Transcript checked"
  });
  return { ok: true, sessionId: input.sessionId, transcriptStatus };
}

export function previewWorkbenchTranscriptImport(
  db: MastheadDatabase,
  input: { actor?: WorkbenchActor; sessionId: string; sourceId?: string }
): WorkbenchTranscriptActionResult {
  const sourceId = input.sourceId ?? firstSessionSourceId(db, input.sessionId);
  if (!sourceId) return { ok: false, code: "source_required", sessionId: input.sessionId };
  if (!sessionHasSource(db, input.sessionId, sourceId)) {
    return { ok: false, code: "source_not_linked", sessionId: input.sessionId, sourceId };
  }
  if (!sourcePolicyExplicitlyEnabled(db, "transcript_import", sourceId)) {
    markWorkbenchTranscriptStatus(db, {
      actor: input.actor ?? { kind: "agent", id: "workbench" },
      details: { sourceId },
      eventType: "transcript_permission_required",
      sessionId: input.sessionId,
      status: "permission_needed",
      summary: "Transcript import requires source permission"
    });
    return { ok: false, code: "transcript_permission_required", sessionId: input.sessionId, sourceId };
  }
  recordWorkbenchActivity(db, {
    actor: input.actor ?? { kind: "agent", id: "workbench" },
    details: { sourceId },
    eventType: "transcript_import_previewed",
    sessionId: input.sessionId,
    summary: "Transcript import previewed"
  });
  return { ok: true, sessionId: input.sessionId, sourceId, transcriptStatus: "available" };
}

export function createWorkbenchTranscriptImport(
  db: MastheadDatabase,
  input: { actor?: WorkbenchActor; sessionId: string; sourceId?: string }
): WorkbenchTranscriptActionResult {
  const preview = previewWorkbenchTranscriptImport(db, input);
  if (!preview.ok) return preview;
  markWorkbenchTranscriptStatus(db, {
    actor: input.actor ?? { kind: "agent", id: "workbench" },
    details: { sourceId: preview.sourceId },
    eventType: "transcript_import_requested",
    sessionId: input.sessionId,
    status: "available",
    summary: "Transcript import requested"
  });
  return { ok: true, sessionId: input.sessionId, sourceId: preview.sourceId, transcriptStatus: "available" };
}

function firstSessionSourceId(db: MastheadDatabase, sessionId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT source_id AS sourceId
      FROM session_sources
      WHERE session_id = ?
      ORDER BY last_seen_at DESC, source_id ASC
      LIMIT 1`
    )
    .get(sessionId) as { sourceId: string } | undefined;
  return row?.sourceId;
}

function sessionHasSource(db: MastheadDatabase, sessionId: string, sourceId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
      FROM session_sources
      WHERE session_id = ?
        AND source_id = ?
      LIMIT 1`
    )
    .get(sessionId, sourceId) as { "1": number } | undefined;
  return Boolean(row);
}
