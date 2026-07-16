import type { SessionArtifactRecord } from "../../daemon/db/sessionArtifactRepository.ts";
import type {
  WorkbenchAutomaticArtifactKind,
  WorkbenchClaimSupport
} from "../../shared/workbenchAuthoring.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";
import {
  hasLaterNegativeVerificationOutcome,
  hasNegativeVerificationOutcome,
  hasPositiveVerificationOutcome,
  hasStructuredVerificationReport
} from "./verificationSemantics.ts";

const MIN_SUPPORT_EXCERPT_LENGTH = 20;
const PASSED_STATUSES = new Set(["completed", "passed", "success", "succeeded"]);
const PASSED_CHECKPOINT_LABELS = new Set([
  "incident_restored",
  "passed",
  "succeeded",
  "verification_passed",
  "verification_verified",
  "verified"
]);
const TERMINAL_INCIDENT_STATUSES = new Set(["closed", "recovered", "resolved"]);
const ACTIVE_INCIDENT_STATUSES = new Set(["active", "ongoing", "open"]);
const PROTOCOL_PHRASES = [
  "cursor pagination",
  "canonical evidence",
  "evidence manifest",
  "authoring run",
  "single provenance",
  "weak multi-session join",
  "published artifact"
] as const;
const SELF_PROCESS_PROTOCOL_PATTERNS = [
  {
    label: "reviewing every item while limiting claims or assertions",
    pattern: /\b(?:i|we)\s+(?:read|reviewed|inspected|processed)\s+(?:all|every)\s+(?:(?:canonical|available|provided|source)\s+)?(?:(?:evidence|source)\s+)?(?:items?|records?|entries?|evidence)\b[^.!?\n]{0,100}\b(?:kept|limited|restricted)\s+(?:all\s+|the\s+)?(?:claims?|assertions?)\b/i
  },
  {
    label: "reading all canonical evidence through pagination",
    pattern: /(?:^|[.!?]\s+|[-*]\s+)(?:(?:i|we)\s+)?(?:read|reviewed|inspect(?:ed)?|processed)\s+(?:all|every)\s+canonical\s+evidence(?:\s+items?)?\b[^.!?\n]{0,40}\b(?:through|using|via|with)\s+(?:cursor\s+)?pagination\b/i
  },
  {
    label: "keeping claims or assertions single-session",
    pattern: /(?:^|[.!?]\s+|[-*]\s+)(?:(?:i|we)\s+)?(?:kept|keep|limited|restrict(?:ed)?)\s+(?:all\s+|the\s+)?(?:claims?|assertions?)\s+(?:to\s+)?(?:(?:a|one)\s+)?single[- ]session\b/i
  }
] as const;

const REQUIRED_SUPPORT_KINDS: Record<WorkbenchAutomaticArtifactKind, readonly WorkbenchClaimSupport["supportKind"][]> = {
  adr: ["decision", "alternative"],
  incident_timeline: ["problem", "timeline", "remediation"],
  runbook: ["problem", "change", "verification"]
};

const CLAIM_SUPPORT_PATH_RULES: Record<
  WorkbenchAutomaticArtifactKind,
  readonly { pattern: RegExp; supportKind: WorkbenchClaimSupport["supportKind"] }[]
> = {
  adr: [
    { pattern: /^context$/, supportKind: "problem" },
    { pattern: /^(?:decision|joinRationale|status)$/, supportKind: "decision" },
    { pattern: /^alternatives\[\d+\]$/, supportKind: "alternative" },
    { pattern: /^(?:affectedPaths|consequences|supersedes)\[\d+\]$/, supportKind: "decision" }
  ],
  incident_timeline: [
    { pattern: /^(?:impact|joinRationale|symptom|contributingFactors\[\d+\])$/, supportKind: "problem" },
    { pattern: /^timeline\[\d+\]\.summary$/, supportKind: "timeline" },
    { pattern: /^rootCause$/, supportKind: "root_cause" },
    { pattern: /^(?:prevention|remediation)\[\d+\]$/, supportKind: "remediation" }
  ],
  runbook: [
    {
      pattern: /^(?:problemSignature\.(?:affectedScope|(?:errorStrings|symptoms)\[\d+\])|(?:deadEnds|environmentRequirements|preconditions|reproSteps|risksOrGaps)\[\d+\])$/,
      supportKind: "problem"
    },
    { pattern: /^joinRationale$/, supportKind: "problem" },
    { pattern: /^(?:changedFiles|commands|fixSteps)\[\d+\]$/, supportKind: "change" },
    { pattern: /^validationChecks\[\d+\]$/, supportKind: "verification" },
    { pattern: /^rootCause$/, supportKind: "root_cause" },
    { pattern: /^preventionNotes\[\d+\]$/, supportKind: "remediation" }
  ]
};

