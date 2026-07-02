import type { RuntimeKind } from "./types.ts";
import type { AdapterPathCandidate } from "./pathTypes.ts";

export const ADAPTER_PATH_CANDIDATES = [
  {
    confidence: "authoritative",
    contentKind: "jsonl-file",
    purpose: "Codex session metadata index",
    relativePath: ".codex/session_index.jsonl",
    runtime: "codex",
    sourceKind: "jsonl"
  },
  {
    confidence: "authoritative",
    contentKind: "jsonl-file",
    purpose: "Codex prompt history",
    relativePath: ".codex/history.jsonl",
    runtime: "codex",
    sourceKind: "jsonl"
  },
  {
    confidence: "authoritative",
    contentKind: "jsonl-tree",
    maxDepth: 6,
    purpose: "Codex rollout transcript tree",
    relativePath: ".codex/sessions",
    runtime: "codex",
    sourceKind: "jsonl"
  },
  {
    confidence: "authoritative",
    contentKind: "jsonl-tree",
    maxDepth: 6,
    purpose: "Archived Codex rollout transcript tree",
    relativePath: ".codex/archived_sessions",
    runtime: "codex",
    sourceKind: "jsonl"
  },
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
    contentKind: "jsonl-file",
    legacy: true,
    purpose: "Aider chat history",
    relativePath: ".aider.chat.history.md",
    runtime: "aider",
    sourceKind: "jsonl"
  },
  {
    confidence: "heuristic",
    contentKind: "directory",
    maxDepth: 4,
    purpose: "OpenClaw local state",
    relativePath: ".openclaw",
    runtime: "openclaw",
    sourceKind: "inference"
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
    contentKind: "directory",
    legacy: true,
    maxDepth: 4,
    purpose: "Legacy Gemini CLI local state",
    relativePath: ".gemini",
    runtime: "gemini_cli",
    sourceKind: "inference"
  }
] as const satisfies AdapterPathCandidate[];

export function pathCandidatesForRuntime(runtime: RuntimeKind): AdapterPathCandidate[] {
  return ADAPTER_PATH_CANDIDATES.filter((candidate) => candidate.runtime === runtime);
}
