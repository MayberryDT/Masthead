import type { RuntimeKind } from "./types.ts";
import type { AdapterPathCandidate } from "./pathTypes.ts";

export const ADAPTER_PATH_CANDIDATES = [
  {
    confidence: "heuristic",
    contentKind: "directory",
    maxDepth: 4,
    purpose: "Cursor workspace/session storage",
    relativePath: ".cursor",
    runtime: "cursor",
    sourceKind: "inference"
  },
  {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Claude Code project transcript storage",
    relativePath: ".claude/projects",
    runtime: "claude_code",
    sourceKind: "jsonl"
  },
  {
    confidence: "heuristic",
    contentKind: "directory",
    maxDepth: 4,
    purpose: "OpenCode local state",
    relativePath: ".local/share/opencode",
    runtime: "opencode",
    sourceKind: "inference"
  },
  {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Grok hook and transcript events",
    relativePath: ".grok/hooks",
    runtime: "grok",
    sourceKind: "jsonl"
  },
  {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Grok session transcript storage",
    relativePath: ".grok/sessions",
    runtime: "grok",
    sourceKind: "jsonl"
  },
  {
    confidence: "heuristic",
    contentKind: "directory",
    maxDepth: 4,
    purpose: "Hermes local state",
    relativePath: ".hermes",
    runtime: "hermes",
    sourceKind: "inference"
  },
  {
    confidence: "heuristic",
    contentKind: "directory",
    maxDepth: 4,
    purpose: "Pi local state",
    relativePath: ".pi",
    runtime: "pi",
    sourceKind: "inference"
  },
  {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Oh My Pi session transcript storage",
    relativePath: ".omp/agent/sessions",
    runtime: "omp",
    sourceKind: "jsonl"
  },
  {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Oh My Pi alternate session transcript storage",
    relativePath: ".oh-my-pi/agent/sessions",
    runtime: "omp",
    sourceKind: "jsonl"
  }
] as const satisfies AdapterPathCandidate[];

export function pathCandidatesForRuntime(runtime: RuntimeKind): AdapterPathCandidate[] {
  return ADAPTER_PATH_CANDIDATES.filter((candidate) => candidate.runtime === runtime);
}
