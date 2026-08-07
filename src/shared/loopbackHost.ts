import { isIP } from "node:net";

/** True for localhost / 127.0.0.0/8 / ::1 bind or URL hosts. */
export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  if (isIP(normalized) === 6) return normalized === "::1";
  return false;
}

/**
 * Local-first daemons and live-dev launchers only bind loopback.
 * Rejects 0.0.0.0 / LAN / public hosts so the unauthenticated HTTP surface
 * cannot be exposed accidentally via MASTHEAD_HOST.
 */
export function assertLoopbackBindHost(host: string, label = "MASTHEAD_HOST"): string {
  const normalized = host.trim();
  if (!isLoopbackHost(normalized)) {
    throw new Error(
      `${label} must be a loopback address (127.0.0.1, ::1, or localhost); got ${JSON.stringify(host)}`
    );
  }
  return normalized;
}
