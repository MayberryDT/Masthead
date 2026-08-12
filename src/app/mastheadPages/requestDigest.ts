import canonicalize from "canonicalize";
import type { ObjectId, PublishPageRequestV1 } from "../../mastheadPages/types";

/** Recompute the outbound request digest the same way the daemon stages it. */
export async function sha256CanonicalRequest(request: PublishPageRequestV1): Promise<ObjectId> {
  const canonical = canonicalize(request);
  if (canonical === undefined) throw new Error("canonicalize_failed");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256-${hex}` as ObjectId;
}
