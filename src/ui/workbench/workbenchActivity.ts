import type { WorkbenchActivityDto } from "../../shared/workbench";

export type WorkbenchActivityTone = "ok" | "info" | "warn" | "bad" | "claim" | "mute";

type WorkbenchActivityPresentation = {
  label: string;
  tone: WorkbenchActivityTone;
};

const AUTHORING_ACTIVITY_PRESENTATION: Record<string, WorkbenchActivityPresentation> = {
  authoring_request_created: { label: "Request created", tone: "info" },
  authoring_pack_claimed: { label: "Pack claimed", tone: "claim" },
  authoring_pack_finished: { label: "Pack finished", tone: "ok" },
  authoring_session_published: { label: "Session published", tone: "ok" },
  authoring_session_soft_flagged: { label: "Session soft-flagged", tone: "warn" },
  authoring_session_rejected: { label: "Session rejected", tone: "bad" },
  authoring_optional_artifact_published: { label: "Optional artifact published", tone: "ok" },
  authoring_optional_considered_no: { label: "Optional considered — no", tone: "info" },
  authoring_request_completed: { label: "Request completed", tone: "ok" },
  authoring_daemon_error: { label: "Daemon error", tone: "bad" }
};

/** Pack finished while more packs/sessions remain — not campaign-complete green. */
const INCOMPLETE_PACK_FINISHED_PRESENTATION: WorkbenchActivityPresentation = {
  label: "Pack finished — request open",
  tone: "info"
};

export function workbenchActivityTone(
  eventType: string,
  details?: Record<string, unknown>
): WorkbenchActivityTone {
  const normalizedEventType = eventType.toLowerCase();
  const authoringPresentation = resolveAuthoringActivityPresentation(normalizedEventType, details);
  if (authoringPresentation) return authoringPresentation.tone;
  if (/(fail|error|denied|blocked|not_added|gate_failed|quality_failed)/.test(normalizedEventType)) return "bad";
  if (/(permission|warn|missing|required)/.test(normalizedEventType)) return "warn";
  if (/(published|quality_passed|satisfied|imported|enrichment_applied)/.test(normalizedEventType)) return "ok";
  if (/^claimed$|claim_heartbeat/.test(normalizedEventType)) return "claim";
  if (/(claim_released|legacy_backfill)/.test(normalizedEventType)) return "mute";
  if (/(transcript|import|check|preview|queued)/.test(normalizedEventType)) return "info";
  return "mute";
}

export function workbenchActivityLabel(
  eventType: string,
  details?: Record<string, unknown>
): string {
  return resolveAuthoringActivityPresentation(eventType.toLowerCase(), details)?.label ?? eventType;
}

export function workbenchActivityReason(
  activity: Pick<WorkbenchActivityDto, "details" | "eventType">
): string | undefined {
  const findings = Array.isArray(activity.details.findings)
    ? activity.details.findings
      .map((finding) => findingMessage(finding))
      .filter((message): message is string => Boolean(message))
    : [];
  if (findings.length > 0) return [...new Set(findings)].join(" · ");

  for (const key of ["reason", "message", "error", "code"] as const) {
    const value = activity.details[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function findingMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function isIncompletePackFinished(
  normalizedEventType: string,
  details?: Record<string, unknown>
): boolean {
  if (normalizedEventType !== "authoring_pack_finished" || !details) return false;
  if (details.requestComplete === false) return true;
  if (typeof details.remainingPacks === "number" && details.remainingPacks > 0) return true;
  if (typeof details.remainingSessions === "number" && details.remainingSessions > 0) return true;
  return false;
}

function resolveAuthoringActivityPresentation(
  normalizedEventType: string,
  details?: Record<string, unknown>
): WorkbenchActivityPresentation | undefined {
  if (isIncompletePackFinished(normalizedEventType, details)) {
    return INCOMPLETE_PACK_FINISHED_PRESENTATION;
  }
  if (AUTHORING_ACTIVITY_PRESENTATION[normalizedEventType]) {
    return AUTHORING_ACTIVITY_PRESENTATION[normalizedEventType];
  }
  if (/(identity_(mismatch|error|unavailable)|_identity_mismatch)$/.test(normalizedEventType)) {
    return { label: "Identity error", tone: "bad" };
  }
  return undefined;
}

export function formatWorkbenchActivityTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}
