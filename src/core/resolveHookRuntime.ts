/** Live runtimes accepted on the hook ingest / state-report path. */
export const HOOK_RUNTIME_KINDS = [
  "codex",
  "claude_code",
  "cursor",
  "grok",
  "opencode",
  "omp",
  "pi",
  "hermes"
] as const;

export type HookRuntimeKind = (typeof HOOK_RUNTIME_KINDS)[number];

export type ResolveHookRuntimeInput = {
  env?: Record<string, string | undefined>;
  payload?: Record<string, unknown>;
  /** Optional process path / argv for host detection (execPath, argv0, etc.). */
  processPath?: string;
  argv?: readonly string[];
};

/**
 * Resolve the runtime a hook should attribute to, in priority order:
 * 1. MASTHEAD_RUNTIME env (explicit install pin)
 * 2. Host detection from process/env when unambiguous
 * 3. runtime query param on MASTHEAD_INGEST_URL
 * 4. payload runtime / adapter
 */
export function resolveHookRuntime(input: ResolveHookRuntimeInput = {}): HookRuntimeKind | undefined {
  const env = input.env ?? {};
  const pinned = normalizeRuntime(env.MASTHEAD_RUNTIME);
  if (pinned) return pinned;

  const host = detectHostRuntime(env, {
    processPath: input.processPath,
    argv: input.argv
  });
  if (host) return host;

  const fromUrl = runtimeFromIngestUrl(env.MASTHEAD_INGEST_URL);
  if (fromUrl) return fromUrl;

  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  return normalizeRuntime(stringField(payload, "runtime") ?? stringField(payload, "adapter"));
}

export function detectHostRuntime(
  env: Record<string, string | undefined> = {},
  options: { processPath?: string; argv?: readonly string[] } = {}
): HookRuntimeKind | undefined {
  if (hasGrokHostMarkers(env, options)) return "grok";
  if (hasClaudeHostMarkers(env, options)) return "claude_code";
  if (hasCodexHostMarkers(env, options)) return "codex";
  if (hasCursorHostMarkers(env, options)) return "cursor";
  if (hasOpenCodeHostMarkers(env, options)) return "opencode";
  if (hasOmpHostMarkers(env, options)) return "omp";
  if (hasPiHostMarkers(env, options)) return "pi";
  if (hasHermesHostMarkers(env, options)) return "hermes";
  return undefined;
}

export function runtimeFromIngestUrl(ingestUrl: string | undefined): HookRuntimeKind | undefined {
  if (!ingestUrl) return undefined;
  try {
    return normalizeRuntime(new URL(ingestUrl).searchParams.get("runtime") ?? undefined);
  } catch {
    return undefined;
  }
}

/** Rewrite or add the runtime query param on an ingest URL. */
export function withRuntimeOnIngestUrl(ingestUrl: string, runtime: string | undefined): string {
  if (!runtime) return ingestUrl;
  try {
    const url = new URL(ingestUrl);
    url.searchParams.set("runtime", runtime);
    return url.toString();
  } catch {
    return ingestUrl;
  }
}

export function normalizeRuntime(value: string | undefined | null): HookRuntimeKind | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return (HOOK_RUNTIME_KINDS as readonly string[]).includes(trimmed) ? (trimmed as HookRuntimeKind) : undefined;
}

function hasGrokHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  // Strong session/hook markers set by Grok Build when firing hooks (including dual-fired Claude settings).
  if (nonEmpty(env.GROK_HOOK_EVENT) || nonEmpty(env.GROK_HOOK_NAME) || nonEmpty(env.GROK_SESSION_ID)) return true;
  if (nonEmpty(env.GROK_WORKSPACE_ROOT) || nonEmpty(env.GROK_AGENT) || nonEmpty(env.GROK_HOME)) return true;
  if (envKeyPrefixPresent(env, "GROK_")) return true;
  if (pathLooksLike(options.processPath, "grok") || argvLooksLike(options.argv, "grok")) return true;
  return false;
}

function hasClaudeHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  // Prefer Claude-specific markers. CLAUDE_PROJECT_DIR alone is also set by Grok Build, so only
  // treat it as Claude when no Grok markers fired (caller already ruled Grok out).
  if (nonEmpty(env.CLAUDE_CODE_ENTRYPOINT) || nonEmpty(env.CLAUDE_CODE_SESSION)) return true;
  if (nonEmpty(env.CLAUDE_PROJECT_DIR) || nonEmpty(env.CLAUDE_HOME)) return true;
  if (envKeyPrefixPresent(env, "CLAUDE_CODE_")) return true;
  if (pathLooksLike(options.processPath, "claude") || argvLooksLike(options.argv, "claude")) return true;
  return false;
}

function hasCodexHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.CODEX_HOME) || nonEmpty(env.CODEX_THREAD_ID) || nonEmpty(env.CODEX_SESSION_ID)) return true;
  if (envKeyPrefixPresent(env, "CODEX_") && !envKeyPrefixPresent(env, "GROK_")) return true;
  if (pathLooksLike(options.processPath, "codex") || argvLooksLike(options.argv, "codex")) return true;
  return false;
}

function hasCursorHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.CURSOR_TRACE_ID) || nonEmpty(env.CURSOR_SESSION_ID)) return true;
  if (pathLooksLike(options.processPath, "cursor") || argvLooksLike(options.argv, "cursor")) return true;
  return false;
}

function hasOpenCodeHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.OPENCODE_SESSION_ID) || nonEmpty(env.OPENCODE_HOME)) return true;
  if (pathLooksLike(options.processPath, "opencode") || argvLooksLike(options.argv, "opencode")) return true;
  return false;
}

function hasOmpHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.OMP_SESSION_ID) || nonEmpty(env.OMP_HOME)) return true;
  if (pathLooksLike(options.processPath, "/.omp/") || argvLooksLike(options.argv, "omp")) return true;
  return false;
}

function hasPiHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.PI_SESSION_ID) || nonEmpty(env.PI_HOME) || nonEmpty(env.PI_AGENT_DIR)) return true;
  if (pathLooksLike(options.processPath, "/.pi/") || argvLooksLike(options.argv, "pi-agent")) return true;
  return false;
}

function hasHermesHostMarkers(
  env: Record<string, string | undefined>,
  options: { processPath?: string; argv?: readonly string[] }
): boolean {
  if (nonEmpty(env.HERMES_SESSION_ID) || nonEmpty(env.HERMES_HOME)) return true;
  if (pathLooksLike(options.processPath, "hermes") || argvLooksLike(options.argv, "hermes")) return true;
  return false;
}

function envKeyPrefixPresent(env: Record<string, string | undefined>, prefix: string): boolean {
  for (const key of Object.keys(env)) {
    if (key.startsWith(prefix) && nonEmpty(env[key])) return true;
  }
  return false;
}

function pathLooksLike(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  const needle = token.toLowerCase();
  return normalized.includes(`/${needle}`) || normalized.includes(`${needle}/`) || normalized.endsWith(needle);
}

function argvLooksLike(argv: readonly string[] | undefined, token: string): boolean {
  if (!argv?.length) return false;
  const needle = token.toLowerCase();
  return argv.some((arg) => arg.toLowerCase().includes(needle));
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
