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
];

/**
 * Resolve the runtime a hook should attribute to, in priority order:
 * 1. Strong dual-fire host markers only (Grok hook fire markers beat a Claude pin)
 * 2. MASTHEAD_RUNTIME env (explicit install pin — preferred for normal installs)
 * 3. runtime query param on MASTHEAD_INGEST_URL
 * 4. payload runtime / adapter
 * 5. Weak host markers for unpinned legacy hooks (never ambient GROK_AGENT/HOME)
 *
 * Keep in sync with src/core/resolveHookRuntime.ts.
 */
export function resolveHookRuntime(input = {}) {
  const env = input.env ?? {};

  if (hasStrongGrokDualFireMarkers(env)) return "grok";

  const pinned = normalizeRuntime(env.MASTHEAD_RUNTIME);
  if (pinned) return pinned;

  const fromUrl = runtimeFromIngestUrl(env.MASTHEAD_INGEST_URL);
  if (fromUrl) return fromUrl;

  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  const fromPayload = normalizeRuntime(stringField(payload, "runtime") ?? stringField(payload, "adapter"));
  if (fromPayload) return fromPayload;

  return detectWeakHostRuntime(env, {
    processPath: input.processPath,
    argv: input.argv
  });
}

export function detectHostRuntime(env = {}, options = {}) {
  if (hasStrongGrokDualFireMarkers(env)) return "grok";
  return detectWeakHostRuntime(env, options);
}

export function runtimeFromIngestUrl(ingestUrl) {
  if (!ingestUrl) return undefined;
  try {
    return normalizeRuntime(new URL(ingestUrl).searchParams.get("runtime") || undefined);
  } catch {
    return undefined;
  }
}

/** Rewrite or add the runtime query param on an ingest URL. */
export function withRuntimeOnIngestUrl(ingestUrl, runtime) {
  if (!runtime) return ingestUrl;
  try {
    const url = new URL(ingestUrl);
    url.searchParams.set("runtime", runtime);
    return url.toString();
  } catch {
    return ingestUrl;
  }
}

export function normalizeRuntime(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return HOOK_RUNTIME_KINDS.includes(trimmed) ? trimmed : undefined;
}

function hasStrongGrokDualFireMarkers(env) {
  return nonEmpty(env.GROK_HOOK_EVENT) || nonEmpty(env.GROK_HOOK_NAME) || nonEmpty(env.GROK_SESSION_ID);
}

function detectWeakHostRuntime(env, options) {
  if (hasClaudeHostMarkers(env, options)) return "claude_code";
  if (hasCodexHostMarkers(env, options)) return "codex";
  if (hasCursorHostMarkers(env, options)) return "cursor";
  if (hasOpenCodeHostMarkers(env, options)) return "opencode";
  if (hasOmpHostMarkers(env, options)) return "omp";
  if (hasPiHostMarkers(env, options)) return "pi";
  if (hasHermesHostMarkers(env, options)) return "hermes";
  return undefined;
}

function hasClaudeHostMarkers(env, options) {
  if (nonEmpty(env.CLAUDE_CODE_ENTRYPOINT) || nonEmpty(env.CLAUDE_CODE_SESSION)) return true;
  if (nonEmpty(env.CLAUDE_HOME)) return true;
  if (envKeyPrefixPresent(env, "CLAUDE_CODE_")) return true;
  if (nonEmpty(env.CLAUDE_PROJECT_DIR) && !hasStrongGrokDualFireMarkers(env)) return true;
  if (pathLooksLike(options.processPath, "claude") || argvLooksLike(options.argv, "claude")) return true;
  return false;
}

function hasCodexHostMarkers(env, options) {
  if (nonEmpty(env.CODEX_THREAD_ID) || nonEmpty(env.CODEX_SESSION_ID)) return true;
  if (envKeyPrefixPresent(env, "CODEX_") && (nonEmpty(env.CODEX_THREAD_ID) || nonEmpty(env.CODEX_SESSION_ID))) return true;
  if (pathLooksLike(options.processPath, "codex") || argvLooksLike(options.argv, "codex")) return true;
  return false;
}

function hasCursorHostMarkers(env, options) {
  if (nonEmpty(env.CURSOR_TRACE_ID) || nonEmpty(env.CURSOR_SESSION_ID)) return true;
  if (pathLooksLike(options.processPath, "cursor") || argvLooksLike(options.argv, "cursor")) return true;
  return false;
}

function hasOpenCodeHostMarkers(env, options) {
  if (nonEmpty(env.OPENCODE_SESSION_ID) || nonEmpty(env.OPENCODE_HOME)) return true;
  if (pathLooksLike(options.processPath, "opencode") || argvLooksLike(options.argv, "opencode")) return true;
  return false;
}

function hasOmpHostMarkers(env, options) {
  if (nonEmpty(env.OMP_SESSION_ID) || nonEmpty(env.OMP_HOME)) return true;
  if (pathLooksLike(options.processPath, "/.omp/") || argvLooksLike(options.argv, "omp")) return true;
  return false;
}

function hasPiHostMarkers(env, options) {
  if (nonEmpty(env.PI_SESSION_ID) || nonEmpty(env.PI_HOME) || nonEmpty(env.PI_AGENT_DIR)) return true;
  if (pathLooksLike(options.processPath, "/.pi/") || argvLooksLike(options.argv, "pi-agent")) return true;
  return false;
}

function hasHermesHostMarkers(env, options) {
  if (nonEmpty(env.HERMES_SESSION_ID) || nonEmpty(env.HERMES_HOME)) return true;
  if (pathLooksLike(options.processPath, "hermes") || argvLooksLike(options.argv, "hermes")) return true;
  return false;
}

function envKeyPrefixPresent(env, prefix) {
  for (const key of Object.keys(env)) {
    if (key.startsWith(prefix) && nonEmpty(env[key])) return true;
  }
  return false;
}

function pathLooksLike(value, token) {
  if (!value) return false;
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  const needle = token.toLowerCase();
  // Tokens that already encode path structure (e.g. "/.omp/") keep substring segment match.
  if (needle.includes("/")) return normalized.includes(needle);
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base === needle || base.startsWith(`${needle}.`) || base.startsWith(`${needle}-`)) return true;
  return (
    normalized.includes(`/${needle}/`) ||
    normalized.includes(`/${needle}.`) ||
    normalized.endsWith(`/${needle}`)
  );
}

function argvLooksLike(argv, token) {
  if (!argv?.length) return false;
  const needle = token.toLowerCase();
  return argv.some((arg) => {
    const value = String(arg).toLowerCase().replace(/\\/g, "/");
    if (value === needle) return true;
    const base = value.slice(value.lastIndexOf("/") + 1);
    if (base === needle || base.startsWith(`${needle}.`) || base.startsWith(`${needle}-`)) return true;
    return value.endsWith(`=${needle}`);
  });
}

function stringField(input, key) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
