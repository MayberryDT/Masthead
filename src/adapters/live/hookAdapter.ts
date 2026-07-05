import { createHash } from "node:crypto";
import { parseLiveHookPayload } from "../../core/liveHookAdapter.ts";
import type { AdapterRecord, DiscoveredSource, RuntimeKind } from "../types.ts";
import { LIVE_RUNTIME_PROFILES } from "./runtimeProfiles.ts";

const LIVE_SOURCE_IDS: Partial<Record<RuntimeKind, string>> = {
  codex: "codex-hook-local",
  claude_code: "claude-code-hook-local",
  cursor: "cursor-hook-local",
  grok: "grok-hook-local",
  omp: "omp-extension-local",
  opencode: "opencode-plugin-local"
};

export function liveHookSourceForRuntime(runtime: RuntimeKind): DiscoveredSource {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  if (!profile) throw new Error(`Unsupported live runtime: ${runtime}`);
  return {
    sourceId: LIVE_SOURCE_IDS[runtime] ?? `${runtime}-live-local`,
    runtime,
    sourceKind: "hook",
    endpoint: "http://127.0.0.1:17373/ingest",
    schemaVersion: "masthead.normalized-event.v1",
    runtimeVersion: profile.surface === "plugin" ? "plugin-v1" : "hook-v1",
    confidence: "authoritative"
  };
}

export function adapterRecordFromLiveHook(raw: string, receivedAt: string, runtime: RuntimeKind): AdapterRecord {
  const parsed = parseLiveHookPayload(raw, { receivedAt, runtime });
  const source = sourceForLiveRecord(runtime);
  if (!parsed.ok) {
    return {
      source,
      sourceRecordKey: `malformed:${hash(raw)}`,
      observedAt: receivedAt,
      payloadHash: hash(raw),
      payload: raw,
      normalized: {
        kind: "event",
        confidence: "heuristic",
        sourceRef: sourceRef(source),
        value: undefined
      },
      diagnostics: [
        {
          code: parsed.diagnostic.code,
          details: parsed.diagnostic.details,
          message: parsed.diagnostic.message,
          observedAt: parsed.diagnostic.receivedAt,
          severity: "error"
        }
      ]
    };
  }

  return {
    source,
    sourceRecordKey: parsed.event.eventId,
    observedAt: parsed.event.occurredAt,
    payloadHash: parsed.event.payloadHash,
    payload: parsed.event,
    normalized: {
      kind: "event",
      confidence: "authoritative",
      sourceRef: sourceRef(source),
      value: parsed.event
    },
    diagnostics: []
  };
}

function sourceForLiveRecord(runtime: RuntimeKind): DiscoveredSource {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  if (profile) return liveHookSourceForRuntime(runtime);
  return {
    sourceId: LIVE_SOURCE_IDS[runtime] ?? `${runtime}-live-local`,
    runtime,
    sourceKind: "hook",
    endpoint: "http://127.0.0.1:17373/ingest",
    schemaVersion: "masthead.normalized-event.v1",
    runtimeVersion: "hook-v1",
    confidence: "heuristic"
  };
}

function sourceRef(source: DiscoveredSource): AdapterRecord["normalized"]["sourceRef"] {
  return {
    endpoint: source.endpoint,
    runtimeVersion: source.runtimeVersion,
    schemaVersion: source.schemaVersion,
    sourceKind: source.sourceKind
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
