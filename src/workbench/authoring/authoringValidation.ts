import type {
  WorkbenchAutomaticArtifactKind,
  WorkbenchAuthoringBundleV2,
  WorkbenchClaimEvidence,
  WorkbenchClaimSupport
} from "../../shared/workbenchAuthoring.ts";
import { redactText } from "../../core/redaction.ts";
import { normalizeSessionArtifactSignatureKey } from "../../daemon/db/sessionArtifactRepository.ts";
import {
  getAuthoringBundleSchema,
  getAuthoringBundleV2Schema,
  getWorkbenchAuthoringOutputSchema,
  getWorkbenchAuthoringOutputV2Schema
} from "./authoringSchemas.ts";
import {
  findDuplicateHumanContent,
  validateArtifactQuality,
  type ArtifactQualityOutput
} from "./artifactQuality.ts";
import type {
  WorkbenchAuthoringFindingCode,
  WorkbenchAuthoringFindingV2,
  WorkbenchAuthoringValidationInput,
  WorkbenchAuthoringValidationResult,
  WorkbenchOutputKind,
  WorkbenchValidationEvidence
} from "../types.ts";

const MIN_TITLE_LENGTH = 12;
const MIN_SUMMARY_LENGTH = 40;
const MIN_NA_REASON_LENGTH = 24;

const AUTOMATIC_KINDS: WorkbenchAutomaticArtifactKind[] = ["runbook", "adr", "incident_timeline"];
const GENERIC_TITLES = new Set([
  "updated files",
  "session work",
  "recent activity",
  "codex hook event",
  "masthead session",
  "work completed",
  "done"
]);
const WEAK_JOIN_PATTERNS = [
  /^same project$/i,
  /^same topics?$/i,
  /^same time window$/i,
  /^generic file overlap$/i,
  /^semantic summary/i,
  /^similar vibe/i
];
const PASSED_STATUSES = new Set(["completed", "passed", "success", "succeeded"]);
type WorkbenchAuthoringValidationContext = Omit<WorkbenchAuthoringValidationInput, "bundle">;

export function validateAuthoringBundle(
  input: WorkbenchAuthoringValidationInput
): WorkbenchAuthoringValidationResult {
  const findings: WorkbenchAuthoringFindingV2[] = [];
  const bundle: unknown = input.bundle;
  validateSchemaValue(bundle, getAuthoringBundleSchema(), "", findings);
  if (!isRecord(bundle)) return result(findings);

  const selectedSessionIds = [...new Set(input.selectedSessionIds)];
  const selectedSessions = new Set(selectedSessionIds);
  const sessionPackages = unknownArray(bundle.sessionPackages);
  const artifacts = unknownArray(bundle.artifacts);
  const notApplicable = unknownArray(bundle.notApplicable);
  const contributions = unknownArray(bundle.contributions);

  validateSessionPackages(sessionPackages, selectedSessionIds, selectedSessions, input, findings);
  artifacts.forEach((artifact, index) => {
    if (isRecord(artifact)) validateArtifact(artifact, index, selectedSessions, input, findings);
  });
  validateArtifactSignatures(artifacts, findings);
  notApplicable.forEach((decision, index) => {
    if (isRecord(decision)) validateNotApplicable(decision, index, selectedSessions, input, findings);
  });
  contributions.forEach((decision, index) => {
    if (isRecord(decision)) validateContribution(decision, index, selectedSessions, input, findings);
  });
  validateAutomaticKindResolution(
    selectedSessionIds,
    artifacts,
    notApplicable,
    contributions,
    findings
  );

  return result(findings);
}

export function validateAuthoringBundleV2(input: {
  bundle: WorkbenchAuthoringBundleV2;
  selectedSessionIds: string[];
  evidenceByRef: WorkbenchAuthoringValidationInput["evidenceByRef"];
  coverageWarningsBySession: WorkbenchAuthoringValidationInput["coverageWarningsBySession"];
  publishedArtifacts: WorkbenchAuthoringValidationInput["publishedArtifacts"];
  otherCandidateOutputs?: ArtifactQualityOutput[];
}): WorkbenchAuthoringValidationResult {
  const findings: WorkbenchAuthoringFindingV2[] = [];
  validateSchemaValue(input.bundle, getAuthoringBundleV2Schema(), "", findings);
  const selectedSessions = new Set(input.selectedSessionIds);
  if (isRecord(input.bundle.artifact)) {
    validateArtifact(
      input.bundle.artifact,
      0,
      selectedSessions,
      input,
      findings,
      { basePath: "artifact", contractVersion: "workbench-authoring-v2" }
    );
    const artifact = input.bundle.artifact;
    if (automaticKind(artifact.kind) && isRecord(artifact.output)) {
      for (const finding of findDuplicateHumanContent(
        [...(input.otherCandidateOutputs ?? []), {
          candidateId: input.bundle.candidateId,
          kind: artifact.kind,
          output: artifact.output,
          provenanceSessionIds: artifact.provenanceSessionIds
        }],
        input.publishedArtifacts
      ).filter((finding) => finding.candidateId === input.bundle.candidateId)) {
        addFinding(findings, {
          artifactKind: artifact.kind,
          code: finding.code,
          message: finding.message,
          path: "artifact.output",
          sessionId: artifact.seedSessionId
        });
      }
    }
  }
  return result(findings);
}

