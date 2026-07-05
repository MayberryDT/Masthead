import { createHash } from "node:crypto";

export function canonicalSessionId(hostId: string, runtimeId: string, sourceSessionId: string): string {
  return `session:${hash(`${hostId}\0${runtimeId}\0${sourceSessionId}`).slice(0, 32)}`;
}

export function runtimeIdFor(runtimeKind: string, runtimeVersion: string | undefined): string {
  return `runtime:${runtimeKind}:${hash(runtimeVersion ?? "unknown").slice(0, 16)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
