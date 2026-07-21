import type { EvidenceRef } from "../../../core/types.ts";
import type { GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import type { WorkbenchClaimSupport } from "../../../shared/workbenchAuthoring.ts";

export const FAILED_V3_SUMMARY_PREFIX = "Canonical evidence records this request:";

export const FAILED_V3_TEMPLATE_EXPECTED_FINDING_CODES = [
  "incomplete_evidence_inspection",
  "invalid_session_support_evidence",
  "negligible_enrichment_delta",
  "missing_session_claim_support",
  "unsupported_completion",
  "duplicate_session_template",
  "protocol_leakage",
  "unsupported_opportunity_dismissal"
] as const;

export type FailedV3TemplateSession = {
  sessionId: string;
  title?: string;
  request: string;
  evidence: Array<{ id: string; text: string; observedAt?: string }>;
};

export type FailedV3TemplateOpportunity = {
  opportunityId: string;
  evidenceRefs: string[];
};

export type FailedV3TemplateInput = {
  assignmentId: string;
  evidenceRevision: string;
  sessions: FailedV3TemplateSession[];
  opportunities: FailedV3TemplateOpportunity[];
};

/**
 * Reproduces the deterministically wrapped, sampled, blanket-dismissed V3
 * campaign that looked complete while adding no reusable knowledge.
 */
export function failedV3TemplateBundle(input: FailedV3TemplateInput): GuidedAuthoringBundleV4 {
  if (input.sessions.length !== 12) throw new Error("failed_v3_fixture_requires_12_sessions");
  return {
    bundleVersion: "workbench-authoring-v4",
    assignmentId: input.assignmentId,
    evidenceRevision: input.evidenceRevision,
    sessionEnrichments: input.sessions.map((session, index) => ({
      sessionId: session.sessionId,
      enrichment: deterministicTemplateEnrichment(session, index === input.sessions.length - 1),
      claimSupport: sampledFirstAndLastSupports(session)
    })),
    opportunityDispositions: input.opportunities.map((opportunity) => ({
      opportunityId: opportunity.opportunityId,
      disposition: "dismissed",
      rationale: "No reusable artifact was identified.",
      evidenceRefs: opportunity.evidenceRefs.slice(0, 1)
    })),
    artifacts: []
  };
}

function deterministicTemplateEnrichment(session: FailedV3TemplateSession, includeProtocolLeak: boolean): DurableSessionEnrichment {
  const first = session.evidence[0];
  const last = session.evidence.at(-1) ?? first;
  const evidenceRefs = [first, last].filter((item): item is NonNullable<typeof item> => Boolean(item)).map(toEvidenceRef);
  return {
    version: "session-capsule-v4",
    source: "deterministic",
    promptVersion: "v3-template-campaign",
    sessionTitle: {
      text: session.title?.trim() || "Selected session evidence review",
      basis: "first_prompt",
      confidence: "high",
      evidenceRefs
    },
    sessionSummary: {
      text: `${FAILED_V3_SUMMARY_PREFIX}${includeProtocolLeak ? " I reviewed all evidence before using workbench author save." : " canonical evidence was reviewed."}`,
      state: "completed",
      confidence: "high",
      evidenceRefs
    },
    sessionDossier: {
      purpose: "Canonical evidence records reviewed request.",
      outcome: "Canonical evidence records reviewed session.",
      keyWork: ["Canonical evidence records reviewed selected session."],
      decisions: [],
      blockers: [],
      verification: {
        status: "unknown",
        summary: "Verification status was not available in the sampled evidence.",
        commands: [],
        failures: [],
        evidenceRefs
      },
      continuation: { openQuestions: [], constraints: [] },
      evidenceRefs,
      warnings: []
    }
  };
}

function sampledFirstAndLastSupports(session: FailedV3TemplateSession): WorkbenchClaimSupport[] {
  const first = session.evidence[0];
  const last = session.evidence.at(-1) ?? first;
  const supports: WorkbenchClaimSupport[] = [];
  if (first) {
    supports.push({
      path: "/sessionTitle/text",
      supportKind: "reuse",
      evidenceRef: first.id,
      excerpt: excerpt(first.text)
    }, {
      path: "/sessionDossier/purpose",
      supportKind: "purpose",
      evidenceRef: first.id,
      excerpt: excerpt(first.text)
    });
  }
  if (last) {
    supports.push({
      path: "/sessionSummary/text",
      supportKind: "outcome",
      evidenceRef: last.id,
      excerpt: excerpt(last.text)
    }, {
      path: "/sessionDossier/outcome",
      supportKind: "outcome",
      evidenceRef: last.id,
      excerpt: excerpt(last.text)
    }, {
      path: "/sessionDossier/keyWork/0",
      supportKind: "change",
      evidenceRef: last.id,
      excerpt: excerpt(last.text)
    }, {
      path: "/sessionDossier/verification/summary",
      supportKind: "verification",
      evidenceRef: last.id,
      excerpt: excerpt(last.text)
    });
  }
  return supports;
}

function toEvidenceRef(item: { id: string; observedAt?: string }): EvidenceRef {
  return {
    id: item.id,
    kind: "event",
    observedAt: item.observedAt ?? "2026-07-19T00:00:00.000Z",
    source: "failed-v3-template-fixture"
  };
}

function excerpt(text: string): string {
  const normalized = normalize(text);
  return normalized.length >= 20 ? normalized.slice(0, 240) : `${normalized} — sampled canonical evidence`.slice(0, 240);
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