function validateSessionPackages(
  packages: unknown[],
  selectedSessionIds: string[],
  selectedSessions: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[]
): void {
  for (const sessionId of selectedSessionIds) {
    const matchingIndexes = packages.flatMap((entry, index) =>
      isRecord(entry) && entry.sessionId === sessionId ? [index] : []
    );
    if (matchingIndexes.length === 0) {
      addFinding(findings, {
        code: "missing_session_package",
        message: `Selected session requires exactly one session package: ${sessionId}`,
        path: "sessionPackages",
        sessionId
      });
    } else if (matchingIndexes.length > 1) {
      addFinding(findings, {
        code: "duplicate_session_package",
        message: `Selected session has more than one session package: ${sessionId}`,
        path: `sessionPackages[${matchingIndexes[1]}].sessionId`,
        sessionId
      });
    }
  }

  packages.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const sessionId = stringValue(entry.sessionId);
    if (!sessionId) return;
    if (!selectedSessions.has(sessionId)) {
      addFinding(findings, {
        code: "unexpected_session_package",
        message: `Session package is not part of the selected authoring set: ${sessionId}`,
        path: `sessionPackages[${index}].sessionId`,
        sessionId
      });
      return;
    }
    const provenance = new Set([sessionId]);
    if (isRecord(entry.enrichment)) {
      validateGroundedOutput(
        "session_enrichment",
        entry.enrichment,
        `sessionPackages[${index}].enrichment`,
        provenance,
        input,
        findings,
        true
      );
    }
    if (isRecord(entry.dossier)) {
      validateGroundedOutput(
        "session_dossier",
        entry.dossier,
        `sessionPackages[${index}].dossier`,
        provenance,
        input,
        findings,
        true
      );
    }
    const coverageWarnings = input.coverageWarningsBySession.get(sessionId) ?? [];
    if (coverageWarnings.length > 0) {
      addFinding(findings, {
        code: "sparse_evidence_coverage",
        message: `Canonical evidence coverage is sparse: ${coverageWarnings.join(" ")}`,
        path: `sessionPackages[${index}]`,
        sessionId,
        severity: "warning"
      });
    }
  });
}

function validateArtifact(
  artifact: Record<string, unknown>,
  index: number,
  selectedSessions: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[],
  options: {
    basePath?: string;
    contractVersion?: "workbench-authoring-v1" | "workbench-authoring-v2";
  } = {}
): void {
  const kind = automaticKind(artifact.kind);
  const seedSessionId = stringValue(artifact.seedSessionId);
  const provenanceSessionIds = stringArray(artifact.provenanceSessionIds) ?? [];
  const basePath = options.basePath ?? `artifacts[${index}]`;
  if (!kind || !seedSessionId) return;

  validateUniqueProvenanceIds(
    provenanceSessionIds,
    `${basePath}.provenanceSessionIds`,
    kind,
    seedSessionId,
    findings
  );
  if (!provenanceSessionIds.includes(seedSessionId)) {
    addFinding(findings, {
      artifactKind: kind,
      code: "seed_missing_from_provenance",
      message: `Artifact provenance must contain its seed session: ${seedSessionId}`,
      path: `${basePath}.provenanceSessionIds`,
      sessionId: seedSessionId
    });
  }
  provenanceSessionIds.forEach((sessionId, provenanceIndex) => {
    if (!selectedSessions.has(sessionId)) {
      addFinding(findings, {
        artifactKind: kind,
        code: "provenance_session_not_selected",
        message: `Artifact provenance session is not selected: ${sessionId}`,
        path: `${basePath}.provenanceSessionIds[${provenanceIndex}]`,
        sessionId
      });
    }
  });

  if (!isRecord(artifact.output)) return;
  const outputProvenance = stringArray(artifact.output.provenanceSessionIds) ?? [];
  validateUniqueProvenanceIds(
    outputProvenance,
    `${basePath}.output.provenanceSessionIds`,
    kind,
    seedSessionId,
    findings
  );
  if (!sameProvenance(outputProvenance, provenanceSessionIds)) {
    addFinding(findings, {
      artifactKind: kind,
      code: "mismatched_output_provenance",
      message: "Output provenanceSessionIds must match the artifact draft provenanceSessionIds.",
      path: `${basePath}.output.provenanceSessionIds`,
      sessionId: seedSessionId
    });
  }
  if (new Set(provenanceSessionIds).size > 1) {
    const joinRationale = stringValue(artifact.output.joinRationale);
    if (!joinRationale?.trim()) {
      addFinding(findings, {
        artifactKind: kind,
        code: "missing_join_rationale",
        message: "joinRationale is required when provenance includes more than one session.",
        path: `${basePath}.output.joinRationale`,
        sessionId: seedSessionId
      });
    } else if (WEAK_JOIN_PATTERNS.some((pattern) => pattern.test(joinRationale.trim()))) {
      addFinding(findings, {
        artifactKind: kind,
        code: "weak_join",
        message: "joinRationale is too weak for a multi-session artifact.",
        path: `${basePath}.output.joinRationale`,
        sessionId: seedSessionId
      });
    }
  }

  validateGroundedOutput(
    kind,
    artifact.output,
    `${basePath}.output`,
    new Set(provenanceSessionIds),
    input,
    findings,
    false,
    seedSessionId,
    options.contractVersion ?? "workbench-authoring-v1"
  );
}

