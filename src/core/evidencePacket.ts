import type { LlmAttentionCandidate } from "./llmAttention";
import { redactCommandOutput, redactText } from "./redaction";
import type { AttentionItem, ConflictCard, DerivedSession, EvidenceRef, NormalizedEvent } from "./types";

export type EvidencePacketPrivacyMode = "local_only" | "redacted_remote_preview";

export type EvidencePacketOmittedContent = "raw_prompts" | "full_diffs" | "full_command_output";

export type EvidencePacketPrivacyOptions = {
  remoteLlmEnabled?: boolean;
  includeRawPrompts?: boolean;
  includeFullDiffs?: boolean;
  includeFullCommandOutput?: boolean;
  maxPreviewValueLength?: number;
};

export type EvidencePacketInput = {
  createdAt?: string;
  privacy?: EvidencePacketPrivacyOptions;
  events?: NormalizedEvent[];
  sessions?: DerivedSession[];
  attentionItems?: AttentionItem[];
  conflicts?: ConflictCard[];
};

export type EvidencePacketEntry = {
  id: string;
  kind: "event" | "session" | "attention" | "conflict";
  summary: string;
  observedAt: string;
  source: string;
  evidenceRefIds: string[];
  payloadPreview?: Record<string, unknown>;
};

export type EvidencePacketMissingEntry = {
  id: string;
  subject: string;
  reason: "event_has_no_evidence_refs" | "session_has_no_evidence_refs" | "attention_has_no_evidence_refs";
};

export type EvidencePacketSections = {
  observed: EvidencePacketEntry[];
  inferred: EvidencePacketEntry[];
  missing: EvidencePacketMissingEntry[];
};

export type EvidencePacketAuditDecision =
  | {
      decision: "remote_send_blocked";
      reason: "remote_llm_disabled_by_default" | "packet_has_no_evidence";
      requiresExplicitOptIn: boolean;
      evidenceRefCount: number;
      omittedContent: EvidencePacketOmittedContent[];
      fallbackCandidate: LlmAttentionCandidate;
    }
  | {
      decision: "remote_send_ready";
      reason: "remote_llm_enabled_with_redacted_preview";
      requiresExplicitOptIn: false;
      evidenceRefCount: number;
      omittedContent: EvidencePacketOmittedContent[];
      fallbackCandidate: LlmAttentionCandidate;
    };

export type EvidencePacket = {
  schemaVersion: 1;
  createdAt: string;
  privacy: {
    mode: EvidencePacketPrivacyMode;
    remoteLlmEnabled: boolean;
    redaction: "applied";
    omittedByDefault: EvidencePacketOmittedContent[];
  };
  sections: EvidencePacketSections;
  evidenceRefs: EvidenceRef[];
  payloadPreview: {
    mode: EvidencePacketPrivacyMode;
    sendAllowed: boolean;
    bytes: number;
    content: {
      sections: EvidencePacketSections;
      evidenceRefs: EvidenceRef[];
    };
  };
  auditDecision: EvidencePacketAuditDecision;
};

const DEFAULT_OMISSIONS: EvidencePacketOmittedContent[] = ["raw_prompts", "full_diffs", "full_command_output"];

const RAW_PROMPT_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "userPrompt",
  "agentPrompt",
  "systemPrompt",
  "messages",
  "transcript",
  "fullTranscript",
  "response",
  "rawResponse"
]);

const FULL_DIFF_KEYS = new Set(["diff", "patch", "fullDiff", "unifiedDiff"]);

const FULL_COMMAND_OUTPUT_KEYS = new Set([
  "stdout",
  "stderr",
  "output",
  "commandOutput",
  "fullOutput",
  "logs",
  "log"
]);

