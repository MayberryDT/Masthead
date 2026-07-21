import type {
  GuidedAuthoringAssignmentDto,
  GuidedAuthoringBundleV4,
  GuidedEvidenceCoverageDto
} from "../../shared/guidedAuthoring.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import type {
  WorkbenchAutomaticArtifactKind,
  WorkbenchAuthoringFinding,
  WorkbenchClaimSupport
} from "../../shared/workbenchAuthoring.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";
import {
  findUnsupportedProtocolFields,
  isPositiveVerificationEvidence,
  substantiveFingerprint,
  validateArtifactQuality,
  type ArtifactQualityFinding
} from "./artifactQuality.ts";
import { GUIDED_ARTIFACT_RUBRICS } from "./guidedAuthoringPolicy.ts";

export type GuidedQualityOpportunity = {
  opportunityId: string;
  suggestedKind: WorkbenchAutomaticArtifactKind;
  signalStrength: "high" | "medium";
  summary: string;
  evidenceRefs: string[];
  provenanceSessionIds: string[];
};

export type GuidedAcceptedDraftForQuality = {
  assignmentId: string;
  draftRevision: number;
  evidenceRevision: string;
  draft: GuidedAuthoringBundleV4;
};

export type GuidedAuthoringValidationInput = {
  bundle: GuidedAuthoringBundleV4;
  assignment: Pick<
    GuidedAuthoringAssignmentDto,
    "assignmentId" | "requestId" | "evidenceRevision" | "sessionIds" | "opportunityIds"
  >;
  canonicalDossiersBySession: ReadonlyMap<string, SessionDossierDto>;
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>;
  coverage: GuidedEvidenceCoverageDto[];
  opportunities: GuidedQualityOpportunity[];
  requestAcceptedDrafts: GuidedAcceptedDraftForQuality[];
};

export const GUIDED_AUTHORING_FINDING_CODES = [
  "guided_assignment_mismatch", "guided_evidence_revision_mismatch",
  "missing_session_enrichment", "unexpected_session_enrichment",
  "incomplete_evidence_inspection", "invalid_session_claim_path",
  "invalid_session_support_kind", "invalid_session_support_evidence", "unsupported_claim_excerpt",
  "evidence_outside_session", "claim_support_ref_not_declared", "negligible_enrichment_delta",
  "missing_session_claim_support",
  "unsupported_completion", "duplicate_session_template", "protocol_leakage",
  "missing_opportunity_disposition", "unexpected_opportunity_disposition",
  "invalid_opportunity_evidence", "invalid_opportunity_artifact_link", "invalid_opportunity_merge",
  "unexpected_artifact_draft", "unsupported_opportunity_dismissal",
  "incomplete_artifact_rubric", "artifact_requires_raw_evidence", "missing_claim_support",
  "missing_required_support_kind", "missing_root_cause_support", "invalid_support_kind_evidence",
  "invalid_timeline_order", "invalid_timeline_support", "duplicate_artifact_content"
] as const;

export type GuidedAuthoringFindingCode = typeof GUIDED_AUTHORING_FINDING_CODES[number];
export type GuidedAuthoringFinding = Omit<WorkbenchAuthoringFinding, "code"> & {
  code: GuidedAuthoringFindingCode;
};

export const GUIDED_RUBRIC_AXIS_PATHS = {
  runbook: {
    trigger: "/problemSignature",
    preconditions: "/preconditions",
    performed_steps: "/fixSteps",
    expected_results_and_verification: "/validationChecks",
    failure_or_rollback_handling: "/risksOrGaps"
  },
  adr: {
    context: "/context",
    decision: "/decision",
    alternatives: "/alternatives",
    consequences: "/consequences",
    reversal_conditions: "/consequences"
  },
  incident_timeline: {
    symptom_and_impact: "/impact",
    timeline: "/timeline",
    root_cause: "/rootCause",
    contributing_factors: "/contributingFactors",
    remediation: "/remediation",
    recovery_verification: "/status"
  }
} as const;

type RankedFinding = {
  finding: GuidedAuthoringFinding;
  category: 0 | 1 | 2 | 3;
  sessionOrdinal?: number;
  opportunityOrdinal?: number;
  artifactOrdinal?: number;
};

type ClaimRule = {
  path: string;
  supportKind: WorkbenchClaimSupport["supportKind"];
  ownerRefs: string[];
  value: string;
  claimPointer: string;
};

const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with"]);
const BOILERPLATE = new Set(["canonical", "evidence", "record", "records", "request", "reviewed", "selected", "session", "shows", "indicates"]);
const EXPLICIT_MISSING = /\b(?:not run|not verified|no verification|verification missing|unverified)\b/i;
const PURE_MISSING_VERIFICATION_BOUNDARY = /^(?:verification (?:was )?not run|no verification was run(?:,? and no outcome was captured beyond the request)?)\.?$/i;
const RAW_PLACEHOLDER = /\b(?:REPLACE_WITH_[A-Z0-9_]+|see (?:the )?(?:transcript|logs)|as above|TBD|refer to the session)\b/i;
const DIRECT_ROOT_CAUSE_MESSAGE = "Direct canonical evidence establishes a root cause for this opportunity. Preserve the causal statement in rootCause and cite it with root_cause claim support; fix an invalid supportKind instead of deleting the supported field or replacing it with unknown.";
const AXIS_TOKENS: Record<WorkbenchAutomaticArtifactKind, readonly string[]> = {
  runbook: ["trigger", "precondition", "step", "procedure", "repeat", "verification", "rollback", "failure", "operational"],
  adr: ["decision", "alternative", "tradeoff", "consequence", "reversal", "durable"],
  incident_timeline: ["incident", "impact", "timeline", "root cause", "remediation", "recovery", "verification"]
};

export function validateGuidedAuthoringDraft(
  input: GuidedAuthoringValidationInput
): { accepted: boolean; findings: GuidedAuthoringFinding[] } {
  const ranked: RankedFinding[] = [];
  const add = (
    category: RankedFinding["category"],
    finding: GuidedAuthoringFinding,
    order: Omit<RankedFinding, "category" | "finding"> = {}
  ): void => { ranked.push({ category, finding, ...order }); };

  validateEnvelope(input, add);
  validateCoverage(input, add);
  validateSessions(input, add);
  validateOpportunitiesAndArtifacts(input, add);

  ranked.sort(compareRankedFindings);
  const findings = ranked.map(({ finding }) => finding);
  return { accepted: findings.every(({ severity }) => severity !== "error"), findings };
}

function validateEnvelope(
  input: GuidedAuthoringValidationInput,
  add: AddFinding
): void {
  if (input.bundle.assignmentId !== input.assignment.assignmentId) {
    add(0, finding("guided_assignment_mismatch", "Bundle assignment does not match the trusted assignment.", "/assignmentId"), { sessionOrdinal: -2 });
  }
  if (input.bundle.evidenceRevision !== input.assignment.evidenceRevision) {
    add(0, finding("guided_evidence_revision_mismatch", "Bundle evidence revision does not match the assignment evidence revision.", "/evidenceRevision"), { sessionOrdinal: -1 });
  }
}

function validateCoverage(input: GuidedAuthoringValidationInput, add: AddFinding): void {
  const expectedSessionIds = new Set(input.assignment.sessionIds);
  input.assignment.sessionIds.forEach((sessionId, sessionOrdinal) => {
    const rows = input.coverage.filter((row) => row.sessionId === sessionId);
    const row = rows[0];
    if (
      rows.length !== 1 || !row || row.evidenceRevision !== input.assignment.evidenceRevision ||
      row.totalItems <= 0 || row.accessedItems !== row.totalItems || !row.complete ||
      !input.canonicalDossiersBySession.has(sessionId)
    ) {
      add(0, {
        ...finding("incomplete_evidence_inspection", "Assignment session evidence inspection is incomplete or stale.", `/sessionEnrichments/${sessionOrdinal}`),
        sessionId
      }, { sessionOrdinal });
    }
  });
  input.coverage
    .filter(({ sessionId }) => !expectedSessionIds.has(sessionId))
    .sort((left, right) => compareCodeUnits(left.sessionId, right.sessionId) || compareCodeUnits(left.evidenceRevision, right.evidenceRevision))
    .forEach((row, index) => add(0, {
      ...finding("incomplete_evidence_inspection", "Evidence coverage includes a session outside the assignment.", `/sessionEnrichments/${input.assignment.sessionIds.length + index}`),
      sessionId: row.sessionId
    }, { sessionOrdinal: Number.MAX_SAFE_INTEGER }));
  [...input.canonicalDossiersBySession.keys()]
    .filter((sessionId) => !expectedSessionIds.has(sessionId))
    .sort(compareCodeUnits)
    .forEach((sessionId, index) => add(0, {
      ...finding("incomplete_evidence_inspection", "Canonical dossier input includes a session outside the assignment.", `/sessionEnrichments/${input.assignment.sessionIds.length + index}`),
      sessionId
    }, { sessionOrdinal: Number.MAX_SAFE_INTEGER }));
}

