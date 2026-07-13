import type { SessionArtifactRecord } from "../../daemon/db/sessionArtifactRepository.ts";
import type {
  WorkbenchAutomaticArtifactKind,
  WorkbenchClaimSupport
} from "../../shared/workbenchAuthoring.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";

const MIN_SUPPORT_EXCERPT_LENGTH = 20;
const PASSED_STATUSES = new Set(["completed", "passed", "success", "succeeded"]);
const PROTOCOL_PHRASES = [
  "cursor pagination",
  "canonical evidence",
  "evidence manifest",
  "authoring run",
  "single provenance",
  "weak multi-session join",
  "published artifact"
] as const;

const REQUIRED_SUPPORT_KINDS: Record<WorkbenchAutomaticArtifactKind, readonly WorkbenchClaimSupport["supportKind"][]> = {
  adr: ["decision", "alternative"],
  incident_timeline: ["problem", "timeline", "remediation"],
  runbook: ["problem", "change", "verification"]
};

export type ArtifactQualityFinding = {
  code:
    | "duplicate_human_content"
    | "invalid_support_kind_evidence"
    | "invalid_timeline_order"
    | "missing_claim_support"
    | "missing_required_support_kind"
    | "missing_root_cause_support"
    | "unsupported_authoring_protocol_language"
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
  evidenceByRef: Map<string, WorkbenchValidationEvidence>
): ArtifactQualityFinding[] {
  const findings: ArtifactQualityFinding[] = [];
  for (const field of humanFacingStrings(output)) {
    const normalizedValue = normalizeWhitespace(field.value).toLowerCase();
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
          code: "unsupported_authoring_protocol_language",
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
}): ArtifactQualityFinding[] {
  const findings = [
    ...validateClaimSupport(input.output, input.supports, input.evidenceByRef),
    ...findUnsupportedProtocolLanguage(input.output, input.supports, input.evidenceByRef)
  ];
  const validSupports = input.supports.filter(
    (support) => !validateClaimSupport(input.output, [support], input.evidenceByRef).length
  );

  for (const path of requiredClaimPaths(input.kind, input.output)) {
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
    const evidence = input.evidenceByRef.get(support.evidenceRef)!;
    if (
      !input.provenanceSessionIds.includes(evidence.sessionId) ||
      !supportKindMatchesPath(support) ||
      !supportKindMatchesEvidence(support, evidence)
    ) {
      findings.push({
        code: "invalid_support_kind_evidence",
        message: `${support.supportKind} support is not backed by the required canonical evidence class.`,
        path: support.path
      });
    }
  }

  const rootCause = typeof input.output.rootCause === "string" ? input.output.rootCause.trim() : "";
  if (
    rootCause &&
    !isExplicitlyUnknown(rootCause) &&
    !validSupports.some((support) => support.path === "rootCause" && support.supportKind === "root_cause")
  ) {
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

function requiredClaimPaths(kind: WorkbenchAutomaticArtifactKind, output: Record<string, unknown>): string[] {
  if (kind === "runbook") {
    return [
      ...arrayPaths(output.fixSteps, "fixSteps"),
      ...(typeof output.rootCause === "string" && output.rootCause.trim() && !isExplicitlyUnknown(output.rootCause)
        ? ["rootCause"]
        : []),
      ...arrayPaths(output.validationChecks, "validationChecks")
    ];
  }
  if (kind === "adr") return typeof output.decision === "string" && output.decision.trim() ? ["decision"] : [];
  return [
    ...timelineClaimPaths(output.timeline),
    ...(typeof output.rootCause === "string" && output.rootCause.trim() && !isExplicitlyUnknown(output.rootCause)
      ? ["rootCause"]
      : []),
    ...arrayPaths(output.remediation, "remediation")
  ];
}

function supportKindMatchesEvidence(
  support: WorkbenchClaimSupport,
  evidence: WorkbenchValidationEvidence
): boolean {
  if (evidence.lowValue) return false;
  if (support.supportKind === "verification") {
    if (evidence.kind === "tool_result") {
      const succeeded = evidence.exitCode === 0 || PASSED_STATUSES.has(evidence.status?.trim().toLowerCase() ?? "");
      const semanticText = `${evidence.toolName ?? ""} ${evidence.label ?? ""} ${evidence.text}`;
      return succeeded &&
        /\b(?:build|check|health|lint|smoke|test|tests|verif(?:y|ied|ication))\b/i.test(semanticText) &&
        !/\b(?:error|fail(?:ed|ure|ing)?|unsuccessful)\b/i.test(evidence.text);
    }
    return evidence.kind === "checkpoint" &&
      /(?:verification_)?(?:passed|verified|succeeded)/i.test(evidence.label ?? "") &&
      !/\b(?:error|fail(?:ed|ure|ing)?|unsuccessful)\b/i.test(evidence.text);
  }
  if (support.supportKind === "timeline") return Boolean(parseTimestamp(evidence.observedAt));
  if (support.supportKind === "change") {
    if (evidence.kind === "file_effect" || evidence.kind === "tool_call") return true;
    return evidence.role === "assistant" && /\b(?:add(?:ed)?|chang(?:e|ed)|fix(?:ed)?|implement(?:ed)?|remov(?:e|ed)|replac(?:e|ed)|updat(?:e|ed)|wrote|created)\b/i.test(evidence.text);
  }
  return true;
}

function supportKindMatchesPath(support: WorkbenchClaimSupport): boolean {
  const allowed: Record<WorkbenchClaimSupport["supportKind"], RegExp> = {
    alternative: /^alternatives\[\d+\]$/,
    change: /^(?:changedFiles|commands|fixSteps)\[\d+\]$/,
    decision: /^decision$/,
    problem: /^(?:impact|problemSignature(?:\.|$)|reproSteps\[\d+\]|symptom)$/,
    remediation: /^(?:prevention|remediation)\[\d+\]$/,
    root_cause: /^rootCause$/,
    timeline: /^timeline\[\d+\]\.summary$/,
    verification: /^validationChecks\[\d+\]$/
  };
  return allowed[support.supportKind].test(support.path);
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
  return /\b(?:unknown|undetermined|not (?:known|established|determined)|insufficient evidence)\b/i.test(value);
}

function arrayPaths(value: unknown, path: string): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry, index) => typeof entry === "string" && entry.trim() ? [`${path}[${index}]`] : [])
    : [];
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