function validateGroundedOutput(
  kind: WorkbenchOutputKind,
  output: Record<string, unknown>,
  basePath: string,
  provenance: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[],
  requireSparseEvidenceNote: boolean,
  explicitSessionId?: string,
  contractVersion: "workbench-authoring-v1" | "workbench-authoring-v2" = "workbench-authoring-v1"
): void {
  const artifactKind = kind;
  const sessionId = explicitSessionId ?? [...provenance][0];
  const schema = contractVersion === "workbench-authoring-v2"
    ? getWorkbenchAuthoringOutputV2Schema(kind)
    : getWorkbenchAuthoringOutputSchema(kind);
  validateRequiredStrings(output, schema, basePath, findings, artifactKind, sessionId);

  const title = stringValue(output.title);
  validateRequiredText(findings, title, `${basePath}.title`, MIN_TITLE_LENGTH, artifactKind, sessionId);
  if (title && GENERIC_TITLES.has(title.trim().toLowerCase())) {
    addFinding(findings, {
      artifactKind,
      code: "generic_title",
      message: `Title is too generic: ${title}`,
      path: `${basePath}.title`,
      sessionId
    });
  }

  if (kind === "session_enrichment") {
    const summary = stringValue(output.summary);
    validateRequiredText(findings, summary, `${basePath}.summary`, MIN_SUMMARY_LENGTH, artifactKind, sessionId);
    if (title?.trim().toLowerCase() === summary?.trim().toLowerCase()) {
      addFinding(findings, {
        artifactKind,
        code: "duplicate_title_summary",
        message: "summary must add detail beyond the title.",
        path: `${basePath}.summary`,
        sessionId
      });
    }
  }

  for (const claimArrayPath of claimBearingArrays(kind)) {
    const resolved = resolvePropertyPath(output, claimArrayPath);
    if (!resolved.exists || !Array.isArray(resolved.value)) continue;
    const stringClaims = resolved.value.filter((value): value is string => typeof value === "string");
    const hasSubstantiveClaim =
      resolved.value.length > 0 &&
      (stringClaims.length !== resolved.value.length || stringClaims.some(nonBlank));
    if (!hasSubstantiveClaim) {
      addFinding(findings, {
        artifactKind,
        code: "empty_claim_array",
        message: `${claimArrayPath} must contain at least one claim.`,
        path: `${basePath}.${claimArrayPath}`,
        sessionId
      });
    }
    resolved.value.forEach((value, index) => {
      if (typeof value === "string") {
        validateRequiredText(
          findings,
          value,
          `${basePath}.${claimArrayPath}[${index}]`,
          1,
          artifactKind,
          sessionId
        );
      }
    });
  }

  const evidenceRefs = stringArray(output.evidenceRefs) ?? [];
  validateEvidenceRefs(evidenceRefs, `${basePath}.evidenceRefs`, provenance, input, findings, artifactKind, sessionId);
  if (kind === "incident_timeline" && Array.isArray(output.timeline)) {
    const declaredEvidence = new Set(evidenceRefs);
    output.timeline.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const timelineRefs = stringArray(entry.evidenceRefs) ?? [];
      timelineRefs.forEach((ref, refIndex) => {
        if (!declaredEvidence.has(ref)) {
          addFinding(findings, {
            artifactKind,
            code: "evidence_outside_declared_evidence",
            message: `Timeline evidence ref is not declared by the output: ${ref}`,
            path: `${basePath}.timeline[${index}].evidenceRefs[${refIndex}]`,
            sessionId
          });
        }
      });
      validateEvidenceRefs(
        timelineRefs,
        `${basePath}.timeline[${index}].evidenceRefs`,
        provenance,
        input,
        findings,
        artifactKind,
        sessionId
      );
    });
  }

  const claimEntries = claimEvidenceEntries(output.claimEvidence);
  const v2ArtifactKind = contractVersion === "workbench-authoring-v2" ? automaticKind(kind) : undefined;
  if (v2ArtifactKind) {
    const supports = claimSupportEntries(output.claimSupport);
    for (const support of supports) {
      if (!evidenceRefs.includes(support.evidenceRef)) {
        addFinding(findings, {
          artifactKind,
          code: "claim_evidence_outside_declared_evidence",
          message: `Claim support evidence ref is not declared by the output: ${support.evidenceRef}`,
          path: `${basePath}.claimSupport`,
          sessionId
        });
      }
      validateEvidenceRefs(
        [support.evidenceRef],
        `${basePath}.claimSupport`,
        provenance,
        input,
        findings,
        artifactKind,
        sessionId
      );
    }
    for (const finding of validateArtifactQuality({
      evidenceByRef: input.evidenceByRef,
      kind: v2ArtifactKind,
      output,
      provenanceSessionIds: [...provenance],
      supports
    })) {
      addFinding(findings, {
        artifactKind,
        code: finding.code,
        message: finding.message,
        path: finding.path ? `${basePath}.${finding.path}` : `${basePath}.claimSupport`,
        sessionId
      });
    }
  } else if (claimEntries.length === 0) {
    addFinding(findings, {
      artifactKind,
      code: "missing_claim_evidence",
      message: "Authored output must cite evidence for its claims.",
      path: `${basePath}.claimEvidence`,
      sessionId
    });
  } else {
    validateClaimEvidence(
      output,
      claimEntries,
      requiredClaimPaths(kind, output),
      evidenceRefs,
      provenance,
      basePath,
      input,
      findings,
      artifactKind,
      sessionId
    );
  }

  if (output.confidence === "high" && new Set(evidenceRefs).size < 2) {
    addFinding(findings, {
      artifactKind,
      code: "high_confidence_without_support",
      message: "High confidence requires at least two distinct evidence refs.",
      path: `${basePath}.evidenceRefs`,
      sessionId
    });
  }

  const sparseSessions = [...provenance].filter(
    (provenanceSessionId) => (input.coverageWarningsBySession.get(provenanceSessionId) ?? []).length > 0
  );
  if (sparseSessions.length > 0 && output.confidence === "high") {
    addFinding(findings, {
      artifactKind,
      code: "high_confidence_with_sparse_coverage",
      message: `High confidence is not allowed with sparse evidence coverage: ${sparseSessions.join(", ")}`,
      path: `${basePath}.confidence`,
      sessionId
    });
  }
  if (
    requireSparseEvidenceNote &&
    sparseSessions.length > 0 &&
    !(stringArray(output.missingEvidence) ?? []).some(nonBlank)
  ) {
    addFinding(findings, {
      artifactKind,
      code: "missing_sparse_evidence_note",
      message: "Sparse evidence coverage must be recorded in missingEvidence.",
      path: `${basePath}.missingEvidence`,
      sessionId
    });
  }

  if (kind === "runbook" && output.confidence === "high" && contractVersion === "workbench-authoring-v1") {
    const verificationRefs = claimEntries
      .filter((entry) => entry.path.startsWith("validationChecks["))
      .flatMap((entry) => entry.evidenceRefs);
    if (!verificationRefs.some((ref) => isPassedVerification(input.evidenceByRef.get(ref)))) {
      addFinding(findings, {
        artifactKind: "runbook",
        code: "missing_passed_verification",
        message: "High-confidence runbooks require a passed verification evidence ref.",
        path: `${basePath}.claimEvidence`,
        sessionId
      });
    }
  }

  if (containsUnredactedSecret(output)) {
    addFinding(findings, {
      artifactKind,
      code: "secret_detected",
      message: "Output contains secret-looking values.",
      path: basePath,
      sessionId
    });
  }
}