export function buildEvidencePacket(input: EvidencePacketInput): EvidencePacket {
  const privacy = input.privacy ?? {};
  const maxPreviewValueLength = privacy.maxPreviewValueLength ?? 500;
  const remoteLlmEnabled = privacy.remoteLlmEnabled === true;
  const mode: EvidencePacketPrivacyMode = remoteLlmEnabled ? "redacted_remote_preview" : "local_only";
  const evidenceRefs = collectEvidenceRefs(input);
  const observed = observedEntries(input.events ?? [], privacy, maxPreviewValueLength);
  const inferred = [
    ...sessionEntries(input.sessions ?? []),
    ...attentionEntries(input.attentionItems ?? []),
    ...conflictEntries(input.conflicts ?? [])
  ];
  const missing = missingEntries(input);
  const content = {
    sections: { observed, inferred, missing },
    evidenceRefs
  };
  const auditDecision = decideAudit({
    remoteLlmEnabled,
    evidenceRefCount: evidenceRefs.length,
    omittedContent: DEFAULT_OMISSIONS
  });

  return {
    schemaVersion: 1,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    privacy: {
      mode,
      remoteLlmEnabled,
      redaction: "applied",
      omittedByDefault: DEFAULT_OMISSIONS
    },
    sections: content.sections,
    evidenceRefs,
    payloadPreview: {
      mode,
      sendAllowed: auditDecision.decision === "remote_send_ready",
      bytes: JSON.stringify(content).length,
      content
    },
    auditDecision
  };
}

function observedEntries(
  events: NormalizedEvent[],
  privacy: EvidencePacketPrivacyOptions,
  maxPreviewValueLength: number
): EvidencePacketEntry[] {
  return events.flatMap((event) => {
    if (event.evidence.length === 0) return [];
    return [
      {
        id: event.eventId,
        kind: "event",
        summary: redactText(event.summary),
        observedAt: event.occurredAt,
        source: `${event.source.adapter}.${event.source.surface}`,
        evidenceRefIds: event.evidence.map((ref) => ref.id),
        payloadPreview: sanitizePayload(event.payload, privacy, maxPreviewValueLength)
      }
    ];
  });
}

function sessionEntries(sessions: DerivedSession[]): EvidencePacketEntry[] {
  return sessions.flatMap((session) => {
    if (session.evidence.length === 0) return [];
    return [
      {
        id: `session:${session.sessionId}`,
        kind: "session",
        summary: redactText(`${session.title}: ${session.primaryStatus}`),
        observedAt: session.lastMeaningfulActivityAt,
        source: "masthead.session",
        evidenceRefIds: session.evidence.map((ref) => ref.id),
        payloadPreview: {
          sessionId: session.sessionId,
          project: redactText(session.project),
          primaryStatus: session.primaryStatus,
          flags: session.flags,
          changedFileCount: session.changedFileCount,
          attribution: session.attribution
        }
      }
    ];
  });
}

function attentionEntries(attentionItems: AttentionItem[]): EvidencePacketEntry[] {
  return attentionItems.flatMap((item) => {
    if (item.evidence.length === 0) return [];
    return [
      {
        id: item.itemId,
        kind: "attention",
        summary: redactText(item.title),
        observedAt: item.createdAt,
        source: "masthead.attention",
        evidenceRefIds: item.evidence.map((ref) => ref.id),
        payloadPreview: {
          type: item.type,
          severity: item.severity,
          support: item.support,
          affectedPaths: item.affectedPaths,
          affectedCommandIds: item.affectedCommandIds,
          suggestedNextAction: redactText(item.suggestedNextAction)
        }
      }
    ];
  });
}

function conflictEntries(conflicts: ConflictCard[]): EvidencePacketEntry[] {
  return conflicts.flatMap((conflict) => {
    if (conflict.evidence.length === 0) return [];
    return [
      {
        id: `conflict:${conflict.conflictId}`,
        kind: "conflict",
        summary: redactText(conflict.title),
        observedAt: conflict.evidence[0]?.observedAt ?? new Date(0).toISOString(),
        source: "masthead.conflict",
        evidenceRefIds: conflict.evidence.map((ref) => ref.id),
        payloadPreview: {
          type: conflict.type,
          severity: conflict.severity,
          sessionIds: conflict.sessionIds,
          sharedPaths: conflict.sharedPaths,
          attribution: conflict.attribution
        }
      }
    ];
  });
}