export type ArtifactQualityFinding = {
  code:
    | "duplicate_human_content"
    | "invalid_support_kind_evidence"
    | "invalid_timeline_support"
    | "invalid_timeline_order"
    | "missing_claim_support"
    | "missing_required_support_kind"
    | "missing_root_cause_support"
    | "unsupported_authoring_protocol_language"
    | "authoring_protocol_leakage"
    | "unsupported_claim_excerpt";
  message: string;
  path?: string;
  candidateId?: string;
  artifactId?: string;
};

export type ArtifactQualityOutput = {
  candidateId?: string;
  kind: WorkbenchAutomaticArtifactKind;
  output: Record<string, unknown>;
  provenanceSessionIds: string[];
};

export function validateClaimSupport(
  output: Record<string, unknown>,
  supports: WorkbenchClaimSupport[],
  evidenceByRef: Map<string, WorkbenchValidationEvidence>
): ArtifactQualityFinding[] {
  const findings: ArtifactQualityFinding[] = [];
  supports.forEach((support) => {
    const evidence = evidenceByRef.get(support.evidenceRef);
    const excerpt = normalizeWhitespace(support.excerpt);
    const evidenceText = normalizeWhitespace(evidence?.text ?? "");
    if (
      !resolvePath(output, support.path).exists ||
      excerpt.length < MIN_SUPPORT_EXCERPT_LENGTH ||
      !evidence ||
      !evidenceText.includes(excerpt)
    ) {
      findings.push({
        code: "unsupported_claim_excerpt",
        message: `Claim support must quote at least ${MIN_SUPPORT_EXCERPT_LENGTH} normalized characters verbatim from its canonical evidence.`,
        path: support.path
      });
    }
  });
  return findings;
}

export function findUnsupportedProtocolLanguage(
  output: Record<string, unknown>,
  supports: WorkbenchClaimSupport[],
  evidenceByRef: Map<string, WorkbenchValidationEvidence>,
  findingCode: "unsupported_authoring_protocol_language" | "authoring_protocol_leakage" =
    "unsupported_authoring_protocol_language"
): ArtifactQualityFinding[] {
  const findings: ArtifactQualityFinding[] = [];
  for (const field of humanFacingStrings(output)) {
    const normalizedValue = normalizeWhitespace(field.value).toLowerCase();
    const selfProcessLeak = SELF_PROCESS_PROTOCOL_PATTERNS.find(({ pattern }) => pattern.test(normalizedValue));
    const directlySupportedSelfProcess = selfProcessLeak && supports.some((support) => {
      if (support.path !== field.path) return false;
      const excerpt = normalizeWhitespace(support.excerpt);
      const evidenceText = normalizeWhitespace(evidenceByRef.get(support.evidenceRef)?.text ?? "");
      return (
        excerpt.length >= MIN_SUPPORT_EXCERPT_LENGTH &&
        selfProcessLeak.pattern.test(excerpt.toLowerCase()) &&
        evidenceText.includes(excerpt)
      );
    });
    if (selfProcessLeak && !directlySupportedSelfProcess) {
      findings.push({
        code: findingCode,
        message: `Human-facing artifact text contains unsupported authoring self-process language: ${selfProcessLeak.label}.`,
        path: field.path
      });
      continue;
    }
    for (const phrase of PROTOCOL_PHRASES) {
      if (!normalizedValue.includes(phrase)) continue;
      const directlySupported = supports.some((support) => {
        if (support.path !== field.path) return false;
        const excerpt = normalizeWhitespace(support.excerpt);
        const evidenceText = normalizeWhitespace(evidenceByRef.get(support.evidenceRef)?.text ?? "");
        return (
          excerpt.length >= MIN_SUPPORT_EXCERPT_LENGTH &&
          excerpt.toLowerCase().includes(phrase) &&
          evidenceText.includes(excerpt)
        );
      });
      if (!directlySupported) {
        findings.push({
          code: findingCode,
          message: `Human-facing artifact text contains unsupported authoring-protocol language: ${phrase}.`,
          path: field.path
        });
      }
    }
  }
  return findings;
}

