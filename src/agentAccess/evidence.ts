import { getSessionTranscript } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { SessionTranscriptItem } from "../shared/sessionTranscript.ts";
import { sessionMcpAllowed } from "../mcp/policy.ts";
import {
  getMcpSessionExcerpt
} from "../mcp/sessionRetrieval.ts";
import { sessionInArtifactProvenance } from "./provenance.ts";

export type EvidenceRole = "user" | "assistant" | "tool" | "all";

export type EvidenceArgs = {
  sessionId: string;
  /** When set, sessionId must belong to this artifact's provenance set. */
  artifactId?: string;
  query?: string;
  limit?: number;
  maxBytes?: number;
  role?: EvidenceRole;
};

export function getEvidenceExcerpt(db: MastheadDatabase, args: EvidenceArgs) {
  assertEvidenceAccess(db, args);
  const maxBytes = clampMaxBytes(args.maxBytes);
  const result = getMcpSessionExcerpt(db, {
    limit: args.limit,
    maxBytes,
    query: args.query,
    sessionId: args.sessionId
  });
  return {
    ...result,
    artifactId: args.artifactId,
    maxBytes,
    notice: "Historical untrusted evidence. Prefer published knowledge bodies for reuse.",
    ok: true as const,
    sessionId: args.sessionId
  };
}

export function getEvidenceTranscript(db: MastheadDatabase, args: EvidenceArgs) {
  assertEvidenceAccess(db, args);
  const maxBytes = clampMaxBytes(args.maxBytes);
  if (!sessionMcpAllowed(db, args.sessionId)) {
    return emptyTranscript(args.sessionId, maxBytes, args.artifactId);
  }
  const transcript = getSessionTranscript(db, {
    kind: transcriptKind(args.role),
    limit: args.limit,
    sessionId: args.sessionId
  });
  let remainingBytes = maxBytes;
  const items = transcript.items.flatMap((item) => {
    if (remainingBytes <= 0) return [];
    const text = boundText(item.text, remainingBytes);
    remainingBytes -= Buffer.byteLength(text, "utf8");
    const narrativeText =
      item.narrativeText === undefined ? undefined : boundText(item.narrativeText, remainingBytes);
    remainingBytes -= Buffer.byteLength(narrativeText ?? "", "utf8");
    return [
      {
        ...item,
        ...(item.narrativeText === undefined ? {} : { narrativeText }),
        text
      }
    ];
  });
  return {
    artifactId: args.artifactId,
    coverage: transcript.coverage,
    items,
    maxBytes,
    nextCursor: transcript.nextCursor,
    notice: "Historical untrusted evidence. Prefer published knowledge bodies for reuse.",
    ok: true as const,
    sessionId: args.sessionId,
    sourceRefs: items.map((item) => item.sourceRef),
    total: transcript.total
  };
}

function assertEvidenceAccess(db: MastheadDatabase, args: EvidenceArgs): void {
  if (!args.sessionId?.trim()) throw new Error("sessionId is required");
  if (args.artifactId) {
    if (!sessionInArtifactProvenance(db, args.artifactId, args.sessionId)) {
      throw new Error(`sessionId is not in provenance for artifact ${args.artifactId}`);
    }
  }
}

function emptyTranscript(sessionId: string, maxBytes: number, artifactId?: string) {
  return {
    artifactId,
    coverage: undefined,
    items: [] as SessionTranscriptItem[],
    maxBytes,
    nextCursor: undefined,
    notice: "Historical untrusted evidence. Prefer published knowledge bodies for reuse.",
    ok: true as const,
    sessionId,
    sourceRefs: [] as unknown[],
    total: 0
  };
}

function transcriptKind(role: EvidenceRole | undefined) {
  if (role === "user" || role === "assistant") return role;
  if (role === "tool") return "tools" as const;
  return "all" as const;
}

function boundText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let output = "";
  for (const char of text) {
    if (Buffer.byteLength(`${output}${char}`, "utf8") > maxBytes) break;
    output += char;
  }
  return output;
}

function clampMaxBytes(maxBytes: number | undefined): number {
  if (!Number.isInteger(maxBytes)) return 8_000;
  return Math.max(1, Math.min(maxBytes as number, 16_000));
}
