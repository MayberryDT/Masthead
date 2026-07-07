import type { RuntimeKind } from "../adapters/types.ts";
import { approvalEventRequiresPermission } from "./livePermission.ts";
import type { NormalizedEvent } from "./types.ts";

export type LiveBlockerKind = "approval";

export type LiveBlocker = {
  blockerId: string;
  runtime: RuntimeKind;
  sourceSessionId: string;
  canonicalSessionId?: string;
  kind: LiveBlockerKind;
  title: string;
  openedAt: string;
  resolvedAt?: string;
  sourceEventId?: string;
  evidenceEventIds: string[];
};

export function deriveLiveBlockers(
  events: NormalizedEvent[],
  options: { now?: Date; maxAgeMs?: number } = {}
): Map<string, LiveBlocker[]> {
  const grouped = new Map<string, LiveBlocker[]>();
  const ordered = events.filter((event) => event.sessionId).toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  for (const event of ordered) {
    const sessionId = event.sessionId as string;
    const blockers = grouped.get(sessionId) ?? [];
    grouped.set(sessionId, blockers);

    if (event.type === "approval.requested" && approvalEventRequiresPermission(event)) {
      blockers.push(openBlocker(event));
      continue;
    }
    if (event.type === "approval.resolved") {
      resolveLatest(blockers, event);
      continue;
    }
    if (event.type === "command.started") {
      resolveLatest(blockers, event);
      continue;
    }
    if (event.type === "turn.completed" && !eventStillWaiting(event)) {
      resolveAll(blockers, event);
      continue;
    }
    if (event.type === "session.closed") {
      resolveAll(blockers, event);
    }
  }

  const nowMs = options.now?.getTime();
  for (const [sessionId, blockers] of grouped) {
    grouped.set(
      sessionId,
      blockers.filter((blocker) => {
        if (blocker.resolvedAt) return false;
        if (nowMs === undefined || options.maxAgeMs === undefined) return true;
        const openedAtMs = Date.parse(blocker.openedAt);
        return Number.isFinite(openedAtMs) && nowMs - openedAtMs <= options.maxAgeMs;
      })
    );
  }
  return grouped;
}

function openBlocker(event: NormalizedEvent): LiveBlocker {
  const sourceSessionId = stringPayload(event, "sourceSessionId") ?? event.sessionId ?? "unknown";
  const key = blockerMatchKey(event) ?? event.eventId;
  return {
    blockerId: `blocker:${event.sessionId}:approval:${key}`,
    runtime: (stringPayload(event, "runtime") ?? event.source.adapter) as RuntimeKind,
    sourceSessionId,
    canonicalSessionId: event.sessionId,
    kind: "approval",
    title: "Approval requested",
    openedAt: event.occurredAt,
    sourceEventId: event.source.sourceEventId,
    evidenceEventIds: [event.eventId]
  };
}

function resolveLatest(blockers: LiveBlocker[], event: NormalizedEvent): void {
  const key = blockerMatchKey(event);
  const blocker = blockers
    .toReversed()
    .find((candidate) => !candidate.resolvedAt && (!key || candidate.blockerId.endsWith(`:${key}`)));
  if (!blocker) return;
  blocker.resolvedAt = event.occurredAt;
  blocker.evidenceEventIds.push(event.eventId);
}

function resolveAll(blockers: LiveBlocker[], event: NormalizedEvent): void {
  for (const blocker of blockers) {
    if (blocker.resolvedAt) continue;
    blocker.resolvedAt = event.occurredAt;
    blocker.evidenceEventIds.push(event.eventId);
  }
}

function blockerMatchKey(event: NormalizedEvent): string | undefined {
  return (
    stringPayload(event, "toolUseId") ??
    stringPayload(event, "tool_use_id") ??
    stringPayload(event, "approvalName") ??
    stringPayload(event, "commandId") ??
    event.source.sourceEventId
  );
}

function eventStillWaiting(event: NormalizedEvent): boolean {
  return event.payload.waiting === true || event.payload.stillWaiting === true || event.payload.blocked === true;
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
