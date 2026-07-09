import { ALL_RUNTIME_KINDS, type RuntimeKind } from "../adapters/types.ts";
import { canonicalSessionId, runtimeIdFor } from "../shared/sessionIdentity.ts";
import type { GitSnapshot, NormalizedEvent } from "./types.ts";

export type LiveSessionKey = {
  runtime: RuntimeKind;
  sourceSessionId: string;
};

export type LiveProjectionSessionScope = LiveSessionKey & {
  projectionSessionId: string;
  canonicalSessionId: string;
};

export function runtimeFromAdapter(value: string | undefined): RuntimeKind | undefined {
  return ALL_RUNTIME_KINDS.find((runtime) => runtime === value);
}

export function liveSessionKeyFromEvent(event: NormalizedEvent): LiveSessionKey | undefined {
  const runtime = runtimeFromAdapter(event.source.adapter);
  if (!runtime || !event.sessionId) return undefined;
  return { runtime, sourceSessionId: event.sessionId };
}

export function liveSessionKeyId(key: LiveSessionKey): string {
  return `${key.runtime}:${encodeURIComponent(key.sourceSessionId)}`;
}

export function projectionScopeForKey(hostId: string, key: LiveSessionKey): LiveProjectionSessionScope {
  return {
    ...key,
    projectionSessionId: liveSessionKeyId(key),
    canonicalSessionId: canonicalSessionId(hostId, runtimeIdFor(key.runtime, undefined), key.sourceSessionId)
  };
}

export function scopeEventForProjection(event: NormalizedEvent): NormalizedEvent | undefined {
  const key = liveSessionKeyFromEvent(event);
  if (!key) return undefined;
  return {
    ...event,
    sessionId: liveSessionKeyId(key),
    payload: {
      ...event.payload,
      runtime: key.runtime,
      sourceSessionId: key.sourceSessionId
    }
  };
}

export function scopeGitSnapshotForProjection(snapshot: GitSnapshot, key: LiveSessionKey): GitSnapshot {
  return {
    ...snapshot,
    sessionId: liveSessionKeyId(key)
  };
}