function validateSessions(input: GuidedAuthoringValidationInput, add: AddFinding): void {
  const expected = new Set(input.assignment.sessionIds);
  const submittedBySession = new Map(input.bundle.sessionEnrichments.map((entry, index) => [entry.sessionId, { entry, index }]));
  input.assignment.sessionIds.forEach((sessionId, sessionOrdinal) => {
    if (!submittedBySession.has(sessionId)) {
      add(1, {
        ...finding("missing_session_enrichment", "Assignment session is missing its enrichment draft.", `/sessionEnrichments/${sessionOrdinal}`),
        sessionId
      }, { sessionOrdinal });
    }
  });
  input.bundle.sessionEnrichments.forEach((entry, bundleIndex) => {
    const sessionOrdinal = input.assignment.sessionIds.indexOf(entry.sessionId);
    if (!expected.has(entry.sessionId)) {
      add(1, {
        ...finding("unexpected_session_enrichment", "Submitted session enrichment is outside the assignment.", `/sessionEnrichments/${bundleIndex}`),
        sessionId: entry.sessionId
      }, { sessionOrdinal: Number.MAX_SAFE_INTEGER });
      return;
    }
    validateSession(input, entry, bundleIndex, sessionOrdinal, add);
  });
  validateSessionDuplication(input, add);
}

