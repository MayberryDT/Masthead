import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isLoopbackHost } from "./loopbackHost.ts";

/**
 * Structural provider URL checks (sync). Use before scheduling work that must
 * not await DNS. Pair with redirect:"manual" and optional DNS validation when
 * performing a real network fetch.
 */
export function assertSafeProviderUrlShape(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Provider URL is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Provider URL must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "metadata.google.internal") {
    throw new Error("Provider URL cannot target cloud metadata hosts.");
  }

  const loopback = isLoopbackHost(hostname);
  if (!loopback && url.protocol !== "https:") {
    throw new Error("Remote provider URL must use HTTPS.");
  }

  // Literal IP hosts can be checked without DNS.
  const normalizedIp = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalizedIp)) {
    if (loopback) {
      if (!isLoopbackIpAddress(normalizedIp)) {
        throw new Error("Loopback provider URL resolved to a non-loopback address.");
      }
    } else if (isBlockedOutboundIpAddress(normalizedIp)) {
      throw new Error("Provider URL resolves to a private or link-local network address.");
    }
  }

  return url;
}

/**
 * Validate an outbound LLM/provider URL before fetch.
 * - http/https only, no embedded credentials
 * - loopback hosts may use http (local Ollama / LM Studio)
 * - non-loopback hosts require https and must not resolve to private/special IPs
 * - DNS is resolved so rebinding hostnames cannot target link-local metadata
 */
export async function assertSafeProviderFetchUrl(rawUrl: string): Promise<URL> {
  const url = assertSafeProviderUrlShape(rawUrl);
  const hostname = url.hostname.toLowerCase();
  const loopback = isLoopbackHost(hostname);

  const addresses = await resolveHostAddresses(hostname);
  for (const address of addresses) {
    if (loopback) {
      if (!isLoopbackIpAddress(address)) {
        throw new Error("Loopback provider URL resolved to a non-loopback address.");
      }
      continue;
    }
    if (isBlockedOutboundIpAddress(address)) {
      throw new Error("Provider URL resolves to a private or link-local network address.");
    }
  }

  return url;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (isIP(normalized)) return [normalized];

  const results = await lookup(normalized, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("Provider URL hostname could not be resolved.");
  }
  return results.map((entry) => entry.address);
}

function isLoopbackIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  if (isIP(normalized) === 6) {
    return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
  }
  return false;
}

/** Private, loopback, link-local, CGNAT, and other non-public destinations. */
export function isBlockedOutboundIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return isPrivateOrSpecialIpv4(normalized);
  if (version === 6) return isPrivateOrSpecialIpv6(normalized);
  return true;
}

function isPrivateOrSpecialIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map((part) => Number(part));
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrSpecialIpv6(ip: string): boolean {
  if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("febf:")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique local
  if (ip.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6
  const mapped = ip.match(/^:ffff:(\d+\.\d+\.\d+\.\d+)$/i) ?? ip.match(/^0:0:0:0:0:ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return isPrivateOrSpecialIpv4(mapped[1]);
  return false;
}