function missingEntries(input: EvidencePacketInput): EvidencePacketMissingEntry[] {
  return [
    ...(input.events ?? []).flatMap((event) =>
      event.evidence.length === 0
        ? [{ id: `missing:${event.eventId}`, subject: event.eventId, reason: "event_has_no_evidence_refs" as const }]
        : []
    ),
    ...(input.sessions ?? []).flatMap((session) =>
      session.evidence.length === 0
        ? [
            {
              id: `missing:session:${session.sessionId}`,
              subject: session.sessionId,
              reason: "session_has_no_evidence_refs" as const
            }
          ]
        : []
    ),
    ...(input.attentionItems ?? []).flatMap((item) =>
      item.evidence.length === 0
        ? [
            {
              id: `missing:${item.itemId}`,
              subject: item.itemId,
              reason: "attention_has_no_evidence_refs" as const
            }
          ]
        : []
    )
  ];
}

function collectEvidenceRefs(input: EvidencePacketInput): EvidenceRef[] {
  const refs = [
    ...(input.events ?? []).flatMap((event) => event.evidence),
    ...(input.sessions ?? []).flatMap((session) => session.evidence),
    ...(input.attentionItems ?? []).flatMap((item) => item.evidence),
    ...(input.conflicts ?? []).flatMap((conflict) => conflict.evidence)
  ];
  const byId = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    if (!byId.has(ref.id)) byId.set(ref.id, ref);
  }
  return [...byId.values()];
}

function sanitizePayload(
  payload: Record<string, unknown>,
  privacy: EvidencePacketPrivacyOptions,
  maxPreviewValueLength: number
): Record<string, unknown> {
  const preview: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RAW_PROMPT_KEYS.has(key) && privacy.includeRawPrompts !== true) continue;
    if (FULL_DIFF_KEYS.has(key) && privacy.includeFullDiffs !== true) continue;
    if (FULL_COMMAND_OUTPUT_KEYS.has(key) && privacy.includeFullCommandOutput !== true) continue;

    preview[key] = sanitizeValue(key, value, privacy, maxPreviewValueLength);
  }
  return preview;
}

function sanitizeValue(
  key: string,
  value: unknown,
  privacy: EvidencePacketPrivacyOptions,
  maxPreviewValueLength: number
): unknown {
  if (typeof value === "string") {
    if (FULL_COMMAND_OUTPUT_KEYS.has(key)) return redactCommandOutput(value, maxPreviewValueLength).text;
    return truncate(redactText(value), maxPreviewValueLength);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item, privacy, maxPreviewValueLength));
  }
  if (isRecord(value)) {
    return sanitizePayload(value, privacy, maxPreviewValueLength);
  }
  return value;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}[truncated]`;
}

function decideAudit(options: {
  remoteLlmEnabled: boolean;
  evidenceRefCount: number;
  omittedContent: EvidencePacketOmittedContent[];
}): EvidencePacketAuditDecision {
  const fallbackCandidate = unsupportedCandidate(options.remoteLlmEnabled);
  if (!options.remoteLlmEnabled) {
    return {
      decision: "remote_send_blocked",
      reason: "remote_llm_disabled_by_default",
      requiresExplicitOptIn: true,
      evidenceRefCount: options.evidenceRefCount,
      omittedContent: [...options.omittedContent],
      fallbackCandidate
    };
  }
  if (options.evidenceRefCount === 0) {
    return {
      decision: "remote_send_blocked",
      reason: "packet_has_no_evidence",
      requiresExplicitOptIn: false,
      evidenceRefCount: options.evidenceRefCount,
      omittedContent: [...options.omittedContent],
      fallbackCandidate
    };
  }
  return {
    decision: "remote_send_ready",
    reason: "remote_llm_enabled_with_redacted_preview",
    requiresExplicitOptIn: false,
    evidenceRefCount: options.evidenceRefCount,
    omittedContent: [...options.omittedContent],
    fallbackCandidate
  };
}

function unsupportedCandidate(remoteLlmEnabled: boolean): LlmAttentionCandidate {
  return {
    title: "Contextual attention unavailable",
    attention_reason: remoteLlmEnabled
      ? "No grounded contextual model output is available for this packet."
      : "Remote LLM use is disabled by default.",
    support_level: "weak",
    risk_labels: ["unsupported_contextual_output"],
    evidence_refs: [],
    unknowns: ["No model claim should enter the attention queue without packet evidence references."],
    recommended_action: "Use deterministic Masthead evidence or enable a reviewed redacted preview."
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
