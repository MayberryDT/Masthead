const DEFAULT_ALLOWED_HOSTS = new Set(["masthead.page", "www.masthead.page"]);

export type MastheadPagesOriginConfig = {
  /** Extra https origins allowed for verification URLs and API calls (dev/staging). */
  allowedOrigins?: string[];
};

function allowedHosts(config: MastheadPagesOriginConfig = {}): Set<string> {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const origin of config.allowedOrigins ?? []) {
    try {
      const url = new URL(origin);
      if (url.protocol === "https:") hosts.add(url.hostname.toLowerCase());
    } catch {
      // ignore invalid override origins
    }
  }
  return hosts;
}

/**
 * Accept only HTTPS verification URLs on masthead.page (or configured https overrides).
 * Returns the normalized href, or undefined when the URL must not be opened.
 */
export function parseMastheadPagesAuthorizationUrl(
  raw: string,
  config: MastheadPagesOriginConfig = {}
): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase();
  if (!allowedHosts(config).has(host)) return undefined;
  // Device approval lives on the web origin path; reject unexpected schemes/hosts only.
  if (url.pathname.includes("..")) return undefined;
  return url.href;
}

export function resolveMastheadPagesApiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MASTHEAD_PAGES_API_ORIGIN?.trim() || env.MASTHEAD_PAGES_ORIGIN?.trim();
  if (override) {
    try {
      const url = new URL(override);
      if (url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        return url.origin;
      }
    } catch {
      // fall through
    }
  }
  return "https://masthead.page";
}

export function mastheadPagesOriginConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MastheadPagesOriginConfig {
  const origins: string[] = [];
  for (const key of ["MASTHEAD_PAGES_API_ORIGIN", "MASTHEAD_PAGES_ORIGIN", "MASTHEAD_PAGES_AUTH_ORIGIN"] as const) {
    const value = env[key]?.trim();
    if (value) origins.push(value);
  }
  return { allowedOrigins: origins };
}
