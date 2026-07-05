import {
  normalizeLiveHookPayload,
  parseLiveHookPayload,
  type LiveHookDiagnostic,
  type LiveHookNormalizeOptions
} from "./liveHookAdapter.ts";
import type { NormalizedEvent } from "./types";

export type CodexHookDiagnostic = Omit<LiveHookDiagnostic, "code"> & {
  code: "malformed_json" | "invalid_payload";
};

export type CodexHookParseResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; diagnostic: CodexHookDiagnostic };

type NormalizeOptions = Pick<LiveHookNormalizeOptions, "receivedAt">;

export function parseCodexHookPayload(raw: string, options: NormalizeOptions = {}): CodexHookParseResult {
  return parseLiveHookPayload(raw, { ...options, runtime: "codex" }) as CodexHookParseResult;
}

export function normalizeCodexHookPayload(input: unknown, options: NormalizeOptions = {}): NormalizedEvent {
  return normalizeLiveHookPayload(input, { ...options, runtime: "codex" });
}