type IndexedClaimEvidence = WorkbenchClaimEvidence & { index: number };

function validateClaimEvidence(
  output: Record<string, unknown>,
  entries: IndexedClaimEvidence[],
  requiredPaths: string[],
  evidenceRefs: string[],
  provenance: Set<string>,
  basePath: string,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[],
  artifactKind: WorkbenchOutputKind,
  sessionId: string | undefined
): void {
  const declaredEvidence = new Set(evidenceRefs);
  const claimedPaths = new Set(entries.filter((entry) => entry.evidenceRefs.length > 0).map((entry) => entry.path));
  for (const requiredPath of requiredPaths) {
    if (!claimedPaths.has(requiredPath)) {
      addFinding(findings, {
        artifactKind,
        code: "missing_claim_evidence",
        message: `Claim must cite evidence: ${requiredPath}`,
        path: `${basePath}.claimEvidence`,
        sessionId
      });
    }
  }

  entries.forEach((entry) => {
    const entryPath = `${basePath}.claimEvidence[${entry.index}]`;
    if (!resolvePropertyPath(output, entry.path).exists) {
      addFinding(findings, {
        artifactKind,
        code: "invalid_claim_path",
        message: `Claim path does not exist in the authored output: ${entry.path}`,
        path: `${entryPath}.path`,
        sessionId
      });
    }
    if (entry.evidenceRefs.length === 0) {
      addFinding(findings, {
        artifactKind,
        code: "missing_claim_evidence",
        message: `Claim path must cite at least one evidence ref: ${entry.path}`,
        path: `${entryPath}.evidenceRefs`,
        sessionId
      });
    }
    entry.evidenceRefs.forEach((ref, refIndex) => {
      if (!declaredEvidence.has(ref)) {
        addFinding(findings, {
          artifactKind,
          code: "claim_evidence_outside_declared_evidence",
          message: `Claim evidence ref is not declared by the output: ${ref}`,
          path: `${entryPath}.evidenceRefs[${refIndex}]`,
          sessionId
        });
      }
    });
    validateEvidenceRefs(
      entry.evidenceRefs,
      `${entryPath}.evidenceRefs`,
      provenance,
      input,
      findings,
      artifactKind,
      sessionId
    );
  });
}

