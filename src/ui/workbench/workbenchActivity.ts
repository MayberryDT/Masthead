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
  optional_artifact_published: { label: "Optional artifact published", tone: "ok" },
  authoring_optional_considered_no: { label: "Optional considered — no", tone: "info" },
  authoring_optional_artifact_considered_no: { label: "Optional considered — no", tone: "info" },
  optional_considered_no: { label: "Optional considered — no", tone: "info" },
  authoring_request_completed: { label: "Request completed", tone: "ok" },
  authoring_daemon_error: { label: "Daemon error", tone: "bad" },
  daemon_error: { label: "Daemon error", tone: "bad" }
};

export function workbenchActivityTone(eventType: string): WorkbenchActivityTone {
  const normalizedEventType = eventType.toLowerCase();
  const authoringPresentation = resolveAuthoringActivityPresentation(normalizedEventType);
  if (authoringPresentation) return authoringPresentation.tone;
  if (/(fail|error|denied|blocked|not_added|gate_failed|quality_failed)/.test(normalizedEventType)) return "bad";
  if (/(permission|warn|missing|required)/.test(normalizedEventType)) return "warn";
  if (/(published|quality_passed|satisfied|imported|enrichment_applied)/.test(normalizedEventType)) return "ok";
  if (/^claimed$|claim_heartbeat/.test(normalizedEventType)) return "claim";
  if (/(claim_released|legacy_backfill)/.test(normalizedEventType)) return "mute";
  if (/(transcript|import|check|preview|queued)/.test(normalizedEventType)) return "info";
  return "mute";
}

export function workbenchActivityLabel(eventType: string): string {
  return resolveAuthoringActivityPresentation(eventType.toLowerCase())?.label ?? eventType;
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

function resolveAuthoringActivityPresentation(
  normalizedEventType: string
): WorkbenchActivityPresentation | undefined {
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
