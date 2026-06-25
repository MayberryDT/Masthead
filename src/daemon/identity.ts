import { createHash } from "node:crypto";

export function stableRecordId(prefix: string, parts: Array<string | number | undefined | null>): string {
  return `${prefix}:${createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\0"))
    .digest("hex")
    .slice(0, 32)}`;
}