function validateNotApplicable(
  decision: Record<string, unknown>,
  index: number,
  selectedSessions: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[]
): void {
  const sessionId = stringValue(decision.sessionId);
  const kind = automaticKind(decision.kind);
  const basePath = `notApplicable[${index}]`;
  if (!sessionId || !kind) return;
  if (!selectedSessions.has(sessionId)) {
    addFinding(findings, {
      artifactKind: kind,
      code: "unexpected_automatic_resolution",
      message: `N/A decision session is not selected: ${sessionId}`,
      path: `${basePath}.sessionId`,
      sessionId
    });
  }
  const reason = stringValue(decision.reason);
  if (!reason || reason.trim().length < MIN_NA_REASON_LENGTH) {
    addFinding(findings, {
      artifactKind: kind,
      code: "weak_not_applicable_reason",
      message: `${basePath}.reason must contain at least ${MIN_NA_REASON_LENGTH} non-whitespace characters.`,
      path: `${basePath}.reason`,
      sessionId
    });
  }
  const evidenceRefs = stringArray(decision.evidenceRefs) ?? [];
  const reviewedEvidenceRefs = evidenceRefs.filter((ref) => input.evidenceByRef.get(ref)?.sessionId === sessionId);
  if (reviewedEvidenceRefs.length === 0) {
    addFinding(findings, {
      artifactKind: kind,
      code: "not_applicable_without_evidence",
      message: "N/A decisions require at least one reviewed evidence ref from the session.",
      path: `${basePath}.evidenceRefs`,
      sessionId
    });
  }
  validateEvidenceRefs(evidenceRefs, `${basePath}.evidenceRefs`, new Set([sessionId]), input, findings, kind, sessionId);
}

function validateContribution(
  decision: Record<string, unknown>,
  index: number,
  selectedSessions: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[]
): void {
  const sessionId = stringValue(decision.sessionId);
  const kind = automaticKind(decision.kind);
  const artifactId = stringValue(decision.publishedArtifactId);
  const basePath = `contributions[${index}]`;
  if (!sessionId || !kind || !artifactId) return;
  if (!selectedSessions.has(sessionId)) {
    addFinding(findings, {
      artifactKind: kind,
      code: "unexpected_automatic_resolution",
      message: `Contribution session is not selected: ${sessionId}`,
      path: `${basePath}.sessionId`,
      sessionId
    });
  }
  const publishedArtifact = input.publishedArtifacts.find((artifact) => artifact.artifactId === artifactId);
  if (
    !publishedArtifact ||
    publishedArtifact.status !== "current" ||
    publishedArtifact.publicationStatus !== "published" ||
    publishedArtifact.artifactKind !== kind ||
    !publishedArtifact.provenanceSessionIds.includes(sessionId)
  ) {
    addFinding(findings, {
      artifactKind: kind,
      code: "invalid_contribution",
      message: "Contribution must reference a current published artifact of the same kind containing the session.",
      path: `${basePath}.publishedArtifactId`,
      sessionId
    });
  }
}

