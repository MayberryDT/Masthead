import type { DiscoveryContext, RuntimeKind } from "../../adapters/types.ts";
import type { AdapterPathCandidate } from "../../adapters/pathTypes.ts";
import { preflightAdapterPathCandidate } from "../../adapters/preflight.ts";
import type { SourcePreflightDto } from "./sourcePreflight.ts";
import { codexCandidatePaths } from "../../adapters/codex/discovery.ts";
import { cursorCandidatePaths } from "../../adapters/cursor/discovery.ts";
import { claudeCodeCandidatePaths } from "../../adapters/claudeCode/discovery.ts";
import { antigravityCandidatePaths } from "../../adapters/antigravity/discovery.ts";
import { opencodeCandidatePaths } from "../../adapters/opencode/discovery.ts";
import { aiderCandidatePaths } from "../../adapters/aider/discovery.ts";
import { openclawCandidatePaths } from "../../adapters/openclaw/discovery.ts";
import { hermesCandidatePaths } from "../../adapters/hermes/discovery.ts";
import { piCandidatePaths } from "../../adapters/pi/discovery.ts";

export async function preflightAdapterCandidates(runtime: RuntimeKind, context: DiscoveryContext): Promise<SourcePreflightDto[]> {
  const candidates = candidatePathsForRuntime(runtime, context);
  const results = await Promise.all(candidates.map((candidate) => preflightAdapterPathCandidate(context, candidate)));
  return results.map((result) => ({
    byteCount: result.byteCount,
    candidateSessionCount: result.candidateRecordCount || result.candidateFileCount,
    diagnostics: result.diagnostics,
    exists: result.exists,
    fileCount: result.candidateFileCount,
    kind: result.kind,
    lastModifiedAt: result.lastModifiedAt,
    path: result.absolutePath,
    readable: result.readable
  }));
}

export function candidatePathsForRuntime(runtime: RuntimeKind, context: DiscoveryContext): AdapterPathCandidate[] {
  if (runtime === "codex") return codexCandidatePaths(context);
  if (runtime === "cursor") return cursorCandidatePaths(context);
  if (runtime === "claude_code") return claudeCodeCandidatePaths(context);
  if (runtime === "antigravity") return antigravityCandidatePaths(context);
  if (runtime === "opencode") return opencodeCandidatePaths(context);
  if (runtime === "aider") return aiderCandidatePaths(context);
  if (runtime === "openclaw") return openclawCandidatePaths(context);
  if (runtime === "hermes") return hermesCandidatePaths(context);
  if (runtime === "pi") return piCandidatePaths(context);
  return [];
}