export function validateArtifactQuality(input: {
  kind: WorkbenchAutomaticArtifactKind;
  output: Record<string, unknown>;
  supports: WorkbenchClaimSupport[];
  evidenceByRef: Map<string, WorkbenchValidationEvidence>;
  provenanceSessionIds: string[];
  protocolLeakageFindingCode?: "unsupported_authoring_protocol_language" | "authoring_protocol_leakage";
}): ArtifactQualityFinding[] {
  const findings = [
    ...validateClaimSupport(input.output, input.supports, input.evidenceByRef),
    ...findUnsupportedProtocolLanguage(
      input.output,
      input.supports,
      input.evidenceByRef,
      input.protocolLeakageFindingCode
    )
  ];
  const validSupports = input.supports.filter(
    (support) => !validateClaimSupport(input.output, [support], input.evidenceByRef).length
  );
  const supportIsGrounded = (support: WorkbenchClaimSupport): boolean => {
    const evidence = input.evidenceByRef.get(support.evidenceRef);
    return Boolean(
      evidence &&
      input.provenanceSessionIds.includes(evidence.sessionId) &&
      supportKindMatchesPath(input.kind, input.output, support) &&
      supportKindMatchesEvidence(support, evidence)
    );
  };
  const groundedSupports = validSupports.filter(supportIsGrounded);

  for (const path of requiredClaimPaths(input.kind, input.output, input.provenanceSessionIds)) {
    if (!validSupports.some((support) => support.path === path)) {
      findings.push({
        code: "missing_claim_support",
        message: `Populated claim-bearing field requires canonical claim support: ${path}.`,
        path
      });
    }
  }

  for (const supportKind of REQUIRED_SUPPORT_KINDS[input.kind]) {
    if (!validSupports.some((support) => support.supportKind === supportKind)) {
      findings.push({
        code: "missing_required_support_kind",
        message: `${input.kind} requires at least one valid ${supportKind} support entry.`
      });
    }
  }

  for (const support of validSupports) {
    if (!supportIsGrounded(support)) {
      findings.push({
        code: "invalid_support_kind_evidence",
        message: `${support.supportKind} support is not backed by the required canonical evidence class.`,
        path: support.path
      });
    }
  }

  if (new Set(input.provenanceSessionIds).size > 1 && stringPath(input.output.joinRationale, "joinRationale").length) {
    const supportedSessions = new Set(
      groundedSupports
        .filter((support) => support.path === "joinRationale")
        .map((support) => input.evidenceByRef.get(support.evidenceRef)!.sessionId)
    );
    for (const sessionId of new Set(input.provenanceSessionIds)) {
      if (supportedSessions.has(sessionId)) continue;
      findings.push({
        code: "missing_claim_support",
        message: `Multi-session joinRationale requires canonical claim support from provenance session: ${sessionId}.`,
        path: "joinRationale"
      });
    }
  }

  const rootCause = typeof input.output.rootCause === "string" ? input.output.rootCause.trim() : "";
  const hasRootCauseSupport = validSupports.some(
    (support) => support.path === "rootCause" && support.supportKind === "root_cause"
  );
  const requiresRootCause = input.kind === "runbook" || input.kind === "incident_timeline";
  if (requiresRootCause && (!rootCause || (!hasRootCauseSupport && !isExplicitlyUnknown(rootCause)))) {
    findings.push({
      code: "missing_root_cause_support",
      message: "A causal root-cause assertion requires direct root_cause support; otherwise state that root cause is unknown.",
      path: "rootCause"
    });
  }

  if (input.kind === "incident_timeline") {
    findings.push(...validateTimelineOrder(input.output, validSupports, input.evidenceByRef));
  }
  return deduplicateFindings(findings);
}