function validateAutomaticKindResolution(
  selectedSessionIds: string[],
  artifacts: unknown[],
  notApplicable: unknown[],
  contributions: unknown[],
  findings: WorkbenchAuthoringFindingV2[]
): void {
  const selected = new Set(selectedSessionIds);
  const resolutionPaths = new Map<string, string[]>();
  const increment = (sessionId: string, kind: WorkbenchAutomaticArtifactKind, path: string): void => {
    if (!selected.has(sessionId)) return;
    const key = `${sessionId}\u0000${kind}`;
    resolutionPaths.set(key, [...(resolutionPaths.get(key) ?? []), path]);
  };

  artifacts.forEach((artifact, artifactIndex) => {
    if (!isRecord(artifact)) return;
    const kind = automaticKind(artifact.kind);
    const seedSessionId = stringValue(artifact.seedSessionId);
    if (!kind || !seedSessionId) return;
    increment(seedSessionId, kind, `artifacts[${artifactIndex}]`);
    const countedProvenance = new Set<string>();
    (stringArray(artifact.provenanceSessionIds) ?? []).forEach((sessionId, provenanceIndex) => {
      if (countedProvenance.has(sessionId)) return;
      countedProvenance.add(sessionId);
      if (sessionId !== seedSessionId) {
        increment(sessionId, kind, `artifacts[${artifactIndex}].provenanceSessionIds[${provenanceIndex}]`);
      }
    });
  });
  notApplicable.forEach((decision, index) => {
    if (!isRecord(decision)) return;
    const kind = automaticKind(decision.kind);
    const sessionId = stringValue(decision.sessionId);
    if (kind && sessionId) increment(sessionId, kind, `notApplicable[${index}]`);
  });
  contributions.forEach((decision, index) => {
    if (!isRecord(decision)) return;
    const kind = automaticKind(decision.kind);
    const sessionId = stringValue(decision.sessionId);
    if (kind && sessionId) increment(sessionId, kind, `contributions[${index}]`);
  });

  for (const sessionId of selectedSessionIds) {
    for (const kind of AUTOMATIC_KINDS) {
      const paths = resolutionPaths.get(`${sessionId}\u0000${kind}`) ?? [];
      if (paths.length === 0) {
        addFinding(findings, {
          artifactKind: kind,
          code: "unresolved_automatic_kind",
          message: `Automatic artifact kind is unresolved for ${sessionId}: ${kind}`,
          path: "artifacts",
          sessionId
        });
      } else if (paths.length > 1) {
        addFinding(findings, {
          artifactKind: kind,
          code: "duplicate_automatic_kind_resolution",
          message: `Automatic artifact kind resolves more than once for ${sessionId}: ${kind}`,
          path: paths[1],
          sessionId
        });
      }
    }
  }
}

function validateArtifactSignatures(
  artifacts: unknown[],
  findings: WorkbenchAuthoringFindingV2[]
): void {
  findings.push(...findArtifactSignatureFindings(artifacts));
}

export function findArtifactSignatureFindings(
  artifacts: unknown[]
): WorkbenchAuthoringFindingV2[] {
  const findings: WorkbenchAuthoringFindingV2[] = [];
  const seenSignatures = new Set<string>();
  artifacts.forEach((artifact, index) => {
    if (!isRecord(artifact) || !isRecord(artifact.output)) return;
    const kind = automaticKind(artifact.kind);
    const signatureKey = stringValue(artifact.output.signatureKey);
    if (!kind || signatureKey === undefined) return;
    const canonicalSignatureKey = normalizeSessionArtifactSignatureKey(signatureKey);
    if (!canonicalSignatureKey) {
      addFinding(findings, {
        artifactKind: kind,
        code: "blank_artifact_signature",
        message: "Artifact signatureKey must contain non-whitespace characters when present.",
        path: `artifacts[${index}].output.signatureKey`,
        sessionId: stringValue(artifact.seedSessionId)
      });
      return;
    }
    const key = `${kind}\u0000${canonicalSignatureKey}`;
    if (seenSignatures.has(key)) {
      addFinding(findings, {
        artifactKind: kind,
        code: "duplicate_artifact_signature",
        message:
          "Automatic drafts with the same kind and signatureKey must be authored as one combined-provenance multi-session artifact.",
        path: `artifacts[${index}].output.signatureKey`,
        sessionId: stringValue(artifact.seedSessionId)
      });
      return;
    }
    seenSignatures.add(key);
  });
  return findings;
}

function validateEvidenceRefs(
  refs: string[],
  path: string,
  provenance: Set<string>,
  input: WorkbenchAuthoringValidationContext,
  findings: WorkbenchAuthoringFindingV2[],
  artifactKind: WorkbenchOutputKind,
  sessionId: string | undefined
): void {
  refs.forEach((ref, index) => {
    const evidence = input.evidenceByRef.get(ref);
    if (!evidence) {
      addFinding(findings, {
        artifactKind,
        code: "unknown_evidence_ref",
        message: `Evidence ref is not in the canonical redacted evidence catalog: ${ref}`,
        path: `${path}[${index}]`,
        sessionId
      });
    } else if (!provenance.has(evidence.sessionId)) {
      addFinding(findings, {
        artifactKind,
        code: "evidence_outside_provenance",
        message: `Evidence ref belongs to a session outside artifact provenance: ${ref}`,
        path: `${path}[${index}]`,
        sessionId
      });
    }
  });
}

