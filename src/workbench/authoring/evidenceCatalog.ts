import { createHash } from "node:crypto";
import type { SessionTranscriptItem, SessionTranscriptKind, SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringEvidenceManifest,
  WorkbenchAuthoringEvidencePage
} from "../../shared/workbenchAuthoring.ts";
import {
  getCompleteSessionTranscriptPage,
  iterateSessionTranscriptItems,
  type SessionTranscriptKindFilter
} from "../../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";

const transcriptKinds: SessionTranscriptKind[] = [
  "message",
  "tool_call",
  "tool_result",
  "file_effect",
  "checkpoint",
  "runtime_signal"
];

export function getAuthoringEvidenceManifest(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchAuthoringEvidenceManifest {
  const normalizedIds = normalizedSessionIds(sessionIds);
  return {
    evidenceRevision: authoringEvidenceRevision(db, normalizedIds),
    sessions: normalizedIds.map((sessionId) => summarizeSessionEvidence(db, sessionId))
  };
}

export function getAuthoringEvidencePage(
  db: MastheadDatabase,
  query: {
    sessionId: string;
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    query?: string;
    order?: SessionTranscriptOrder;
  }
): WorkbenchAuthoringEvidencePage {
  const result = getCompleteSessionTranscriptPage(db, {
    cursor: query.cursor,
    kind: query.kind,
    limit: Math.max(1, Math.min(query.limit ?? 100, 250)),
    order: query.order,
    q: query.query,
    sessionId: query.sessionId
  });
  return {
    evidenceRevision: authoringEvidenceRevision(db, [query.sessionId]),
    items: result.items,
    nextCursor: result.nextCursor,
    sessionId: query.sessionId,
    total: result.total
  };
}

export function authoringEvidenceRevision(db: MastheadDatabase, sessionIds: string[]): string {
  const hash = createHash("sha256");
  for (const sessionId of normalizedSessionIds(sessionIds)) {
    hash.update(`${JSON.stringify({ sessionId })}\n`);
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      hash.update(
        `${JSON.stringify({
          additions: item.additions,
          argumentsRedacted: item.argumentsRedacted,
          deletions: item.deletions,
          details: item.details,
          exitCode: item.exitCode,
          itemId: item.itemId,
          kind: item.kind,
          label: item.label,
          observedAt: item.observedAt,
          role: item.role,
          sourceRef: item.sourceRef,
          staged: item.staged,
          status: item.status,
          text: item.text,
          toolName: item.toolName
        })}\n`
      );
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function summarizeSessionEvidence(
  db: MastheadDatabase,
  sessionId: string
): WorkbenchAuthoringEvidenceManifest["sessions"][number] {
  const coverage = {
    assistantMessages: 0,
    checkpoints: 0,
    fileEffects: 0,
    messages: 0,
    runtimeSignals: 0,
    toolCalls: 0,
    toolResults: 0,
    userMessages: 0
  };
  const counts = new Map<SessionTranscriptKind, number>();
  let firstObservedAt: string | undefined;
  let lastObservedAt: string | undefined;
  let totalItems = 0;

  for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
    totalItems += 1;
    firstObservedAt ??= item.observedAt || undefined;
    lastObservedAt = item.observedAt || lastObservedAt;
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    if (item.kind === "message") {
      coverage.messages += 1;
      if (item.role === "user") coverage.userMessages += 1;
      if (item.role === "assistant") coverage.assistantMessages += 1;
    } else if (item.kind === "tool_call") {
      coverage.toolCalls += 1;
    } else if (item.kind === "tool_result") {
      coverage.toolResults += 1;
    } else if (item.kind === "file_effect") {
      coverage.fileEffects += 1;
    } else if (item.kind === "checkpoint") {
      coverage.checkpoints += 1;
    } else if (item.kind === "runtime_signal") {
      coverage.runtimeSignals += 1;
    }
  }

  return {
    coverage,
    firstObservedAt,
    kindCounts: transcriptKinds.flatMap((kind) => {
      const count = counts.get(kind);
      return count ? [{ count, kind }] : [];
    }),
    lastObservedAt,
    sessionId,
    totalItems,
    warnings: []
  };
}

function normalizedSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.filter((sessionId) => sessionId.length > 0))].sort();
}