export function findDuplicateHumanContent(
  outputs: ArtifactQualityOutput[],
  recentArtifacts: SessionArtifactRecord[]
): ArtifactQualityFinding[] {
  const findings: ArtifactQualityFinding[] = [];
  const seen = new Map<string, ArtifactQualityOutput>();
  for (const candidate of outputs) {
    const fingerprint = substantiveFingerprint(candidate.kind, candidate.output);
    const prior = seen.get(fingerprint);
    if (prior && prior.candidateId !== candidate.candidateId) {
      findings.push({
        candidateId: candidate.candidateId,
        code: "duplicate_human_content",
        message: "Distinct candidate outputs contain identical substantive human content."
      });
    } else {
      seen.set(fingerprint, candidate);
    }

    for (const artifact of recentArtifacts) {
      if (
        artifact.artifactKind === "session_dossier" ||
        artifact.artifactKind !== candidate.kind ||
        artifact.status !== "current" ||
        artifact.publicationStatus !== "published" ||
        artifact.provenanceSessionIds.some((sessionId) => candidate.provenanceSessionIds.includes(sessionId)) ||
        !isRecord(artifact.content) ||
        substantiveFingerprint(candidate.kind, artifact.content) !== fingerprint
      ) continue;
      findings.push({
        artifactId: artifact.artifactId,
        candidateId: candidate.candidateId,
        code: "duplicate_human_content",
        message: "Candidate output duplicates a recent current artifact with disjoint provenance."
      });
    }
  }
  return deduplicateFindings(findings);
}

export function substantiveFingerprint(
  kind: WorkbenchAutomaticArtifactKind,
  output: Record<string, unknown>
): string {
  const commonPaths = ["title", "summary", "context", "outcome", "decision", "rootCause"];
  const paths = kind === "runbook"
    ? [
        ...commonPaths, "problemSignature.symptoms", "problemSignature.errorStrings", "problemSignature.affectedScope",
        "preconditions", "reproSteps", "deadEnds", "fixSteps", "commands", "changedFiles", "validationChecks",
        "environmentRequirements", "preventionNotes", "risksOrGaps"
      ]
    : kind === "adr"
      ? [...commonPaths, "alternatives", "consequences", "affectedPaths", "supersedes"]
      : [
          ...commonPaths, "symptom", "impact", "timeline", "contributingFactors", "remediation", "prevention", "status"
        ];
  return JSON.stringify(paths.map((path) => normalizeSubstantiveValue(
    path === "timeline" ? substantiveTimeline(resolvePath(output, path).value) : resolvePath(output, path).value
  )));
}

function requiredClaimPaths(
  kind: WorkbenchAutomaticArtifactKind,
  output: Record<string, unknown>,
  provenanceSessionIds: string[]
): string[] {
  const joinRationalePath = new Set(provenanceSessionIds).size > 1
    ? stringPath(output.joinRationale, "joinRationale")
    : [];
  if (kind === "runbook") {
    const problemSignature = isRecord(output.problemSignature) ? output.problemSignature : {};
    return [
      ...arrayPaths(problemSignature.symptoms, "problemSignature.symptoms"),
      ...arrayPaths(problemSignature.errorStrings, "problemSignature.errorStrings"),
      ...stringPath(problemSignature.affectedScope, "problemSignature.affectedScope"),
      ...arrayPaths(output.preconditions, "preconditions"),
      ...arrayPaths(output.reproSteps, "reproSteps"),
      ...arrayPaths(output.deadEnds, "deadEnds"),
      ...arrayPaths(output.fixSteps, "fixSteps"),
      ...arrayPaths(output.commands, "commands"),
      ...arrayPaths(output.changedFiles, "changedFiles"),
      ...arrayPaths(output.validationChecks, "validationChecks"),
      ...arrayPaths(output.environmentRequirements, "environmentRequirements"),
      ...(typeof output.rootCause === "string" && output.rootCause.trim() && !isExplicitlyUnknown(output.rootCause)
        ? ["rootCause"]
        : []),
      ...arrayPaths(output.preventionNotes, "preventionNotes"),
      ...arrayPaths(output.risksOrGaps, "risksOrGaps"),
      ...joinRationalePath
    ];
  }
  if (kind === "adr") {
    return [
      ...stringPath(output.context, "context"),
      ...stringPath(output.decision, "decision"),
      ...stringPath(output.status, "status"),
      ...arrayPaths(output.alternatives, "alternatives"),
      ...arrayPaths(output.consequences, "consequences"),
      ...arrayPaths(output.affectedPaths, "affectedPaths"),
      ...arrayPaths(output.supersedes, "supersedes"),
      ...joinRationalePath
    ];
  }
  return [
    ...stringPath(output.symptom, "symptom"),
    ...stringPath(output.impact, "impact"),
    ...timelineClaimPaths(output.timeline),
    ...(typeof output.rootCause === "string" && output.rootCause.trim() && !isExplicitlyUnknown(output.rootCause)
      ? ["rootCause"]
      : []),
    ...arrayPaths(output.contributingFactors, "contributingFactors"),
    ...arrayPaths(output.remediation, "remediation"),
    ...arrayPaths(output.prevention, "prevention"),
    ...stringPath(output.status, "status"),
    ...joinRationalePath
  ];
}

