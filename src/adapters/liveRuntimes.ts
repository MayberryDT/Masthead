import type { RuntimeKind } from "./types.ts";

/** Release-target live connector runtimes (eight harnesses). Single source of truth. */
export const LIVE_CONNECTOR_RUNTIMES = [
  "codex",
  "claude_code",
  "cursor",
  "grok",
  "opencode",
  "omp",
  "pi",
  "hermes"
] as const satisfies readonly RuntimeKind[];

export type LiveConnectorRuntime = (typeof LIVE_CONNECTOR_RUNTIMES)[number];