function requiredClaimPaths(kind: WorkbenchOutputKind, output: Record<string, unknown>): string[] {
  if (kind === "session_enrichment") {
    return nonBlank(output.outcome) ? ["outcome"] : [];
  }
  if (kind === "session_dossier") {
    return [
      ...arrayPaths(output.keyDecisions, "keyDecisions"),
      ...(nonBlank(output.outcome) ? ["outcome"] : []),
      ...arrayPaths(output.verification, "verification")
    ];
  }
  if (kind === "runbook") {
    return [
      ...arrayPaths(output.fixSteps, "fixSteps"),
      ...(nonBlank(output.rootCause) ? ["rootCause"] : []),
      ...arrayPaths(output.validationChecks, "validationChecks")
    ];
  }
  if (kind === "adr") return nonBlank(output.decision) ? ["decision"] : [];
  return [
    ...timelineClaimPaths(output.timeline),
    ...(nonBlank(output.rootCause) ? ["rootCause"] : []),
    ...arrayPaths(output.remediation, "remediation")
  ];
}

function claimBearingArrays(kind: WorkbenchOutputKind): string[] {
  if (kind === "session_dossier") return ["keyDecisions", "verification"];
  if (kind === "runbook") return ["fixSteps", "validationChecks"];
  if (kind === "adr") return ["alternatives", "consequences"];
  if (kind === "incident_timeline") return ["timeline", "remediation"];
  return [];
}

function validateRequiredStrings(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  findings: WorkbenchAuthoringFindingV2[],
  artifactKind: WorkbenchOutputKind,
  sessionId: string | undefined
): void {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = stringArray(schema.required) ?? [];
  for (const key of required) {
    const definition = properties[key];
    if (!isRecord(definition) || !Object.hasOwn(value, key)) continue;
    const propertyPath = `${path}.${key}`;
    if (definition.type === "string" && key !== "title" && key !== "summary") {
      validateRequiredText(findings, value[key], propertyPath, 1, artifactKind, sessionId);
    } else if (definition.type === "object" && isRecord(value[key])) {
      validateRequiredStrings(value[key], definition, propertyPath, findings, artifactKind, sessionId);
    } else if (definition.type === "array" && isRecord(definition.items) && definition.items.type === "object") {
      const entries = value[key];
      if (Array.isArray(entries)) {
        entries.forEach((entry, index) => {
          if (isRecord(entry)) {
            validateRequiredStrings(
              entry,
              definition.items as Record<string, unknown>,
              `${propertyPath}[${index}]`,
              findings,
              artifactKind,
              sessionId
            );
          }
        });
      }
    }
  }
}

function validateRequiredText(
  findings: WorkbenchAuthoringFindingV2[],
  value: unknown,
  path: string,
  minimum: number,
  artifactKind?: WorkbenchOutputKind,
  sessionId?: string
): void {
  if (typeof value !== "string" || value.trim().length < minimum) {
    addFinding(findings, {
      artifactKind,
      code: "insufficient_specificity",
      message: `${path} must contain at least ${minimum} non-whitespace characters.`,
      path,
      sessionId
    });
  }
}

function validateSchemaValue(
  value: unknown,
  definition: unknown,
  path: string,
  findings: WorkbenchAuthoringFindingV2[]
): void {
  if (!isRecord(definition)) return;
  if ("oneOf" in definition && Array.isArray(definition.oneOf)) {
    const selected = selectSchemaOption(value, definition.oneOf);
    if (selected) validateSchemaValue(value, selected, path, findings);
    else addSchemaFinding(findings, "invalid_type", path, `${displayPath(path)} does not match an allowed schema.`);
    return;
  }
  if ("const" in definition && value !== definition.const) {
    addSchemaFinding(findings, "invalid_type", path, `${displayPath(path)} must equal ${String(definition.const)}.`);
    return;
  }
  if ("enum" in definition && Array.isArray(definition.enum) && !definition.enum.includes(value)) {
    addSchemaFinding(findings, "invalid_type", path, `${displayPath(path)} must be one of: ${definition.enum.join(", ")}.`);
    return;
  }
  if (definition.type === "string") {
    if (typeof value !== "string") addSchemaFinding(findings, "invalid_type", path, `${displayPath(path)} must be a string.`);
    return;
  }
  if (definition.type === "array") {
    if (!Array.isArray(value)) {
      addSchemaFinding(findings, "invalid_type", path, `${displayPath(path)} must be an array.`);
      return;
    }
    value.forEach((entry, index) => validateSchemaValue(entry, definition.items, `${path}[${index}]`, findings));
    return;
  }
  if (definition.type !== "object") return;
  if (!isRecord(value)) {
    addSchemaFinding(findings, path ? "invalid_type" : "invalid_bundle", path, `${displayPath(path)} must be an object.`);
    return;
  }
  const properties = isRecord(definition.properties) ? definition.properties : {};
  for (const required of stringArray(definition.required) ?? []) {
    if (!Object.hasOwn(value, required)) {
      const requiredPath = path ? `${path}.${required}` : required;
      addSchemaFinding(findings, "missing_required", requiredPath, `Missing required field: ${requiredPath}`);
    }
  }
  if (definition.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        const propertyPath = path ? `${path}.${key}` : key;
        addSchemaFinding(findings, "unexpected_property", propertyPath, `Unexpected field: ${propertyPath}`);
      }
    }
  }
  for (const [key, propertyDefinition] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      validateSchemaValue(value[key], propertyDefinition, path ? `${path}.${key}` : key, findings);
    }
  }
}