function supportKindMatchesEvidence(
  support: WorkbenchClaimSupport,
  evidence: WorkbenchValidationEvidence
): boolean {
  if (evidence.lowValue) return false;
  if (support.supportKind === "verification") {
    if (evidence.kind === "tool_result") {
      const normalizedStatus = evidence.status?.trim().toLowerCase();
      const exitSucceeded = evidence.exitCode === undefined ? undefined : evidence.exitCode === 0;
      const statusSucceeded = normalizedStatus ? PASSED_STATUSES.has(normalizedStatus) : undefined;
      const succeeded =
        exitSucceeded !== false &&
        statusSucceeded !== false &&
        (exitSucceeded === true || statusSucceeded === true);
      const semanticText = `${evidence.toolName ?? ""} ${evidence.label ?? ""} ${evidence.text}`;
      return succeeded &&
        /\b(?:build|check|health|lint|smoke|test|tests|verif(?:y|ied|ication))\b/i.test(semanticText) &&
        !hasNegativeVerificationOutcome(evidence.text);
    }
    const checkpointLabel = evidence.label?.trim().toLowerCase() ?? "";
    if (evidence.kind === "checkpoint") {
      return PASSED_CHECKPOINT_LABELS.has(checkpointLabel) &&
        !hasNegativeVerificationOutcome(`${checkpointLabel} ${evidence.text}`);
    }
    return evidence.kind === "message" &&
      evidence.role === "assistant" &&
      (hasPositiveVerificationOutcome(support.excerpt) || hasStructuredVerificationReport(support.excerpt)) &&
      !hasNegativeVerificationOutcome(support.excerpt) &&
      !hasLaterNegativeVerificationOutcome(evidence.text, support.excerpt);
  }
  if (support.supportKind === "timeline") return Boolean(parseTimestamp(evidence.observedAt));
  if (support.supportKind === "change") {
    if (evidence.kind === "file_effect" || evidence.kind === "tool_call") return true;
    return evidence.role === "assistant" && /\b(?:added|aligned|applied|backed\s+up|bound|broadened|built|changed|cleaned|closed|committed|configured|corrected|created|deployed|disabled|edited|enabled|fixed|forced|implemented|installed|launched|migrated|modified|moved|patched|pointed|preserved|published|pushed|recovered|recreated|removed|rendered|repaired|replaced|repointed|restarted|restored|retained|rotated|ran|saved|set|shifted|updated|used|wrote)\b/i.test(evidence.text);
  }
  return true;
}

function supportKindMatchesPath(
  kind: WorkbenchAutomaticArtifactKind,
  output: Record<string, unknown>,
  support: WorkbenchClaimSupport
): boolean {
  if (kind === "incident_timeline" && support.path === "status") {
    const status = typeof output.status === "string" ? normalizeWhitespace(output.status).toLowerCase() : "";
    if (TERMINAL_INCIDENT_STATUSES.has(status)) return support.supportKind === "verification";
    if (ACTIVE_INCIDENT_STATUSES.has(status)) return support.supportKind === "problem";
    return support.supportKind === "problem" ||
      support.supportKind === "remediation" ||
      support.supportKind === "verification";
  }
  return CLAIM_SUPPORT_PATH_RULES[kind].some(
    (rule) => rule.supportKind === support.supportKind && rule.pattern.test(support.path)
  );
}

