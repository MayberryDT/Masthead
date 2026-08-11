import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

import type { ObjectId, PageRevisionV1 } from "./types.ts";

export const MAX_CANONICAL_PAGE_BYTES = 1_048_576;

export function canonicalPageBytes(page: PageRevisionV1): Uint8Array {
  const text = canonicalize(page);
  if (text === undefined) {
    throw new Error("canonicalize_failed");
  }
  return new TextEncoder().encode(text);
}

export function computePageObjectId(page: PageRevisionV1): ObjectId {
  const canonical = canonicalize(page);
  if (canonical === undefined) {
    throw new Error("canonicalize_failed");
  }
  const value = `sha256-${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
  if (!/^sha256-[0-9a-f]{64}$/.test(value)) {
    throw new Error("computed_object_id_invalid");
  }
  return value as ObjectId;
}