function validateSession(
  input: GuidedAuthoringValidationInput,
  entry: GuidedAuthoringBundleV4["sessionEnrichments"][number],
  bundleIndex: number,
  sessionOrdinal: number,
  add: AddFinding
): void {
  const prefix = `/sessionEnrichments/${bundleIndex}`;
  const rules = claimRules(entry.enrichment);
  const rulesByPath = new Map(rules.map((rule) => [rule.path, rule]));
  const validSupports = new Map<string, WorkbenchClaimSupport[]>();
  const seen = new Set<string>();

  entry.claimSupport.forEach((support, supportIndex) => {
    const supportPrefix = `${prefix}/claimSupport/${supportIndex}`;
    const rule = rulesByPath.get(support.path);
    const duplicate = seen.has(`${support.path}\u0000${support.evidenceRef}`);
    seen.add(`${support.path}\u0000${support.evidenceRef}`);
    if (!rule || duplicate || !isCanonicalPointer(support.path)) {
      add(1, {
        ...finding("invalid_session_claim_path", "Claim support path must resolve to one canonical substantive session field.", `${supportPrefix}/path`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
      return;
    }
    let valid = true;
    if (support.supportKind !== rule.supportKind) {
      valid = false;
      add(1, {
        ...finding("invalid_session_support_kind", `Claim support requires the ${rule.supportKind} support kind.`, `${supportPrefix}/supportKind`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
    const evidence = input.evidenceByRef.get(support.evidenceRef);
    if (!evidence || evidence.sessionId !== entry.sessionId) {
      valid = false;
      add(1, {
        ...finding("evidence_outside_session", "Claim support evidence must belong to the enriched session.", `${supportPrefix}/evidenceRef`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
    if (evidence?.role === "user" && ["change", "outcome", "verification"].includes(rule.supportKind)) {
      valid = false;
      const semantics = rule.supportKind === "change"
        ? { claim: "change", evidence: "performed work" }
        : rule.supportKind === "outcome"
          ? { claim: "outcome", evidence: "work or a result" }
          : { claim: "verification", evidence: "a verification result or boundary" };
      add(1, {
        ...finding(
          "invalid_session_support_evidence",
          `Session ${semantics.claim} support must come from canonical evidence that records ${semantics.evidence}, not a user request.`,
          `${supportPrefix}/evidenceRef`
        ),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
    const excerpt = normalize(support.excerpt);
    if (excerpt.length < 20 || !evidence || !normalize(evidence.text).includes(excerpt)) {
      valid = false;
      add(1, {
        ...finding("unsupported_claim_excerpt", "Claim support must quote at least 20 normalized characters verbatim from canonical evidence.", `${supportPrefix}/excerpt`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
    if (!rule.ownerRefs.includes(support.evidenceRef)) {
      valid = false;
      add(1, {
        ...finding("claim_support_ref_not_declared", "Claim support evidence ref must be declared by the supported durable field owner.", `${supportPrefix}/evidenceRef`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
    if (valid) validSupports.set(rule.path, [...(validSupports.get(rule.path) ?? []), support]);
  });

  validateDurableEvidenceOwners(input, entry, bundleIndex, sessionOrdinal, add);
  for (const rule of rules) {
    if (!(validSupports.get(rule.path)?.length)) {
      add(1, {
        ...finding("missing_session_claim_support", `Claim-bearing session field requires one valid ${rule.supportKind} support.`, `${prefix}/enrichment${rule.claimPointer}`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
  }

  const canonical = input.canonicalDossiersBySession.get(entry.sessionId)?.durableEnrichment;
  const counted = rules.filter((rule) => {
    if (!(validSupports.get(rule.path)?.length)) return false;
    const baseline = canonical ? stringAtPointer(canonical, rule.path) : "";
    if (!isMaterialDelta(rule.value, baseline)) return false;
    return significantTokens(rule.value).filter((token) =>
      validSupports.get(rule.path)!.some((support) => significantTokens(support.excerpt).includes(token))
    ).filter((token, index, all) => all.indexOf(token) === index).length >= 2;
  });
  const hasHeadline = counted.some(({ path }) => path === "/sessionTitle/text" || path === "/sessionSummary/text");
  const hasDossier = counted.some(({ path }) => path.startsWith("/sessionDossier/"));
  if (!hasHeadline || !hasDossier) {
    add(1, {
      ...finding("negligible_enrichment_delta", "Session enrichment must add supported session-specific headline and dossier information.", `${prefix}/enrichment`),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }

  validateCompletion(input, entry, prefix, sessionOrdinal, validSupports, add);
  validateDecisionCoverage(input, entry, prefix, sessionOrdinal, add);
  validateSessionProtocol(input, entry, prefix, sessionOrdinal, validSupports, add);
}

function validateCompletion(
  input: GuidedAuthoringValidationInput,
  entry: GuidedAuthoringBundleV4["sessionEnrichments"][number],
  prefix: string,
  sessionOrdinal: number,
  validSupports: ReadonlyMap<string, WorkbenchClaimSupport[]>,
  add: AddFinding
): void {
  const summary = entry.enrichment.sessionSummary;
  const verification = entry.enrichment.sessionDossier.verification;
  const warnings = entry.enrichment.sessionDossier.warnings.join(" ");
  const hasSupportedResult = [...validSupports.keys()].some((path) =>
    path === "/sessionDossier/outcome" || path.startsWith("/sessionDossier/keyWork/")
  );
  const hasSupportedWorkResult = hasSupportedResult || (
    validSupports.has("/sessionSummary/text") && !isMissingVerificationBoundaryOnly(summary.text)
  );
  const hasMissingVerification = ["missing", "unknown"].includes(verification.status);
  const isSparseMissingResult = !hasSupportedResult && hasMissingVerification;
  if (!summary.text.trim() || (isSparseMissingResult && !isMissingVerificationBoundaryOnly(summary.text))) {
    add(1, {
      ...finding(
        "missing_session_claim_support",
        "Every session capsule requires a nonblank sessionSummary.text. State supported work or results when present; when none is supported and verification is missing or unknown, write a direct pure boundary such as 'Verification not run.' instead of relying on a warning.",
        `${prefix}/enrichment/sessionSummary/text`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
  if (isSparseMissingResult && summary.state === "unknown" && summary.confidence === "high") {
    add(1, {
      ...finding(
        "unsupported_completion",
        "A sparse capsule with unknown work state and no supported outcome, key work, or verification result cannot claim high summary confidence. Set sessionSummary.confidence to low unless canonical evidence supports a more specific result.",
        `${prefix}/enrichment/sessionSummary/confidence`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
  if (summary.state === "unknown" && hasSupportedWorkResult) {
    add(1, {
      ...finding(
        "unsupported_completion",
        "Supported outcome, key work, or result-bearing summary requires a known work state. Set sessionSummary.state to completed, partial, blocked, failed, or paused from the work evidence; keep missing or unknown verification separate in the dossier verification status and warnings.",
        `${prefix}/enrichment/sessionSummary/state`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
  if (hasSupportedResult && isMissingVerificationBoundaryOnly(summary.text)) {
    add(1, {
      ...finding(
        "missing_session_claim_support",
        "Session summary must state the specific supported work or result already present in the dossier. Keep missing or unknown verification explicit in verification status and warnings, and use it only as a caveat; a pure 'Verification not run.' summary is reserved for sessions with no supported outcome or key work.",
        `${prefix}/enrichment/sessionSummary/text`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
  let unsupported = false;
  const omittedPositiveVerification = ["missing", "unknown"].includes(verification.status) &&
    [...input.evidenceByRef.entries()].some(([evidenceRef, evidence]) =>
      evidence.sessionId === entry.sessionId && isPositiveVerificationEvidence({
        path: "/sessionDossier/verification/summary",
        supportKind: "verification",
        evidenceRef,
        excerpt: evidence.text
      }, evidence)
    );
  if (omittedPositiveVerification) {
    add(1, {
      ...finding(
        "unsupported_completion",
        "Canonical session evidence records successful verification. Preserve that result with passed status, a specific verification summary, and direct verification claim support instead of reporting verification as missing or unknown.",
        `${prefix}/enrichment/sessionDossier/verification/status`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
  if (verification.status === "passed") {
    unsupported ||= !(validSupports.get("/sessionDossier/verification/summary") ?? []).some((support) =>
      Boolean(input.evidenceByRef.get(support.evidenceRef)) &&
      isPositiveVerificationEvidence(support, input.evidenceByRef.get(support.evidenceRef)!)
    );
  }
  if (["missing", "unknown"].includes(verification.status)) {
    unsupported ||= !EXPLICIT_MISSING.test(warnings);
  }
  if (["failed", "mixed"].includes(verification.status)) {
    unsupported ||= !verification.summary.trim() ||
      !(validSupports.get("/sessionDossier/verification/summary")?.length) ||
      !/\b(?:fail(?:ed|ure)?|mixed|error|unsuccessful|did not pass|not pass)\b/i.test(verification.summary);
  }
  if (unsupported && !omittedPositiveVerification) {
    add(1, {
      ...finding(
        "unsupported_completion",
        "Keep this required session enrichment and report verification honestly: cite supported passed/failed verification, or use missing/unknown verification with an explicit 'Verification not run.' warning. Session completion state describes the work outcome separately from verification status. Use a pure 'Verification not run.' session summary only when canonical evidence supports no outcome or key work.",
        `${prefix}/enrichment/sessionSummary/state`
      ),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
}

function validateDecisionCoverage(
  input: GuidedAuthoringValidationInput,
  entry: GuidedAuthoringBundleV4["sessionEnrichments"][number],
  prefix: string,
  sessionOrdinal: number,
  add: AddFinding
): void {
  if (entry.enrichment.sessionDossier.decisions.length > 0) return;
  const hasHighSignalDecisionEvidence = input.opportunities.some((opportunity) =>
    opportunity.signalStrength === "high" &&
    opportunity.suggestedKind === "adr" &&
    opportunity.provenanceSessionIds.includes(entry.sessionId) &&
    opportunity.evidenceRefs.some((evidenceRef) => {
      const evidence = input.evidenceByRef.get(evidenceRef);
      return Boolean(evidence && evidence.sessionId === entry.sessionId && isExplicitDecisionEvidence(evidence));
    })
  );
  if (!hasHighSignalDecisionEvidence) return;
  add(1, {
    ...finding(
      "missing_session_claim_support",
      "High-signal canonical decision evidence requires at least one specific, directly supported session dossier decision.",
      `${prefix}/enrichment/sessionDossier/decisions`
    ),
    sessionId: entry.sessionId
  }, { sessionOrdinal });
}

function isExplicitDecisionEvidence(evidence: WorkbenchValidationEvidence): boolean {
  if (evidence.lowValue || evidence.role === "user") return false;
  const label = normalize(evidence.label ?? "").toLowerCase();
  if (evidence.kind === "checkpoint" && /\bdecision_(?:approved|recorded)\b/u.test(label)) return true;
  const text = normalize(evidence.text).toLowerCase();
  const committed = (
    /\b(?:decision|choice|direction|contract|policy|approach|architecture|design|default|source of truth)\s*(?::|\bis\b|\bwas\b|\bwill be\b)/u.test(text) ||
    /\b(?:decided|chose|selected|adopted|committed|settled on)\b/u.test(text)
  );
  const explicitCommitment = /\bdecision\s*:/u.test(text) ||
    /\b(?:decided|chose|selected|adopted|committed|settled on)\b/u.test(text);
  const hypotheticalOnly = /\b(?:if|could|might|may|would|should|proposed|hypothetical|possible)\b/u.test(text) &&
    !explicitCommitment;
  return text.length >= 20 && committed && !hypotheticalOnly;
}

function validateSessionProtocol(
  input: GuidedAuthoringValidationInput,
  entry: GuidedAuthoringBundleV4["sessionEnrichments"][number],
  prefix: string,
  sessionOrdinal: number,
  validSupports: ReadonlyMap<string, WorkbenchClaimSupport[]>,
  add: AddFinding
): void {
  const fields = [
    ...claimRules(entry.enrichment).map(({ path, value }) => ({ path, value })),
    ...entry.enrichment.sessionDossier.warnings.map((value, index) => ({
      path: `/sessionDossier/warnings/${index}`,
      value
    }))
  ];
  const findings = findUnsupportedProtocolFields(fields, {
    policy: "guided_v4",
    findingCode: "authoring_protocol_leakage",
    isSupportedMatch: ({ path, matchedText }) => (validSupports.get(path) ?? []).some((support) => {
      const evidence = input.evidenceByRef.get(support.evidenceRef);
      return normalize(support.excerpt).toLowerCase().includes(normalize(matchedText).toLowerCase()) &&
        normalize(evidence?.text ?? "").toLowerCase().includes(normalize(matchedText).toLowerCase());
    })
  });
  for (const protocol of findings) {
    const pointer = dotPathToPointer(protocol.path ?? "");
    add(1, {
      ...finding("protocol_leakage", protocol.message, `${prefix}/enrichment${pointer}`),
      sessionId: entry.sessionId
    }, { sessionOrdinal });
  }
}

function validateDurableEvidenceOwners(
  input: GuidedAuthoringValidationInput,
  entry: GuidedAuthoringBundleV4["sessionEnrichments"][number],
  bundleIndex: number,
  sessionOrdinal: number,
  add: AddFinding
): void {
  const owners: Array<{ pointer: string; refs: { id: string }[] }> = [
    { pointer: "/sessionTitle/evidenceRefs", refs: entry.enrichment.sessionTitle.evidenceRefs },
    { pointer: "/sessionSummary/evidenceRefs", refs: entry.enrichment.sessionSummary.evidenceRefs },
    { pointer: "/sessionDossier/evidenceRefs", refs: entry.enrichment.sessionDossier.evidenceRefs },
    { pointer: "/sessionDossier/verification/evidenceRefs", refs: entry.enrichment.sessionDossier.verification.evidenceRefs }
  ];
  for (const owner of owners) owner.refs.forEach((ref, refIndex) => {
    const evidence = input.evidenceByRef.get(ref.id);
    if (!evidence || evidence.sessionId !== entry.sessionId) {
      add(1, {
        ...finding("evidence_outside_session", "Durable evidence ref must belong to the enriched session.", `/sessionEnrichments/${bundleIndex}/enrichment${owner.pointer}/${refIndex}`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
  });
}

function validateSessionDuplication(input: GuidedAuthoringValidationInput, add: AddFinding): void {
  const historical = input.requestAcceptedDrafts.flatMap(({ draft }) => draft.sessionEnrichments);
  const bySession = new Map(input.bundle.sessionEnrichments.map((entry, index) => [entry.sessionId, { entry, index }]));
  input.assignment.sessionIds.forEach((sessionId, sessionOrdinal) => {
    const submitted = bySession.get(sessionId);
    if (!submitted) return;
    const { entry, index } = submitted;
    const current = sessionShingles(entry.enrichment);
    const previous = [
      ...input.assignment.sessionIds.slice(0, sessionOrdinal).flatMap((earlierId) => {
        const earlier = bySession.get(earlierId);
        return earlier ? [earlier.entry] : [];
      }),
      ...historical
    ]
      .filter((other) => other.sessionId !== entry.sessionId);
    if (previous.some((other) => jaccard(current, sessionShingles(other.enrichment)) > 0.82)) {
      add(1, {
        ...finding("duplicate_session_template", "Session enrichment duplicates a prior request session template.", `/sessionEnrichments/${index}/enrichment`),
        sessionId: entry.sessionId
      }, { sessionOrdinal });
    }
  });
}

function validateOpportunitiesAndArtifacts(input: GuidedAuthoringValidationInput, add: AddFinding): void {
  const expectedIds = new Set(input.assignment.opportunityIds);
  const opportunities = new Map(input.opportunities.map((opportunity) => [opportunity.opportunityId, opportunity]));
  const dispositions = new Map(input.bundle.opportunityDispositions.map((disposition, index) => [disposition.opportunityId, { disposition, index }]));
  const artifacts = new Map(input.bundle.artifacts.map((artifact, index) => [artifact.draftId, { artifact, index }]));
  const linked = new Map<string, string>();

  input.opportunities.forEach((opportunity) => {
    if (expectedIds.has(opportunity.opportunityId)) return;
    add(2, {
      ...finding("unexpected_opportunity_disposition", "Quality opportunity definition is outside the persisted assignment opportunities.", `/opportunityDispositions/${input.assignment.opportunityIds.length}`),
      opportunityId: opportunity.opportunityId
    }, { opportunityOrdinal: Number.MAX_SAFE_INTEGER });
  });

  input.assignment.opportunityIds.forEach((opportunityId, opportunityOrdinal) => {
    const opportunity = opportunities.get(opportunityId);
    const submitted = dispositions.get(opportunityId);
    if (!submitted) {
      add(2, {
        ...finding("missing_opportunity_disposition", "Persisted opportunity is missing its disposition.", `/opportunityDispositions/${opportunityOrdinal}`),
        opportunityId
      }, { opportunityOrdinal });
      return;
    }
    if (!opportunity) {
      add(2, {
        ...finding("invalid_opportunity_evidence", "Persisted assignment opportunity definition is missing.", `/opportunityDispositions/${submitted.index}/evidenceRefs`),
        opportunityId
      }, { opportunityOrdinal });
      return;
    }
    validateDisposition(input, opportunity, submitted.disposition, submitted.index, opportunityOrdinal, artifacts, linked, add);
  });

  input.bundle.opportunityDispositions.forEach((disposition, index) => {
    if (expectedIds.has(disposition.opportunityId)) return;
    add(2, {
      ...finding("unexpected_opportunity_disposition", "Submitted disposition is outside the persisted assignment opportunities.", `/opportunityDispositions/${index}`),
      opportunityId: disposition.opportunityId
    }, { opportunityOrdinal: Number.MAX_SAFE_INTEGER });
  });

  validateMergeGraph(input, opportunities, dispositions, artifacts, add);
  input.bundle.artifacts.forEach((artifact, artifactOrdinal) => {
    const seedOrdinal = input.assignment.sessionIds.indexOf(artifact.seedSessionId);
    const sessionOrdinal = seedOrdinal < 0 ? Number.MAX_SAFE_INTEGER : seedOrdinal;
    if (!linked.has(artifact.draftId)) {
      add(2, artifactFinding(
        "unexpected_artifact_draft", "Submitted artifact draft is not linked by exactly one opportunity disposition.",
        `/artifacts/${artifactOrdinal}`, artifact
      ), { sessionOrdinal, artifactOrdinal });
      return;
    }
    validateArtifact(input, artifact, artifactOrdinal, sessionOrdinal, add);
  });
  validateArtifactDuplicates(input, add);
}

function validateDisposition(
  input: GuidedAuthoringValidationInput,
  opportunity: GuidedQualityOpportunity,
  disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number],
  dispositionIndex: number,
  opportunityOrdinal: number,
  artifacts: Map<string, { artifact: GuidedAuthoringBundleV4["artifacts"][number]; index: number }>,
  linked: Map<string, string>,
  add: AddFinding
): void {
  const citedTexts: string[] = [];
  if (!disposition.evidenceRefs.length) {
    add(2, opportunityFinding("invalid_opportunity_evidence", "Disposition must cite persisted opportunity evidence.", `/opportunityDispositions/${dispositionIndex}/evidenceRefs`, disposition), { opportunityOrdinal });
  }
  disposition.evidenceRefs.forEach((ref, refIndex) => {
    const evidence = input.evidenceByRef.get(ref);
    if (!opportunity.evidenceRefs.includes(ref) || !evidence || !opportunity.provenanceSessionIds.includes(evidence.sessionId)) {
      add(2, opportunityFinding("invalid_opportunity_evidence", "Disposition evidence must belong to the persisted opportunity.", `/opportunityDispositions/${dispositionIndex}/evidenceRefs/${refIndex}`, disposition), { opportunityOrdinal });
    } else citedTexts.push(evidence.text);
  });

  const hasProtocolFinding = validateDispositionProtocol(input, opportunity, disposition, dispositionIndex, opportunityOrdinal, add);
  const rationale = normalize(disposition.rationale);
  if (
    (disposition.disposition === "authored" || disposition.disposition === "merged") &&
    !hasProtocolFinding && (rationale.length < 40 || RAW_PLACEHOLDER.test(disposition.rationale))
  ) {
    add(2, opportunityFinding(
      "unsupported_opportunity_dismissal",
      "Disposition rationale must be a specific evidence-backed judgment and cannot contain scaffold placeholder text.",
      `/opportunityDispositions/${dispositionIndex}/rationale`,
      disposition
    ), { opportunityOrdinal });
  }
  if (disposition.disposition === "dismissed" || disposition.disposition === "changed_kind") {
    const significant = significantTokens(`${opportunity.summary} ${citedTexts.join(" ")}`);
    const shared = new Set(significantTokens(rationale).filter((token) => significant.includes(token))).size;
    const namesSuggestedAxis = AXIS_TOKENS[opportunity.suggestedKind].some((axis) => rationale.toLowerCase().includes(axis));
    const hasKindJudgment = disposition.disposition !== "changed_kind" || Boolean(
      disposition.artifactKind && supportsChangedKindRationale(rationale, opportunity.suggestedKind, disposition.artifactKind)
    );
    if (rationale.length < 40 || shared < 2 || !namesSuggestedAxis || !hasKindJudgment) {
      add(2, opportunityFinding("unsupported_opportunity_dismissal", "Disposition rationale must make a specific evidence-backed kind judgment.", `/opportunityDispositions/${dispositionIndex}/rationale`, disposition), { opportunityOrdinal });
    }
    const earlierIds = new Set(input.assignment.opportunityIds.slice(0, opportunityOrdinal));
    const earlier = input.bundle.opportunityDispositions.filter((other) =>
      earlierIds.has(other.opportunityId) && ["dismissed", "changed_kind"].includes(other.disposition)
    );
    if (earlier.some((other) => normalize(other.rationale) === rationale || jaccard(shingles(other.rationale), shingles(rationale)) > 0.82)) {
      add(2, opportunityFinding("unsupported_opportunity_dismissal", "Disposition rationale duplicates a different opportunity judgment.", `/opportunityDispositions/${dispositionIndex}/rationale`, disposition), { opportunityOrdinal });
    }
    const trustedOpportunityTexts = opportunity.evidenceRefs.flatMap((ref) => {
      const evidence = input.evidenceByRef.get(ref);
      return evidence && opportunity.provenanceSessionIds.includes(evidence.sessionId) ? [evidence.text] : [];
    });
    if (disposition.disposition === "dismissed" && hasAuthorableOpportunityEvidence(opportunity, trustedOpportunityTexts)) {
      add(2, opportunityFinding(
        "unsupported_opportunity_dismissal",
        `The cited high-signal evidence supplies the ${opportunity.suggestedKind} reuse axes. Keep the scaffolded artifact and repair its reported fields instead of dismissing it.`,
        `/opportunityDispositions/${dispositionIndex}/rationale`,
        disposition
      ), { opportunityOrdinal });
    }
  }

  if (disposition.disposition === "authored" || disposition.disposition === "changed_kind") {
    const draftId = disposition.artifactDraftId!;
    const draftRow = artifacts.get(draftId);
    if (!draftRow || linked.has(draftId)) {
      add(2, opportunityFinding("invalid_opportunity_artifact_link", "Disposition must link exactly one submitted artifact draft.", `/opportunityDispositions/${dispositionIndex}/artifactDraftId`, disposition), {
        ...(draftRow ? { sessionOrdinal: assignmentOrdinal(input, draftRow.artifact.seedSessionId) } : {}),
        opportunityOrdinal
      });
      return;
    }
    linked.set(draftId, disposition.opportunityId);
    const expectedSameKind = disposition.disposition === "authored";
    const sameKind = draftRow.artifact.kind === opportunity.suggestedKind && disposition.artifactKind === draftRow.artifact.kind;
    if (sameKind !== expectedSameKind || disposition.artifactKind !== draftRow.artifact.kind) {
      add(2, opportunityFinding("invalid_opportunity_artifact_link", "Disposition artifact kind does not match its resolution semantics and linked draft.", `/opportunityDispositions/${dispositionIndex}/artifactKind`, disposition), {
        sessionOrdinal: assignmentOrdinal(input, draftRow.artifact.seedSessionId), opportunityOrdinal
      });
    }
    validateLinkedProvenance(input, opportunity, disposition, draftRow, opportunityOrdinal, add);
  }
}

function hasAuthorableOpportunityEvidence(opportunity: GuidedQualityOpportunity, citedTexts: string[]): boolean {
  if (opportunity.signalStrength !== "high") return false;
  const text = normalize(citedTexts.join(" ")).toLowerCase();
  if (opportunity.suggestedKind === "runbook") {
    return /\b(?:failed|failure|error|invalid|stale|blocked|regression)\b/u.test(text) &&
      /\b(?:clear|cleared|replace|replaced|retry|retried|restart|restarted|repair|repaired|fix|fixed)\b/u.test(text) &&
      /\b(?:passed|verified|confirmed|accepted|rejected|succeeded)\b/u.test(text) &&
      /\b(?:rollback|restore|revert|fallback|stop)\b/u.test(text);
  }
  if (opportunity.suggestedKind === "adr") {
    return /\b(?:decision|adopt|choose|selected)\b/u.test(text) &&
      /\b(?:alternative|rejected|instead)\b/u.test(text) &&
      /\b(?:consequence|tradeoff|revisit|reverse|replace|supersede)\b/u.test(text);
  }
  return /\b(?:blocked|failed|failure|unavailable|impact|incident|could not)\b/u.test(text) &&
    /\b(?:identified|root cause|caused|because|stale|owned by)\b/u.test(text) &&
    /\b(?:clear|cleared|restart|restarted|remediat|mitigat|repair|fixed)\w*\b/u.test(text) &&
    /\b(?:passed|verified|confirmed|recovered|resolved|restored|succeeded|exactly once)\b/u.test(text);
}

function validateLinkedProvenance(
  input: GuidedAuthoringValidationInput,
  opportunity: GuidedQualityOpportunity,
  disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number],
  row: { artifact: GuidedAuthoringBundleV4["artifacts"][number]; index: number },
  opportunityOrdinal: number,
  add: AddFinding
): void {
  const { artifact, index } = row;
  const members = new Set(input.assignment.sessionIds);
  const outputProvenance = stringArray(artifact.output.provenanceSessionIds);
  const required = opportunity.provenanceSessionIds.every((id) => artifact.provenanceSessionIds.includes(id));
  if (!members.has(artifact.seedSessionId) || !artifact.provenanceSessionIds.includes(artifact.seedSessionId)) {
    add(2, artifactRelationshipFinding("invalid_opportunity_artifact_link", "Linked artifact seed must be an assignment provenance member.", `/artifacts/${index}/seedSessionId`, disposition, artifact), { sessionOrdinal: assignmentOrdinal(input, artifact.seedSessionId), opportunityOrdinal, artifactOrdinal: index });
  } else if (!artifact.provenanceSessionIds.every((id) => members.has(id)) || !required) {
    add(2, artifactRelationshipFinding("invalid_opportunity_artifact_link", "Linked artifact provenance must include the persisted opportunity provenance within the assignment.", `/artifacts/${index}/provenanceSessionIds`, disposition, artifact), { sessionOrdinal: assignmentOrdinal(input, artifact.seedSessionId), opportunityOrdinal, artifactOrdinal: index });
  } else if (!sameStringSet(artifact.provenanceSessionIds, outputProvenance)) {
    add(2, artifactRelationshipFinding("invalid_opportunity_artifact_link", "Artifact envelope and output provenance must match exactly.", `/artifacts/${index}/output/provenanceSessionIds`, disposition, artifact), { sessionOrdinal: assignmentOrdinal(input, artifact.seedSessionId), opportunityOrdinal, artifactOrdinal: index });
  }
}

function validateDispositionProtocol(input: GuidedAuthoringValidationInput, opportunity: GuidedQualityOpportunity, disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number], index: number, opportunityOrdinal: number, add: AddFinding): boolean {
  const findings = findUnsupportedProtocolFields([{ path: "rationale", value: disposition.rationale }], {
    policy: "guided_v4",
    findingCode: "authoring_protocol_leakage",
    isSupportedMatch: ({ matchedText }) => disposition.evidenceRefs.some((ref) => {
      const evidence = input.evidenceByRef.get(ref);
      return opportunity.evidenceRefs.includes(ref) && Boolean(evidence) && opportunity.provenanceSessionIds.includes(evidence!.sessionId) && normalize(evidence!.text).toLowerCase().includes(normalize(matchedText).toLowerCase());
    })
  });
  for (const protocol of findings) {
    add(2, opportunityFinding("protocol_leakage", protocol.message, `/opportunityDispositions/${index}/rationale`, disposition), { opportunityOrdinal });
  }
  return findings.length > 0;
}

function validateMergeGraph(
  input: GuidedAuthoringValidationInput,
  opportunities: Map<string, GuidedQualityOpportunity>,
  dispositions: Map<string, { disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number]; index: number }>,
  artifacts: Map<string, { artifact: GuidedAuthoringBundleV4["artifacts"][number]; index: number }>,
  add: AddFinding
): void {
  const expectedIds = new Set(input.assignment.opportunityIds);
  input.bundle.opportunityDispositions.forEach((start, index) => {
    if (start.disposition !== "merged") return;
    const opportunityOrdinal = input.assignment.opportunityIds.indexOf(start.opportunityId);
    const visited = new Set([start.opportunityId]);
    let current = start;
    let invalid = !current.mergedIntoOpportunityId || current.mergedIntoOpportunityId === start.opportunityId;
    while (!invalid && current.disposition === "merged") {
      const targetId = current.mergedIntoOpportunityId!;
      if (visited.has(targetId) || !expectedIds.has(targetId) || !opportunities.has(targetId)) { invalid = true; break; }
      visited.add(targetId);
      const target = dispositions.get(targetId)?.disposition;
      if (!target) { invalid = true; break; }
      current = target;
    }
    if (current.disposition === "dismissed") invalid = true;
    if (!invalid && (current.disposition === "authored" || current.disposition === "changed_kind")) {
      const terminal = artifacts.get(current.artifactDraftId ?? "")?.artifact;
      const required = [...visited].flatMap((id) => opportunities.get(id)?.provenanceSessionIds ?? []);
      invalid = !terminal || required.some((id) => !terminal.provenanceSessionIds.includes(id));
    }
    if (invalid) add(2, opportunityFinding("invalid_opportunity_merge", "Merged opportunity must terminate at one artifact with complete union provenance.", `/opportunityDispositions/${index}/mergedIntoOpportunityId`, start), { opportunityOrdinal });
  });
}

function validateArtifact(input: GuidedAuthoringValidationInput, artifact: GuidedAuthoringBundleV4["artifacts"][number], artifactOrdinal: number, sessionOrdinal: number, add: AddFinding): void {
  const supports = claimSupports(artifact.output.claimSupport);
  const evidence = new Map(input.evidenceByRef);
  const directCauseRefs = directRootCauseEvidenceRefs(input, artifact);
  let mappedDirectCauseFinding = false;
  for (const quality of validateArtifactQuality({
    kind: artifact.kind,
    output: artifact.output,
    supports,
    evidenceByRef: evidence,
    provenanceSessionIds: artifact.provenanceSessionIds,
    protocolLeakageFindingCode: "authoring_protocol_leakage",
    protocolPolicy: "guided_v4"
  })) {
    const mapped = mapGuidedArtifactQualityFinding({ artifact, artifactOrdinal, finding: quality });
    if (!mapped) continue;
    if (quality.code === "missing_root_cause_support" && directCauseRefs.size > 0) {
      mapped.message = DIRECT_ROOT_CAUSE_MESSAGE;
      mappedDirectCauseFinding = true;
    }
    add(3, mapped, { sessionOrdinal, artifactOrdinal });
  }
  if ((artifact.kind === "runbook" || artifact.kind === "incident_timeline") && directCauseRefs.size > 0) {
    const rootCause = typeof artifact.output.rootCause === "string" ? artifact.output.rootCause.trim() : "";
    const hasDirectCauseSupport = supports.some((support) =>
      support.path === "rootCause" &&
      support.supportKind === "root_cause" &&
      directCauseRefs.has(support.evidenceRef) &&
      isGroundedArtifactSupport(support, artifact, input.evidenceByRef)
    );
    if (!mappedDirectCauseFinding && (isExplicitlyUnknownRootCause(rootCause) || !hasDirectCauseSupport)) {
      add(3, artifactFinding(
        "missing_root_cause_support",
        DIRECT_ROOT_CAUSE_MESSAGE,
        `/artifacts/${artifactOrdinal}/output/rootCause`,
        artifact
      ), { sessionOrdinal, artifactOrdinal });
    }
  }
  for (const missing of missingRubricAxes(artifact, supports, input.evidenceByRef)) {
    const message = artifact.kind === "runbook" && missing.axis === "failure or rollback handling"
      ? "Guided runbook draft needs failure handling. Add failure, fallback, recovery, revert, or rollback guidance in deadEnds, risksOrGaps, or preventionNotes, then support that exact field with a verbatim canonical evidence excerpt."
      : artifact.kind === "incident_timeline" && missing.axis === "recovery verification"
        ? "Keep this supported incident timeline. Set status to recovered, resolved, or closed, then support status with the exact canonical recovery checkpoint that records passed, recovered, restored, or exactly-once verification; do not delete the artifact or dismiss its opportunity to escape this finding."
      : `Guided ${artifact.kind} draft is missing the ${missing.axis} reuse axis.`;
    add(3, artifactFinding("incomplete_artifact_rubric", message, `/artifacts/${artifactOrdinal}/output${missing.path}`, artifact), { sessionOrdinal, artifactOrdinal });
  }
  if (artifact.kind === "runbook") {
    for (const omitted of omittedRunbookActionClauses(artifact, supports, input.evidenceByRef)) {
      add(3, artifactFinding(
        "incomplete_artifact_rubric",
        `Guided runbook fix step omits an essential performed-action clause from its cited evidence: ${omitted.clause}.`,
        `/artifacts/${artifactOrdinal}/output${dotPathToPointer(omitted.path)}`,
        artifact
      ), { sessionOrdinal, artifactOrdinal });
    }
    for (const deadEndIndex of unsupportedRunbookDeadEnds(artifact, supports, input.evidenceByRef)) {
      add(3, artifactFinding(
        "incomplete_artifact_rubric",
        "Runbook deadEnds must record an approach that canonical evidence says was actually attempted and failed or abandoned. Move conditional rollback or failure handling to risksOrGaps and remove the duplicate deadEnds entry.",
        `/artifacts/${artifactOrdinal}/output/deadEnds/${deadEndIndex}`,
        artifact
      ), { sessionOrdinal, artifactOrdinal });
    }
  }
  for (const placeholder of requiredArtifactStrings(artifact.kind, artifact.output).filter(({ value }) => RAW_PLACEHOLDER.test(value))) {
    add(3, artifactFinding("artifact_requires_raw_evidence", "Required artifact field contains a raw-evidence placeholder and is not independently reusable.", `/artifacts/${artifactOrdinal}/output${placeholder.path}`, artifact), { sessionOrdinal, artifactOrdinal });
  }
}

function unsupportedRunbookDeadEnds(
  artifact: GuidedAuthoringBundleV4["artifacts"][number],
  supports: WorkbenchClaimSupport[],
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): number[] {
  return stringArray(artifact.output.deadEnds).flatMap((deadEnd, index) => {
    const support = supports.find((candidate) =>
      candidate.path === `deadEnds[${index}]` &&
      candidate.supportKind === "problem" &&
      isGroundedArtifactSupport(candidate, artifact, evidenceByRef)
    );
    const evidenceText = support ? evidenceByRef.get(support.evidenceRef)?.text ?? "" : "";
    const conditionalSafetyRule = /\b(?:if|unless|when)\b.*\b(?:fallback|restore|revert|rollback|stop)\b/i.test(deadEnd);
    const attempted = /\b(?:applied|attempted|ran|restarted|retried|switched|tested|tried|used)\b/i.test(evidenceText);
    const failedOrAbandoned = /\b(?:abandoned|did not work|didn't work|failed|ineffective|reverted|rolled back|stopped using|unsuccessful)\b/i.test(evidenceText);
    return conditionalSafetyRule || !attempted || !failedOrAbandoned ? [index] : [];
  });
}

function directRootCauseEvidenceRefs(
  input: GuidedAuthoringValidationInput,
  artifact: GuidedAuthoringBundleV4["artifacts"][number]
): Set<string> {
  const provenance = new Set(artifact.provenanceSessionIds);
  return new Set([...input.evidenceByRef.entries()].flatMap(([evidenceRef, evidence]) => (
    provenance.has(evidence.sessionId) && isDirectRootCauseEvidence(evidence) ? [evidenceRef] : []
  )));
}

export function isDirectRootCauseEvidence(evidence: WorkbenchValidationEvidence | undefined): boolean {
  if (!evidence || evidence.lowValue || evidence.role === "user") return false;
  if (!["tool_result", "checkpoint", "runtime_signal"].includes(evidence.kind) && evidence.role !== "assistant") return false;
  const text = normalize(evidence.text);
  if (/\b(?:ambiguous|could be|did not establish|insufficient|may|maybe|might|not established|possibly|probably|root cause (?:is|remains) unknown|suspect|unclear|unknown)\b/i.test(text)) return false;
  const failure = /\b(?:blocked|crashed|error|failed|failure|incident|invalid|regression|unavailable)\b/i.test(text);
  const causalLink = /\b(?:because|due to|resulted from|stemmed from|was caused by|were caused by)\b/i.test(text) ||
    /\broot cause\s*(?::|was|is)\s*\S/i.test(text);
  return failure && causalLink;
}

function omittedRunbookActionClauses(
  artifact: GuidedAuthoringBundleV4["artifacts"][number],
  supports: WorkbenchClaimSupport[],
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): Array<{ path: string; clause: string }> {
  const output = artifact.output;
  if (!Array.isArray(output.fixSteps)) return [];
  const omitted: Array<{ path: string; clause: string }> = [];
  for (const support of supports) {
    const match = /^fixSteps\[(\d+)\]$/u.exec(support.path);
    if (!match || support.supportKind !== "change" || !isGroundedArtifactSupport(support, artifact, evidenceByRef)) continue;
    const fixStep = output.fixSteps[Number(match[1])];
    if (typeof fixStep !== "string") continue;
    const clauses = performedActionClauses(evidenceByRef.get(support.evidenceRef)?.text ?? "");
    if (clauses.length < 2) continue;
    const fixTokens = new Set(actionClauseTokens(fixStep));
    for (const clause of clauses) {
      const clauseTokens = actionClauseTokens(clause);
      const requiredOverlap = Math.min(2, clauseTokens.length);
      const overlap = new Set(clauseTokens.filter((token) => fixTokens.has(token))).size;
      if (overlap >= requiredOverlap) continue;
      omitted.push({ path: support.path, clause: clause.replace(/[.;]+$/u, "") });
    }
  }
  return omitted;
}

const PERFORMED_ACTION = /\b(?:added|applied|bound|built|changed|cleared|configured|created|edited|fixed|implemented|modified|patched|removed|repaired|replaced|restarted|restored|retried|set|updated|wrote)\b/iu;

function performedActionClauses(value: string): string[] {
  return normalize(value)
    .split(/;\s*|,\s*(?:and\s+)?|\s+and\s+(?=(?:then\s+)?(?:add|apply|bind|build|change|clear|configure|create|edit|fix|implement|modify|patch|remove|repair|replace|restart|restore|retry|set|update|write)\w*\b)/iu)
    .map((clause) => clause.trim())
    .filter((clause) => PERFORMED_ACTION.test(clause));
}

function actionClauseTokens(value: string): string[] {
  return normalize(value).toLowerCase().match(/[a-z0-9]+/gu)?.map(actionTokenStem).filter((token) =>
    token.length >= 3 && !STOPWORDS.has(token) && !BOILERPLATE.has(token)
  ) ?? [];
}

function actionTokenStem(value: string): string {
  const aliases: Record<string, string> = {
    authorization: "authoriz", authorize: "authoriz", authorized: "authoriz",
    binding: "bind", bound: "bind",
    cleared: "clear", clearing: "clear",
    pending: "pend",
    replaced: "replace", replacement: "replace", replacing: "replace",
    retried: "retry", retrying: "retry",
    validated: "valid", validates: "valid", validating: "valid", validation: "valid"
  };
  return aliases[value] ?? value.replace(/(?:ed|ing|s)$/u, "");
}

function validateArtifactDuplicates(input: GuidedAuthoringValidationInput, add: AddFinding): void {
  const previous = input.requestAcceptedDrafts.flatMap(({ draft }) => draft.artifacts);
  input.bundle.artifacts.forEach((artifact, artifactOrdinal) => {
    const fingerprint = substantiveFingerprint(artifact.kind, artifact.output);
    const duplicates = [...input.bundle.artifacts.slice(0, artifactOrdinal), ...previous].some((other) =>
      other.kind === artifact.kind && substantiveFingerprint(other.kind, other.output) === fingerprint
    );
    if (duplicates) {
      const seedOrdinal = input.assignment.sessionIds.indexOf(artifact.seedSessionId);
      add(3, artifactFinding("duplicate_artifact_content", "Optional artifact duplicates substantive content from another request draft.", `/artifacts/${artifactOrdinal}/output`, artifact), {
        sessionOrdinal: seedOrdinal < 0 ? Number.MAX_SAFE_INTEGER : seedOrdinal,
        artifactOrdinal
      });
    }
  });
}

function missingRubricAxes(artifact: GuidedAuthoringBundleV4["artifacts"][number], supports: WorkbenchClaimSupport[], evidence: ReadonlyMap<string, WorkbenchValidationEvidence>): Array<{ axis: string; path: string }> {
  const output = artifact.output;
  const validSupports = supports.filter((support) => isGroundedArtifactSupport(support, artifact, evidence));
  const supported = (path: string, kind?: WorkbenchClaimSupport["supportKind"]) => validSupports.some((support) => support.path === path && (!kind || support.supportKind === kind));
  const someSupported = (root: string, kind?: WorkbenchClaimSupport["supportKind"]) => validSupports.some((support) => (support.path === root || support.path.startsWith(`${root}[`) || support.path.startsWith(`${root}.`)) && (!kind || support.supportKind === kind));
  const missing: Array<{ axis: string; path: string }> = [];
  if (artifact.kind === "runbook") {
    for (const policyAxis of GUIDED_ARTIFACT_RUBRICS.runbook) {
      if (policyAxis === "trigger" && (!hasRecordContent(output.problemSignature) || !someSupported("problemSignature", "problem"))) missing.push({ axis: policyAxis, path: GUIDED_RUBRIC_AXIS_PATHS.runbook.trigger });
      if (policyAxis === "preconditions" && (!nonemptyArray(output.preconditions) || !someSupported("preconditions", "problem"))) missing.push({ axis: policyAxis, path: GUIDED_RUBRIC_AXIS_PATHS.runbook.preconditions });
      if (policyAxis === "performed steps" && ((!nonemptyArray(output.fixSteps) && !nonemptyArray(output.commands)) || (!someSupported("fixSteps", "change") && !someSupported("commands", "change")))) missing.push({ axis: policyAxis, path: GUIDED_RUBRIC_AXIS_PATHS.runbook.performed_steps });
      if (policyAxis === "expected results" && (!nonemptyArray(output.validationChecks) || !someSupported("validationChecks", "verification"))) missing.push({ axis: policyAxis, path: GUIDED_RUBRIC_AXIS_PATHS.runbook.expected_results_and_verification });
      if (policyAxis === "verification") {
        const verified = validSupports.some((support) => support.path.startsWith("validationChecks[") && support.supportKind === "verification" && isPositiveVerificationEvidence(support, evidence.get(support.evidenceRef)!));
        if (!verified) missing.push({ axis: policyAxis, path: GUIDED_RUBRIC_AXIS_PATHS.runbook.expected_results_and_verification });
      }
    }
    const guidance = [...stringArray(output.deadEnds), ...stringArray(output.risksOrGaps), ...stringArray(output.preventionNotes)].join(" ");
    if (!/\b(?:failure|fallback|recovery|revert|rollback)\b/i.test(guidance) || ![...validSupports].some((support) => /^(?:deadEnds|risksOrGaps|preventionNotes)\[/.test(support.path))) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.runbook[5], path: GUIDED_RUBRIC_AXIS_PATHS.runbook.failure_or_rollback_handling });
  } else if (artifact.kind === "adr") {
    if (!nonblank(output.decision) || !supported("decision", "decision")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.adr[0], path: GUIDED_RUBRIC_AXIS_PATHS.adr.decision });
    if (!nonblank(output.context) || !supported("context", "problem")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.adr[1], path: GUIDED_RUBRIC_AXIS_PATHS.adr.context });
    if (!nonemptyArray(output.alternatives) || !someSupported("alternatives", "alternative")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.adr[2], path: GUIDED_RUBRIC_AXIS_PATHS.adr.alternatives });
    if (!nonemptyArray(output.consequences) || !someSupported("consequences", "decision")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.adr[3], path: GUIDED_RUBRIC_AXIS_PATHS.adr.consequences });
    if (!stringArray(output.consequences).some((value) => /\b(?:revisit|reverse|revert|replace|supersede|if|when|unless|until)\b/i.test(value)) || !someSupported("consequences", "decision")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.adr[4], path: GUIDED_RUBRIC_AXIS_PATHS.adr.reversal_conditions });
  } else {
    if ((!nonblank(output.symptom) && !nonblank(output.impact)) || (!supported("symptom", "problem") && !supported("impact", "problem"))) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[0], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.symptom_and_impact });
    if (!validIncidentTimeline(output.timeline, validSupports, evidence)) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[1], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.timeline });
    const rootCause = typeof output.rootCause === "string" ? output.rootCause.trim() : "";
    if (!rootCause || (!isExplicitlyUnknownRootCause(rootCause) && !supported("rootCause", "root_cause"))) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[2], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.root_cause });
    if (!nonemptyArray(output.contributingFactors) || !someSupported("contributingFactors", "problem")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[3], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.contributing_factors });
    if (!nonemptyArray(output.remediation) || !someSupported("remediation", "remediation")) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[4], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.remediation });
    const statusSupport = supports.find((support) => support.path === "status" && support.supportKind === "verification");
    const terminal = typeof output.status === "string" && ["closed", "recovered", "resolved"].includes(normalize(output.status).toLowerCase());
    if (!terminal || !statusSupport || !validSupports.includes(statusSupport) || !isPositiveVerificationEvidence(statusSupport, evidence.get(statusSupport.evidenceRef)!)) missing.push({ axis: GUIDED_ARTIFACT_RUBRICS.incident_timeline[5], path: GUIDED_RUBRIC_AXIS_PATHS.incident_timeline.recovery_verification });
  }
  return missing;
}

function claimRules(enrichment: GuidedAuthoringBundleV4["sessionEnrichments"][number]["enrichment"]): ClaimRule[] {
  const dossierRefs = enrichment.sessionDossier.evidenceRefs.map(({ id }) => id);
  const verificationRefs = enrichment.sessionDossier.verification.evidenceRefs.map(({ id }) => id);
  const rules: ClaimRule[] = [];
  const add = (path: string, supportKind: ClaimRule["supportKind"], ownerRefs: string[], value: unknown) => {
    if (typeof value === "string" && value.trim()) rules.push({ path, claimPointer: path, supportKind, ownerRefs, value });
  };
  add("/sessionTitle/text", "reuse", enrichment.sessionTitle.evidenceRefs.map(({ id }) => id), enrichment.sessionTitle.text);
  if (!isMissingVerificationBoundaryOnly(enrichment.sessionSummary.text)) {
    add("/sessionSummary/text", "outcome", enrichment.sessionSummary.evidenceRefs.map(({ id }) => id), enrichment.sessionSummary.text);
  }
  add("/sessionDossier/purpose", "purpose", dossierRefs, enrichment.sessionDossier.purpose);
  add("/sessionDossier/outcome", "outcome", dossierRefs, enrichment.sessionDossier.outcome);
  enrichment.sessionDossier.keyWork.forEach((value, i) => add(`/sessionDossier/keyWork/${i}`, "change", dossierRefs, value));
  enrichment.sessionDossier.decisions.forEach((value, i) => add(`/sessionDossier/decisions/${i}`, "decision", dossierRefs, value));
  enrichment.sessionDossier.blockers.forEach((value, i) => add(`/sessionDossier/blockers/${i}`, "blocker", dossierRefs, value));
  add("/sessionDossier/verification/summary", "verification", verificationRefs, enrichment.sessionDossier.verification.summary);
  enrichment.sessionDossier.verification.commands.forEach((value, i) => add(`/sessionDossier/verification/commands/${i}`, "verification", verificationRefs, value));
  enrichment.sessionDossier.verification.failures.forEach((value, i) => add(`/sessionDossier/verification/failures/${i}`, "blocker", verificationRefs, value));
  add("/sessionDossier/continuation/nextStep", "continuation", dossierRefs, enrichment.sessionDossier.continuation.nextStep);
  enrichment.sessionDossier.continuation.openQuestions.forEach((value, i) => add(`/sessionDossier/continuation/openQuestions/${i}`, "continuation", dossierRefs, value));
  enrichment.sessionDossier.continuation.constraints.forEach((value, i) => add(`/sessionDossier/continuation/constraints/${i}`, "continuation", dossierRefs, value));
  return rules;
}

function isMissingVerificationBoundaryOnly(value: string): boolean {
  const text = normalize(value);
  return PURE_MISSING_VERIFICATION_BOUNDARY.test(text);
}

function requiredArtifactStrings(_kind: WorkbenchAutomaticArtifactKind, output: Record<string, unknown>): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") out.push({ path, value });
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}/${index}`));
    else if (isRecord(value)) Object.entries(value).forEach(([key, entry]) => {
      if (["at", "claimSupport", "evidenceRefs", "provenanceSessionIds"].includes(key)) return;
      walk(entry, `${path}/${escapePointer(key)}`);
    });
  };
  Object.entries(output).forEach(([root, value]) => {
    if (["claimSupport", "evidenceRefs", "provenanceSessionIds"].includes(root)) return;
    walk(value, `/${escapePointer(root)}`);
  });
  return out;
}

function mapArtifactQualityCode(code: string): GuidedAuthoringFindingCode | undefined {
  if (code === "unsupported_authoring_protocol_language" || code === "authoring_protocol_leakage") return "protocol_leakage";
  if (code === "duplicate_human_content") return "duplicate_artifact_content";
  const pass = new Set(["unsupported_claim_excerpt", "missing_claim_support", "missing_required_support_kind", "missing_root_cause_support", "invalid_support_kind_evidence", "invalid_timeline_order", "invalid_timeline_support"]);
  return pass.has(code) ? code as GuidedAuthoringFindingCode : undefined;
}

export function mapGuidedArtifactQualityFinding(input: {
  artifact: GuidedAuthoringBundleV4["artifacts"][number];
  artifactOrdinal: number;
  finding: ArtifactQualityFinding;
}): GuidedAuthoringFinding | undefined {
  const code = mapArtifactQualityCode(input.finding.code);
  if (!code) return undefined;
  return artifactFinding(
    code,
    input.finding.message,
    `/artifacts/${input.artifactOrdinal}/output${input.finding.path ? dotPathToPointer(input.finding.path) : ""}`,
    input.artifact
  );
}

function isGroundedArtifactSupport(
  support: WorkbenchClaimSupport,
  artifact: GuidedAuthoringBundleV4["artifacts"][number],
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): boolean {
  const evidence = evidenceByRef.get(support.evidenceRef);
  const excerpt = normalize(support.excerpt);
  const grounded = Boolean(
    evidence &&
    !evidence.lowValue &&
    artifact.provenanceSessionIds.includes(evidence.sessionId) &&
    excerpt.length >= 20 &&
    normalize(evidence.text).includes(excerpt)
  );
  if (!grounded || !evidence) return false;
  if (support.supportKind === "timeline") return Number.isFinite(Date.parse(evidence.observedAt));
  if (support.supportKind === "change") {
    if (evidence.kind === "file_effect") return /^changedFiles\[[0-9]+\]$/u.test(support.path);
    return evidence.kind === "tool_call" ||
      (evidence.role === "assistant" && /\b(?:added|bound|built|changed|cleared|created|edited|fixed|implemented|modified|patched|removed|replaced|retried|updated|wrote)\b/i.test(evidence.text));
  }
  return true;
}

function validIncidentTimeline(
  value: unknown,
  supports: WorkbenchClaimSupport[],
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): boolean {
  if (!Array.isArray(value) || !value.length) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry) || typeof entry.at !== "string" || typeof entry.summary !== "string" || !entry.summary.trim()) return false;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || at < previous) return false;
    const support = supports.find((candidate) => candidate.path === `timeline[${index}].summary` && candidate.supportKind === "timeline");
    if (!support || Date.parse(evidenceByRef.get(support.evidenceRef)?.observedAt ?? "") !== at) return false;
    previous = at;
  }
  return true;
}

function isExplicitlyUnknownRootCause(value: string): boolean {
  const normalized = normalize(value);
  return /^(?:(?:the )?root cause (?:is|remains) (?:unknown|undetermined|not (?:known|established|determined))(?: (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence)?|unknown (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence|(?:the )?(?:available |current )?(?:canonical )?evidence (?:does not establish|is insufficient to establish|cannot determine) (?:the )?root cause)[.!]?$/i.test(normalized);
}

function supportsChangedKindRationale(
  rationale: string,
  suggestedKind: WorkbenchAutomaticArtifactKind,
  replacementKind: WorkbenchAutomaticArtifactKind
): boolean {
  const normalized = rationale.toLowerCase();
  const clauses = normalized.split(/\b(?:but|instead|whereas|while)\b/).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length < 2) return false;
  const deficiency = /\b(?:absent|cannot|deficien\w*|insufficient|lack(?:s|ing|ed)?|missing|no|not|unsupported|weak)\b/i;
  const applicability = /\b(?:applies|appropriate|captures|contains|fits|provides|records|supports)\b/i;
  return clauses.some((left, leftIndex) => {
    if (!deficiency.test(left)) return false;
    const suggestedAxes = AXIS_TOKENS[suggestedKind].filter((axis) => left.includes(axis));
    return clauses.some((right, rightIndex) => {
      if (rightIndex === leftIndex || !applicability.test(right)) return false;
      const replacementAxes = AXIS_TOKENS[replacementKind].filter((axis) => right.includes(axis));
      return suggestedAxes.some((suggested) => replacementAxes.some((replacement) => suggested !== replacement));
    });
  });
}

function finding(code: GuidedAuthoringFindingCode, message: string, path: string): GuidedAuthoringFinding {
  return { code, message, severity: "error", path };
}

function opportunityFinding(code: GuidedAuthoringFindingCode, message: string, path: string, disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number]): GuidedAuthoringFinding {
  return { ...finding(code, message, path), opportunityId: disposition.opportunityId, ...(disposition.artifactDraftId ? { artifactDraftId: disposition.artifactDraftId } : {}) };
}

function artifactFinding(code: GuidedAuthoringFindingCode, message: string, path: string, artifact: GuidedAuthoringBundleV4["artifacts"][number]): GuidedAuthoringFinding {
  return { ...finding(code, message, path), sessionId: artifact.seedSessionId, artifactDraftId: artifact.draftId, artifactKind: artifact.kind };
}

function artifactRelationshipFinding(code: GuidedAuthoringFindingCode, message: string, path: string, disposition: GuidedAuthoringBundleV4["opportunityDispositions"][number], artifact: GuidedAuthoringBundleV4["artifacts"][number]): GuidedAuthoringFinding {
  return { ...artifactFinding(code, message, path, artifact), opportunityId: disposition.opportunityId };
}

type AddFinding = (category: RankedFinding["category"], finding: GuidedAuthoringFinding, order?: Omit<RankedFinding, "category" | "finding">) => void;

function compareRankedFindings(left: RankedFinding, right: RankedFinding): number {
  return left.category - right.category ||
    ordinal(left.sessionOrdinal) - ordinal(right.sessionOrdinal) ||
    ordinal(left.opportunityOrdinal) - ordinal(right.opportunityOrdinal) ||
    ordinal(left.artifactOrdinal) - ordinal(right.artifactOrdinal) ||
    compareCodeUnits(left.finding.path ?? "\uffff", right.finding.path ?? "\uffff") ||
    compareCodeUnits(left.finding.code, right.finding.code) ||
    compareCodeUnits(left.finding.message, right.finding.message);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinal(value: number | undefined): number { return value ?? Number.MAX_SAFE_INTEGER; }
function assignmentOrdinal(input: GuidedAuthoringValidationInput, sessionId: string): number {
  const index = input.assignment.sessionIds.indexOf(sessionId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function tokens(value: string): string[] { return normalize(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
function significantTokens(value: string): string[] { return tokens(value).filter((token) => token.length >= 4 && !STOPWORDS.has(token)); }
function shingles(value: string): Set<string> {
  const words = tokens(value); const result = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i += 1) result.add(words.slice(i, i + 5).join(" "));
  return result;
}
function sessionShingles(enrichment: GuidedAuthoringBundleV4["sessionEnrichments"][number]["enrichment"]): Set<string> {
  return shingles(claimRules(enrichment).map(({ value }) => value).concat(enrichment.sessionDossier.warnings).join(" "));
}
function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0; for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}
function isMaterialDelta(value: string, baseline: string): boolean {
  const current = normalize(value).toLowerCase(); const prior = normalize(baseline).toLowerCase();
  if (current === prior) return false;
  if (!prior) return true;
  if (current.includes(prior) || prior.includes(current)) {
    const priorTokens = tokens(prior); const currentTokens = tokens(current);
    const longer = currentTokens.length >= priorTokens.length ? currentTokens : priorTokens;
    const shorter = currentTokens.length >= priorTokens.length ? priorTokens : currentTokens;
    const extras = [...longer]; for (const token of shorter) { const index = extras.indexOf(token); if (index >= 0) extras.splice(index, 1); }
    if (extras.every((token) => BOILERPLATE.has(token))) return false;
  }
  return true;
}
function stringAtPointer(value: unknown, pointer: string): string {
  let current = value; for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) { if (!/^(?:0|[1-9]\d*)$/.test(key)) return ""; current = current[Number(key)]; }
    else if (isRecord(current)) current = current[key]; else return "";
  }
  return typeof current === "string" ? current : "";
}
function isCanonicalPointer(pointer: string): boolean {
  if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) return false;
  return pointer.split("/").slice(1).every((segment) => escapePointer(segment.replace(/~1/g, "/").replace(/~0/g, "~")) === segment);
}
function dotPathToPointer(path: string): string {
  if (path.startsWith("/")) return isCanonicalPointer(path) ? path : `/${path.split("/").slice(1).map((segment) => escapePointer(segment.replace(/~1/g, "/").replace(/~0/g, "~"))).join("/")}`;
  const segments: string[] = []; path.replace(/([^.\[\]]+)|\[(\d+)\]/g, (_match, key, index) => { segments.push(key ?? index); return ""; });
  return `/${segments.map(escapePointer).join("/")}`;
}
function escapePointer(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }
function claimSupports(value: unknown): WorkbenchClaimSupport[] { return Array.isArray(value) ? value.filter(isClaimSupport) : []; }
function isClaimSupport(value: unknown): value is WorkbenchClaimSupport { return isRecord(value) && typeof value.path === "string" && typeof value.evidenceRef === "string" && typeof value.excerpt === "string" && typeof value.supportKind === "string"; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function nonemptyArray(value: unknown): boolean { return Array.isArray(value) && value.some((entry) => typeof entry === "string" ? Boolean(entry.trim()) : isRecord(entry)); }
function nonblank(value: unknown): boolean { return typeof value === "string" && Boolean(value.trim()); }
function hasRecordContent(value: unknown): boolean { return isRecord(value) && Object.values(value).some((entry) => typeof entry === "string" ? Boolean(entry.trim()) : Array.isArray(entry) && entry.length > 0); }
function sameStringSet(left: string[], right: string[]): boolean { return left.length === right.length && new Set(left).size === new Set(right).size && left.every((value) => right.includes(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