function validateTimelineOrder(
  output: Record<string, unknown>,
  supports: WorkbenchClaimSupport[],
  evidenceByRef: Map<string, WorkbenchValidationEvidence>
): ArtifactQualityFinding[] {
  if (!Array.isArray(output.timeline)) return [];
  let previous = Number.NEGATIVE_INFINITY;
  const findings: ArtifactQualityFinding[] = [];
  output.timeline.forEach((entry, index) => {
    const at = isRecord(entry) && typeof entry.at === "string" ? parseTimestamp(entry.at) : undefined;
    if (at === undefined || at < previous) {
      findings.push({
        code: "invalid_timeline_order",
        message: "Incident timeline entries must have valid timestamps in chronological order.",
        path: `timeline[${index}].at`
      });
    }
    const entrySupports = supports.filter(
      (support) => support.supportKind === "timeline" && support.path.startsWith(`timeline[${index}].`)
    );
    const visibleEvidenceRefs = isRecord(entry) && Array.isArray(entry.evidenceRefs)
      ? entry.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [];
    if (entrySupports.some((support) => !visibleEvidenceRefs.includes(support.evidenceRef))) {
      findings.push({
        code: "invalid_timeline_support",
        message: "Each timeline claim support ref must be visible on that exact timeline entry.",
        path: `timeline[${index}].evidenceRefs`
      });
    }
    if (
      at !== undefined &&
      entrySupports.some((support) => parseTimestamp(evidenceByRef.get(support.evidenceRef)?.observedAt) !== at)
    ) {
      findings.push({
        code: "invalid_timeline_order",
        message: "Incident timeline timestamps must match the canonical timestamps of their cited timeline evidence.",
        path: `timeline[${index}].at`
      });
    }
    if (at !== undefined) previous = at;
  });
  return findings;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function humanFacingStrings(output: Record<string, unknown>): Array<{ path: string; value: string }> {
  const excludedRoots = new Set([
    "claimEvidence", "claimSupport", "confidence", "evidenceRefs", "missingEvidence",
    "provenanceSessionIds", "signatureKey"
  ]);
  const strings: Array<{ path: string; value: string }> = [];
  const visit = (value: unknown, path: string, root: string): void => {
    if (excludedRoots.has(root)) return;
    if (typeof value === "string") {
      strings.push({ path, value });
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, root));
    } else if (isRecord(value)) {
      Object.entries(value).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key, root || key));
    }
  };
  Object.entries(output).forEach(([key, value]) => visit(value, key, key));
  return strings;
}

function normalizeSubstantiveValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeWhitespace(value).toLowerCase();
  if (Array.isArray(value)) return value.map(normalizeSubstantiveValue);
  if (isRecord(value)) {
    return Object.keys(value).sort().map((key) => [key, normalizeSubstantiveValue(value[key])]);
  }
  return value ?? null;
}

function substantiveTimeline(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => isRecord(entry)
    ? { at: entry.at, summary: entry.summary }
    : entry);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isExplicitlyUnknown(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  return /^(?:(?:the )?root cause (?:is|remains) (?:unknown|undetermined|not (?:known|established|determined))(?: (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence)?|unknown (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence|(?:the )?(?:available |current )?(?:canonical )?evidence (?:does not establish|is insufficient to establish|cannot determine) (?:the )?root cause)[.!]?$/i.test(normalized);
}


function arrayPaths(value: unknown, path: string): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry, index) => typeof entry === "string" && entry.trim() ? [`${path}[${index}]`] : [])
    : [];
}

function stringPath(value: unknown, path: string): string[] {
  return typeof value === "string" && value.trim() ? [path] : [];
}

function timelineClaimPaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry, index) => isRecord(entry) && typeof entry.summary === "string" && entry.summary.trim()
      ? [`timeline[${index}].summary`]
      : [])
    : [];
}

function resolvePath(root: Record<string, unknown>, path: string): { exists: boolean; value?: unknown } {
  const segments = [...path.matchAll(/([^.\[\]]+)|\[(\d+)\]/g)].map((match) => match[1] ?? Number(match[2]));
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false };
      current = current[segment];
    } else {
      if (!isRecord(current) || !Object.hasOwn(current, segment)) return { exists: false };
      current = current[segment];
    }
  }
  return { exists: true, value: current };
}

function deduplicateFindings<T extends ArtifactQualityFinding>(findings: T[]): T[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