function selectSchemaOption(value: unknown, options: unknown[]): unknown {
  if (isRecord(value)) {
    const discriminated = options.find((option) => {
      if (!isRecord(option) || !isRecord(option.properties) || !isRecord(option.properties.kind)) return false;
      return option.properties.kind.const === value.kind;
    });
    if (discriminated) return discriminated;
  }
  return options.length === 1 ? options[0] : undefined;
}

function addSchemaFinding(
  findings: WorkbenchAuthoringFindingV2[],
  code: "invalid_bundle" | "invalid_type" | "missing_required" | "unexpected_property",
  path: string,
  message: string
): void {
  addFinding(findings, { code, message, path: path || undefined });
}

function addFinding(
  findings: WorkbenchAuthoringFindingV2[],
  finding: Omit<WorkbenchAuthoringFindingV2, "severity"> & { severity?: "error" | "warning" }
): void {
  findings.push({ ...finding, severity: finding.severity ?? "error" });
}

function result(findings: WorkbenchAuthoringFindingV2[]): WorkbenchAuthoringValidationResult {
  return {
    findings,
    ok: !findings.some((finding) => finding.severity === "error")
  };
}

function claimEvidenceEntries(value: unknown): IndexedClaimEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== "string") return [];
    const evidenceRefs = stringArray(entry.evidenceRefs);
    return evidenceRefs ? [{ evidenceRefs, index, path: entry.path }] : [];
  });
}

function claimSupportEntries(value: unknown): WorkbenchClaimSupport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.evidenceRef !== "string" ||
      typeof entry.excerpt !== "string" ||
      ![
        "problem", "decision", "alternative", "change", "verification", "timeline", "remediation", "root_cause"
      ].includes(String(entry.supportKind))
    ) return [];
    return [{
      evidenceRef: entry.evidenceRef,
      excerpt: entry.excerpt,
      path: entry.path,
      supportKind: entry.supportKind as WorkbenchClaimSupport["supportKind"]
    }];
  });
}

function resolvePropertyPath(root: unknown, path: string): { exists: boolean; value?: unknown } {
  if (!/^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/.test(path)) return { exists: false };
  const tokens = [...path.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g)].map((match) => match[1] ?? Number(match[2]));
  let value = root;
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(value) || token >= value.length) return { exists: false };
      value = value[token];
    } else {
      if (!isRecord(value) || !Object.hasOwn(value, token)) return { exists: false };
      value = value[token];
    }
  }
  return { exists: true, value };
}

function timelineClaimPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => (isRecord(entry) && nonBlank(entry.summary) ? [`timeline[${index}].summary`] : []));
}

function arrayPaths(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => (nonBlank(entry) ? [`${field}[${index}]`] : []));
}

function isPassedVerification(evidence: WorkbenchValidationEvidence | undefined): boolean {
  return Boolean(
    evidence &&
      evidence.kind === "tool_result" &&
      evidence.exitCode === 0 &&
      evidence.status &&
      PASSED_STATUSES.has(evidence.status.toLowerCase())
  );
}

function automaticKind(value: unknown): WorkbenchAutomaticArtifactKind | undefined {
  return value === "runbook" || value === "adr" || value === "incident_timeline" ? value : undefined;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameProvenance(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function validateUniqueProvenanceIds(
  sessionIds: string[],
  path: string,
  artifactKind: WorkbenchAutomaticArtifactKind,
  seedSessionId: string,
  findings: WorkbenchAuthoringFindingV2[]
): void {
  const seen = new Set<string>();
  sessionIds.forEach((sessionId, index) => {
    if (seen.has(sessionId)) {
      addFinding(findings, {
        artifactKind,
        code: "duplicate_provenance_session",
        message: `Provenance session IDs must be unique: ${sessionId}`,
        path: `${path}[${index}]`,
        sessionId: seedSessionId
      });
    }
    seen.add(sessionId);
  });
}

function displayPath(path: string): string {
  return path || "Workbench authoring bundle";
}

function containsUnredactedSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value, (key, entry) =>
    key === "evidenceRefs" && Array.isArray(entry)
      ? entry.map(() => "[canonical-evidence-ref]")
      : entry
  );
  return Boolean(serialized && redactText(serialized) !== serialized);
}
