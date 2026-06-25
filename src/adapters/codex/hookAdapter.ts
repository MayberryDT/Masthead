import { createHash } from "node:crypto";
import { parseCodexHookPayload } from "../../core/codexAdapter.ts";
import type { AdapterRecord, DiscoveredSource, RuntimeKind } from "../types.ts";

export const codexHookSource: DiscoveredSource = {
  sourceId: "codex-hook-local",
  runtime: "codex" satisfies RuntimeKind,
  sourceKind: "hook",
  endpoint: "http://127.0.0.1:17373/ingest",
  schemaVersion: "masthead.normalized-event.v1",
  runtimeVersion: "hook-v1",
  confidence: "authoritative"
};

export function adapterRecordFromCodexHook(raw: string, receivedAt: string): AdapterRecord {
  const parsed = parseCodexHookPayload(raw, { receivedAt });
  if (!parsed.ok) {
    return {
      source: codexHookSource,
      sourceRecordKey: `malformed:${hash(raw)}`,
      observedAt: receivedAt,
      payloadHash: hash(raw),
      payload: raw,
      normalized: {
        kind: "event",
        confidence: "heuristic",
        sourceRef: sourceRef(),
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
    source: codexHookSource,
    sourceRecordKey: parsed.event.eventId,
    observedAt: parsed.event.occurredAt,
    payloadHash: parsed.event.payloadHash,
    payload: parsed.event,
    normalized: {
      kind: "event",
      confidence: "authoritative",
      sourceRef: sourceRef(),
      value: parsed.event
    },
    diagnostics: []
  };
}

function sourceRef(): AdapterRecord["normalized"]["sourceRef"] {
  return {
    endpoint: codexHookSource.endpoint,
    runtimeVersion: codexHookSource.runtimeVersion,
    schemaVersion: codexHookSource.schemaVersion,
    sourceKind: "hook"
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
