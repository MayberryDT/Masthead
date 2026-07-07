import type { LiveRuntimeSemanticState } from "./liveState.ts";
import type { NormalizedEvent } from "./types.ts";

const BYPASS_PERMISSION_MODES = new Set([
  "bypasspermissions",
  "bypass_permissions",
  "full_access",
  "danger_full_access",
  "none",
  "disabled",
  "off"
]);

export function approvalEventRequiresPermission(event: NormalizedEvent): boolean {
  if (event.type !== "approval.requested") return false;
  const mode =
    normalizedPayloadToken(event, "permissionMode") ??
    normalizedPayloadToken(event, "permission_mode") ??
    normalizedPayloadToken(event, "approvalMode") ??
    normalizedPayloadToken(event, "approval_mode") ??
    normalizedPayloadToken(event, "sandbox_permissions");
  if (mode && BYPASS_PERMISSION_MODES.has(mode)) return false;
  if (event.payload.requiresApproval === false) return false;
  if (event.payload.requiresPermission === false) return false;
  if (event.payload.pending === false) return false;
  if (event.payload.autoApproved === true) return false;
  return true;
}

export function liveStateImpliedByEvent(event: NormalizedEvent): LiveRuntimeSemanticState | undefined {
  switch (event.type) {
    case "approval.requested":
      return approvalEventRequiresPermission(event) ? "blocked" : "working";
    case "approval.resolved":
    case "user.response":
    case "turn.started":
    case "command.started":
      return "working";
    case "turn.completed":
    case "session.closed":
    case "session.completed":
      return "idle";
    default:
      return undefined;
  }
}

export function eventIsWorkingProof(event: NormalizedEvent): boolean {
  return liveStateImpliedByEvent(event) === "working";
}

function normalizedPayloadToken(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
