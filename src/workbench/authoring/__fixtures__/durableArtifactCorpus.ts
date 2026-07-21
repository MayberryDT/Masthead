import { withImmediateTransaction, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type {
  WorkbenchAuthoringBundleV3,
  WorkbenchAuthoringRunDto,
  WorkbenchAutomaticArtifactKind,
  WorkbenchClaimSupport
} from "../../../shared/workbenchAuthoring.ts";
import type { EvidenceRef } from "../../../core/types.ts";
import type { GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import type { SessionDossierDto } from "../../../shared/sessionDossier.ts";
import type { WorkbenchValidationEvidence } from "../../types.ts";
import type { GuidedAuthoringValidationInput } from "../guidedAuthoringQuality.ts";
import { failedV3TemplateBundle } from "./failedV3TemplateCampaign.ts";
import type { WorkbenchArtifactCandidate } from "../artifactCandidates.ts";

type CorpusEvidence = {
  id: string;
  kind: "message" | "tool_result" | "file_effect" | "checkpoint" | "runtime_signal";
  observedAt: string;
  text: string;
  label?: string;
  status?: string;
  exitCode?: number;
};

export type DurableArtifactCorpusSession = {
  id: string;
  title: string;
  evidence: readonly CorpusEvidence[];
};

const at = (minute: number): string => `2026-07-01T12:${String(minute).padStart(2, "0")}:00.000Z`;

export const dossierOnlyQuestion: DurableArtifactCorpusSession = {
  id: "session:dossier-question",
  title: "Question about table spacing",
  evidence: [
    { id: "message:dossier-question:1", kind: "message", observedAt: at(0), text: "How wide is the Logbook table?" },
    { id: "message:dossier-question:2", kind: "message", observedAt: at(1), text: "It is 960 pixels in this viewport." }
  ]
};

export const dossierOnlySparseSession: DurableArtifactCorpusSession = {
  id: "session:dossier-sparse",
  title: "Sparse orientation",
  evidence: [
    { id: "message:dossier-sparse:1", kind: "message", observedAt: at(0), text: "Please inspect the repository." }
  ]
};

export const completedImplementationForEnrichedDossier: DurableArtifactCorpusSession = {
  id: "session:implementation-complete",
  title: "Complete artifact search pagination",
  evidence: [
    {
      id: "message:implementation-complete:objective",
      kind: "message",
      observedAt: at(0),
      text: "Implemented stable pagination for artifact search results."
    },
    {
      id: "file:implementation-complete:change",
      kind: "file_effect",
      observedAt: at(1),
      text: "modified src/daemon/db/sessionArtifactRepository.ts",
      label: "modified"
    },
    {
      id: "checkpoint:implementation-complete:verified",
      kind: "checkpoint",
      observedAt: at(2),
      text: "Artifact search pagination tests passed.",
      label: "verification_passed"
    }
  ]
};

export const oauthFailureFixedAndVerified: DurableArtifactCorpusSession = {
  id: "session:oauth-fixed",
  title: "Repair OAuth callback failure",
  evidence: [
    {
      id: "tool_result:oauth:failure",
      kind: "tool_result",
      observedAt: at(0),
      text: "OAuth callback test failed with an invalid state nonce.",
      label: "failed",
      status: "failed",
      exitCode: 1
    },
    {
      id: "file:oauth:change",
      kind: "file_effect",
      observedAt: at(1),
      text: "modified auth/callback.ts",
      label: "modified"
    },
    {
      id: "checkpoint:oauth:verified",
      kind: "checkpoint",
      observedAt: at(2),
      text: "Callback regression test passed after the nonce repair.",
      label: "verification_passed"
    }
  ]
};

export const databaseMigrationFailureFixedAndVerified: DurableArtifactCorpusSession = {
  id: "session:migration-fixed",
  title: "Recover failed database migration",
  evidence: [
    {
      id: "tool_result:migration:failure",
      kind: "tool_result",
      observedAt: at(0),
      text: "Migration 41 failed because the index already existed.",
      label: "failed",
      status: "failed",
      exitCode: 1
    },
    {
      id: "file:migration:change",
      kind: "file_effect",
      observedAt: at(1),
      text: "modified migrations/041_retry.sql",
      label: "modified"
    },
    {
      id: "tool_result:migration:verified",
      kind: "tool_result",
      observedAt: at(2),
      text: "Migration smoke test passed on a restored snapshot.",
      label: "succeeded",
      status: "succeeded",
      exitCode: 0
    }
  ]
};

const oauthPerformedActionEvidence: CorpusEvidence = {
  id: "message:oauth:action",
  kind: "message",
  observedAt: at(1),
  text: "Implemented callback nonce validation and ran the OAuth callback regression test."
};

const migrationPerformedActionEvidence: CorpusEvidence = {
  id: "message:migration:action",
  kind: "message",
  observedAt: at(1),
  text: "Applied the migration 41 repair and ran the migration smoke check on a restored snapshot."
};

export const explicitArchitectureDecision: DurableArtifactCorpusSession = {
  id: "session:decision-local-first",
  title: "Choose local-first storage",
  evidence: [
    {
      id: "message:decision-local-first:decision",
      kind: "message",
      observedAt: at(0),
      text: "Decision: adopt SQLite as the canonical local-first session store."
    },
    {
      id: "message:decision-local-first:alternative",
      kind: "message",
      observedAt: at(1),
      text: "Rejected alternative: a hosted database would break offline operation."
    }
  ]
};

export const misleadingSuggestionSession: DurableArtifactCorpusSession = {
  id: "session:agent-judgment-only",
  title: "Set authorization cache location",
  evidence: [
    {
      id: "message:agent-judgment-only:direction",
      kind: "message",
      observedAt: at(0),
      text: "The authorization cache stays process-local to preserve offline startup."
    },
    {
      id: "message:agent-judgment-only:tradeoff",
      kind: "message",
      observedAt: at(1),
      text: "A hosted cache would prevent offline startup and add a network dependency."
    }
  ]
};

export const decisionWithRejectedAlternatives: DurableArtifactCorpusSession = {
  id: "session:decision-artifact-logbook",
  title: "Define Logbook contents",
  evidence: [
    {
      id: "message:decision-artifact-logbook:alternatives",
      kind: "message",
      observedAt: at(0),
      text: "Considered session rows and raw transcripts as alternatives, but rejected both."
    },
    {
      id: "checkpoint:decision-artifact-logbook:decision",
      kind: "checkpoint",
      observedAt: at(1),
      text: "Decision approved: Logbook contains published artifacts only.",
      label: "decision_recorded"
    }
  ]
};

export const productionIncidentWithRootCause: DurableArtifactCorpusSession = {
  id: "session:incident-root-cause",
  title: "Production ingestion outage",
  evidence: [
    {
      id: "signal:incident-root-cause:detected",
      kind: "runtime_signal",
      observedAt: at(0),
      text: "Ingestion requests failed across production.",
      label: "incident_detected",
      status: "error"
    },
    {
      id: "signal:incident-root-cause:triage",
      kind: "runtime_signal",
      observedAt: at(1),
      text: "Triage isolated exhausted SQLite writer leases.",
      label: "incident_triage"
    },
    {
      id: "signal:incident-root-cause:mitigated",
      kind: "runtime_signal",
      observedAt: at(2),
      text: "The stuck writer was recycled and backlog processing resumed.",
      label: "incident_mitigated"
    },
    {
      id: "checkpoint:incident-root-cause:restored",
      kind: "checkpoint",
      observedAt: at(3),
      text: "Service health and backlog drain were verified.",
      label: "incident_restored"
    }
  ]
};

export const incidentWithoutProvenRootCause: DurableArtifactCorpusSession = {
  id: "session:incident-unproven-cause",
  title: "Transient authentication outage",
  evidence: [
    {
      id: "signal:incident-unproven:detected",
      kind: "runtime_signal",
      observedAt: at(0),
      text: "Authentication requests failed for seven minutes.",
      label: "incident_detected",
      status: "critical"
    },
    {
      id: "signal:incident-unproven:investigated",
      kind: "runtime_signal",
      observedAt: at(1),
      text: "Operators investigated without establishing a root cause.",
      label: "incident_investigated"
    },
    {
      id: "signal:incident-unproven:mitigated",
      kind: "runtime_signal",
      observedAt: at(2),
      text: "Traffic was shifted to healthy workers.",
      label: "incident_mitigated"
    },
    {
      id: "checkpoint:incident-unproven:restored",
      kind: "checkpoint",
      observedAt: at(3),
      text: "Authentication success rate returned to baseline; cause remains unproven.",
      label: "incident_restored"
    }
  ]
};

export const repeatedErrorPartOne: DurableArtifactCorpusSession = {
  id: "session:repeated-error:1",
  title: "Repair Codex command on host one",
  evidence: [
    {
      id: "tool_result:repeated-error:1:failure",
      kind: "tool_result",
      observedAt: at(0),
      text: "ssh: codex: command not found. ERROR_SIGNATURE: ssh codex command not found",
      label: "failed",
      status: "failed",
      exitCode: 127
    },
    {
      id: "file:repeated-error:1:change",
      kind: "file_effect",
      observedAt: at(1),
      text: "modified shell environment launcher",
      label: "modified"
    },
    {
      id: "checkpoint:repeated-error:1:verified",
      kind: "checkpoint",
      observedAt: at(2),
      text: "Remote codex --version check passed.",
      label: "verification_passed"
    }
  ]
};

export const repeatedErrorPartTwo: DurableArtifactCorpusSession = {
  id: "session:repeated-error:2",
  title: "Repair Codex command on host two",
  evidence: [
    {
      id: "tool_result:repeated-error:2:failure",
      kind: "tool_result",
      observedAt: at(0),
      text: "ssh: codex: command not found. ERROR_SIGNATURE: SSH / Codex command not found",
      label: "failed",
      status: "failed",
      exitCode: 127
    },
    {
      id: "file:repeated-error:2:change",
      kind: "file_effect",
      observedAt: at(1),
      text: "modified the remote PATH bootstrap",
      label: "modified"
    },
    {
      id: "tool_result:repeated-error:2:verified",
      kind: "tool_result",
      observedAt: at(2),
      text: "Remote codex verification command succeeded.",
      label: "succeeded",
      status: "succeeded",
      exitCode: 0
    }
  ]
};

export const mastheadAuthoringDiscussion: DurableArtifactCorpusSession = {
  id: "session:masthead-authoring-discussion",
  title: "Discuss artifact authoring",
  evidence: [
    {
      id: "message:masthead-authoring:1",
      kind: "message",
      observedAt: at(0),
      text: "Candidate discovery should stay conservative and deterministic."
    },
    {
      id: "message:masthead-authoring:2",
      kind: "message",
      observedAt: at(1),
      text: "A model can author only after the database presents a grounded candidate."
    }
  ]
};

export const veryLargeNoisySession: DurableArtifactCorpusSession = {
  id: "session:very-large-noisy",
  title: "Large read-only repository survey",
  evidence: Array.from({ length: 240 }, (_, index) => ({
    id: `tool_result:noise:${String(index).padStart(3, "0")}`,
    kind: "tool_result" as const,
    observedAt: `2026-07-01T13:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    text: `Read-only inspection result ${index}`,
    label: "succeeded",
    status: "succeeded",
    exitCode: 0
  }))
};

export const durableArtifactCorpus = [
  dossierOnlyQuestion,
  dossierOnlySparseSession,
  oauthFailureFixedAndVerified,
  databaseMigrationFailureFixedAndVerified,
  explicitArchitectureDecision,
  decisionWithRejectedAlternatives,
  productionIncidentWithRootCause,
  incidentWithoutProvenRootCause,
  repeatedErrorPartOne,
  repeatedErrorPartTwo,
  mastheadAuthoringDiscussion,
  veryLargeNoisySession
] as const;

export const focusedAgentLedCorpus = [
  completedImplementationForEnrichedDossier,
  {
    ...databaseMigrationFailureFixedAndVerified,
    evidence: [
      ...databaseMigrationFailureFixedAndVerified.evidence.slice(0, 2),
      migrationPerformedActionEvidence,
      ...databaseMigrationFailureFixedAndVerified.evidence.slice(2)
    ]
  },
  explicitArchitectureDecision,
  productionIncidentWithRootCause
] as const;

export type GuidedQualityCorpusFixtureCase = {
  caseId: "sparse" | "supported_protocol" | "runbook" | "adr" | "incident" | "failed_v3_template";
  input: GuidedAuthoringValidationInput;
};

export function buildGuidedQualityCorpusCases(): GuidedQualityCorpusFixtureCase[] {
  return [
    { caseId: "sparse", input: guidedDossierOnlyInput("sparse") },
    { caseId: "supported_protocol", input: guidedDossierOnlyInput("supported_protocol") },
    { caseId: "runbook", input: guidedArtifactInput("runbook") },
    { caseId: "adr", input: guidedArtifactInput("adr") },
    { caseId: "incident", input: guidedArtifactInput("incident_timeline") },
    { caseId: "failed_v3_template", input: guidedFailedTemplateInput() }
  ];
}

export function guidedAcceptedArtifactOutput(
  kind: "runbook" | "adr" | "incident_timeline"
): Record<string, unknown> {
  if (kind === "runbook") return guidedRunbookOutput();
  if (kind === "adr") return guidedAdrOutput();
  return guidedIncidentOutput();
}

function guidedDossierOnlyInput(kind: "sparse" | "supported_protocol"): GuidedAuthoringValidationInput {
  const sessionId = kind === "sparse" ? "session:guided:sparse" : "session:guided:protocol";
  const assignmentId = `assignment:guided:${kind}`;
  const evidenceRevision = `revision:guided:${kind}`;
  const text = kind === "sparse"
    ? "The repository orientation identified the Workbench authoring module, but verification was not run."
    : "The requested work debugged the workbench author save command and confirmed its bundle validation behavior; verification was not run.";
  const title = kind === "sparse"
    ? "Map the Workbench authoring boundary"
    : "Debug workbench author save validation";
  const purpose = kind === "sparse"
    ? "Map the repository boundary for Workbench authoring without changing runtime behavior."
    : "Debug the workbench author save command because that protocol was the requested product subject.";
  const outcome = kind === "sparse"
    ? "Located the authoring boundary and recorded the relevant validation module."
    : "Confirmed how the workbench author save command validates its bundle.";
  const evidenceRef = `evidence:guided:${kind}`;
  const evidenceText = `${title}. ${purpose} ${outcome} ${text}`;
  return guidedInput({
    assignmentId,
    evidenceRevision,
    sessionId,
    evidence: new Map([[evidenceRef, guidedEvidence(sessionId, "message", evidenceText, { role: "assistant" })]]),
    enrichment: guidedEnrichment({ evidenceRef, outcome, purpose, summary: text, title }),
    claimSupport: guidedSessionSupports(evidenceRef, { title, summary: text, purpose, outcome })
  });
}

function guidedArtifactInput(kind: "runbook" | "adr" | "incident_timeline"): GuidedAuthoringValidationInput {
  const sessionId = `session:guided:${kind}`;
  const assignmentId = `assignment:guided:${kind}`;
  const evidenceRevision = `revision:guided:${kind}`;
  const opportunityId = `opportunity:guided:${kind}`;
  const draftId = `draft:guided:${kind}`;
  const sessionRef = `evidence:guided:${kind}:session`;
  const title = kind === "runbook" ? "Recover migration 41 safely"
    : kind === "adr" ? "Keep canonical sessions local-first"
      : "Recover a stale writer lease";
  const purpose = kind === "runbook" ? "Document the migration 41 existing-index recovery procedure."
    : kind === "adr" ? "Record the durable local-first storage decision and its reversal condition."
      : "Record the writer-lease outage, cause, recovery, and verification.";
  const outcome = kind === "runbook" ? "Captured an executable migration recovery with verification and rollback handling."
    : kind === "adr" ? "Captured the SQLite decision, rejected hosted alternative, and revisit condition."
      : "Captured the writer-lease incident sequence and verified recovery.";
  const verification = kind === "runbook"
    ? { evidenceRef: "evidence:guided:runbook:verification", summary: "Run the migration smoke check and confirm schema version 41." }
    : kind === "incident_timeline"
      ? { evidenceRef: "evidence:guided:incident_timeline:verification", summary: "A canary draft saved and published once, and the database integrity check passed." }
      : undefined;
  const summary = verification
    ? `${outcome} ${verification.summary}`
    : `${outcome} Verification was not run for the dossier enrichment itself.`;
  const evidence = guidedArtifactEvidence(kind, sessionId, sessionRef, `${title}. ${purpose} ${outcome} ${summary}`);
  const output = guidedAcceptedArtifactOutput(kind);
  const artifact = {
    draftId,
    kind,
    seedSessionId: sessionId,
    provenanceSessionIds: [sessionId],
    output
  } satisfies GuidedAuthoringBundleV4["artifacts"][number];
  const opportunityRef = kind === "runbook" ? "evidence:guided:runbook:problem"
    : kind === "adr" ? "evidence:guided:adr:decision"
      : "evidence:guided:incident_timeline:problem";
  const opportunitySummary = kind === "runbook"
    ? "A repeated migration recovery procedure needs trigger, verification, and rollback guidance."
    : kind === "adr"
      ? "A durable storage decision needs alternatives, consequences, and reversal conditions."
      : "A production outage needs impact, timeline, root cause, remediation, and recovery verification.";
  return guidedInput({
    assignmentId,
    evidenceRevision,
    sessionId,
    evidence,
    enrichment: guidedEnrichment({ evidenceRef: sessionRef, outcome, purpose, summary, title, verification }),
    claimSupport: guidedSessionSupports(sessionRef, { title, summary, purpose, outcome, verification }),
    opportunity: {
      opportunityId,
      suggestedKind: kind,
      signalStrength: "high",
      summary: opportunitySummary,
      evidenceRefs: [opportunityRef],
      provenanceSessionIds: [sessionId]
    },
    disposition: {
      opportunityId,
      disposition: "authored",
      rationale: `The ${kind} captures the specific evidence-backed reusable result.`,
      evidenceRefs: [opportunityRef],
      artifactKind: kind,
      artifactDraftId: draftId
    },
    artifact
  });
}

function guidedInput(input: {
  assignmentId: string;
  evidenceRevision: string;
  sessionId: string;
  evidence: Map<string, WorkbenchValidationEvidence>;
  enrichment: DurableSessionEnrichment;
  claimSupport: WorkbenchClaimSupport[];
  opportunity?: GuidedAuthoringValidationInput["opportunities"][number];
  disposition?: GuidedAuthoringBundleV4["opportunityDispositions"][number];
  artifact?: GuidedAuthoringBundleV4["artifacts"][number];
}): GuidedAuthoringValidationInput {
  return {
    bundle: {
      bundleVersion: "workbench-authoring-v4",
      assignmentId: input.assignmentId,
      evidenceRevision: input.evidenceRevision,
      sessionEnrichments: [{ sessionId: input.sessionId, enrichment: input.enrichment, claimSupport: input.claimSupport }],
      opportunityDispositions: input.disposition ? [input.disposition] : [],
      artifacts: input.artifact ? [input.artifact] : []
    },
    assignment: {
      assignmentId: input.assignmentId,
      requestId: `request:${input.assignmentId}`,
      evidenceRevision: input.evidenceRevision,
      sessionIds: [input.sessionId],
      opportunityIds: input.opportunity ? [input.opportunity.opportunityId] : []
    },
    canonicalDossiersBySession: new Map([[input.sessionId, guidedCanonicalDossier(input.sessionId)]]),
    evidenceByRef: input.evidence,
    coverage: [{
      sessionId: input.sessionId,
      evidenceRevision: input.evidenceRevision,
      accessedItems: input.evidence.size,
      totalItems: input.evidence.size,
      complete: true
    }],
    opportunities: input.opportunity ? [input.opportunity] : [],
    requestAcceptedDrafts: []
  };
}

function guidedEnrichment(input: {
  evidenceRef: string;
  title: string;
  summary: string;
  purpose: string;
  outcome: string;
  verification?: { evidenceRef: string; summary: string };
}): DurableSessionEnrichment {
  const ref = guidedEvidenceRef(input.evidenceRef);
  const verificationRef = input.verification
    ? guidedEvidenceRef(input.verification.evidenceRef)
    : undefined;
  return {
    version: "session-capsule-v4",
    sessionTitle: { text: input.title, basis: "dominant_work", confidence: "high", evidenceRefs: [ref] },
    sessionSummary: { text: input.summary, state: "partial", confidence: "high", evidenceRefs: [ref] },
    sessionDossier: {
      purpose: input.purpose,
      outcome: input.outcome,
      keyWork: [], decisions: [], blockers: [],
      verification: input.verification && verificationRef
        ? { status: "passed", summary: input.verification.summary, commands: [], failures: [], evidenceRefs: [verificationRef] }
        : { status: "missing", summary: "", commands: [], failures: [], evidenceRefs: [] },
      continuation: { openQuestions: [], constraints: [] },
      evidenceRefs: [ref],
      warnings: input.verification ? [] : ["Verification was not run for this dossier enrichment."]
    }
  };
}

function guidedSessionSupports(
  evidenceRef: string,
  claims: {
    title: string;
    summary: string;
    purpose: string;
    outcome: string;
    verification?: { evidenceRef: string; summary: string };
  }
): WorkbenchClaimSupport[] {
  const supports: WorkbenchClaimSupport[] = [
    guidedSupport("/sessionTitle/text", evidenceRef, claims.title, "reuse"),
    guidedSupport("/sessionSummary/text", evidenceRef, claims.summary, "outcome"),
    guidedSupport("/sessionDossier/purpose", evidenceRef, claims.purpose, "purpose"),
    guidedSupport("/sessionDossier/outcome", evidenceRef, claims.outcome, "outcome")
  ];
  if (claims.verification) {
    supports.push(guidedSupport(
      "/sessionDossier/verification/summary",
      claims.verification.evidenceRef,
      claims.verification.summary,
      "verification"
    ));
  }
  return supports;
}

function guidedRunbookOutput(): Record<string, unknown> {
  const problem = "evidence:guided:runbook:problem";
  const change = "evidence:guided:runbook:change";
  const verification = "evidence:guided:runbook:verification";
  return {
    title: "Recover migration 41 from an existing-index failure",
    confidence: "high",
    evidenceRefs: [problem, change, verification],
    missingEvidence: [],
    problemSignature: { symptoms: [], errorStrings: [], affectedScope: "Migration 41 fails because the target index already exists." },
    preconditions: ["A restorable pre-migration database backup is available."],
    reproSteps: [], deadEnds: [],
    fixSteps: ["Confirm the existing index definition matches migration 41, then mark the migration applied."],
    commands: [], changedFiles: [],
    validationChecks: ["Run the migration smoke check and confirm schema version 41."],
    environmentRequirements: [],
    rootCause: "Root cause is unknown from the available evidence.",
    preventionNotes: [],
    risksOrGaps: [
      "Rollback remains required if the existing index definition does not match migration 41.",
      "If the definitions differ, stop, restore the pre-migration backup, and reconcile the index manually."
    ],
    provenanceSessionIds: ["session:guided:runbook"],
    claimSupport: [
      guidedSupport("problemSignature.affectedScope", problem, "Migration 41 fails because the target index already exists.", "problem"),
      guidedSupport("preconditions[0]", problem, "A restorable pre-migration database backup is available.", "problem"),
      guidedSupport("fixSteps[0]", change, "Confirm the existing index definition matches migration 41, then mark the migration applied.", "change"),
      guidedSupport("validationChecks[0]", verification, "Run the migration smoke check and confirm schema version 41.", "verification"),
      guidedSupport("risksOrGaps[0]", problem, "Rollback remains required if the existing index definition does not match migration 41.", "problem"),
      guidedSupport("risksOrGaps[1]", problem, "If the definitions differ, stop, restore the pre-migration backup, and reconcile the index manually.", "problem")
    ]
  };
}

function guidedAdrOutput(): Record<string, unknown> {
  const evidenceRef = "evidence:guided:adr:decision";
  return {
    title: "Keep canonical Masthead session storage local-first",
    confidence: "high",
    evidenceRefs: [evidenceRef],
    missingEvidence: [],
    context: "Masthead must preserve offline operation and local ownership of canonical session data.",
    decision: "Keep the canonical Masthead session database local in SQLite.",
    status: "accepted",
    alternatives: ["Make a hosted service the canonical session store."],
    consequences: ["Revisit when multi-device concurrent writers become a supported product requirement."],
    affectedPaths: [], supersedes: [],
    provenanceSessionIds: ["session:guided:adr"],
    claimSupport: [
      guidedSupport("context", evidenceRef, "Masthead must preserve offline operation and local ownership of canonical session data.", "problem"),
      guidedSupport("decision", evidenceRef, "Keep the canonical Masthead session database local in SQLite.", "decision"),
      guidedSupport("status", evidenceRef, "The local-first storage decision was accepted.", "decision"),
      guidedSupport("alternatives[0]", evidenceRef, "Make a hosted service the canonical session store.", "alternative"),
      guidedSupport("consequences[0]", evidenceRef, "Revisit when multi-device concurrent writers become a supported product requirement.", "decision")
    ]
  };
}

function guidedIncidentOutput(): Record<string, unknown> {
  const problem = "evidence:guided:incident_timeline:problem";
  const recovery = "evidence:guided:incident_timeline:recovery";
  const verification = "evidence:guided:incident_timeline:verification";
  return {
    title: "Recover Workbench publishing after a stale writer lease",
    confidence: "high",
    evidenceRefs: [problem, recovery, verification],
    missingEvidence: [],
    symptom: "Workbench publish attempts could not acquire the writer lease.",
    impact: "Workbench publishing was unavailable while reads remained available.",
    timeline: [
      { at: "2026-07-19T12:00:00.000Z", evidenceRefs: [problem], summary: "Workbench publish attempts could not acquire the writer lease." },
      { at: "2026-07-19T12:05:00.000Z", evidenceRefs: [recovery], summary: "Validate the stale owner, clear the lease, and restart the production daemon." },
      { at: "2026-07-19T12:10:00.000Z", evidenceRefs: [verification], summary: "A canary draft saved and published once, and the database integrity check passed." }
    ],
    rootCause: "A stale writer lease survived an unclean daemon exit.",
    contributingFactors: ["The unclean exit prevented normal writer-lease cleanup."],
    remediation: ["Validate the stale owner, clear the lease, and restart the production daemon."],
    prevention: [],
    status: "resolved",
    provenanceSessionIds: ["session:guided:incident_timeline"],
    claimSupport: [
      guidedSupport("symptom", problem, "Workbench publish attempts could not acquire the writer lease.", "problem"),
      guidedSupport("impact", problem, "Workbench publishing was unavailable while reads remained available.", "problem"),
      guidedSupport("timeline[0].summary", problem, "Workbench publish attempts could not acquire the writer lease.", "timeline"),
      guidedSupport("timeline[1].summary", recovery, "Validate the stale owner, clear the lease, and restart the production daemon.", "timeline"),
      guidedSupport("timeline[2].summary", verification, "A canary draft saved and published once, and the database integrity check passed.", "timeline"),
      guidedSupport("rootCause", problem, "A stale writer lease survived an unclean daemon exit.", "root_cause"),
      guidedSupport("contributingFactors[0]", problem, "The unclean exit prevented normal writer-lease cleanup.", "problem"),
      guidedSupport("remediation[0]", recovery, "Validate the stale owner, clear the lease, and restart the production daemon.", "remediation"),
      guidedSupport("status", verification, "A canary draft saved and published once, and the database integrity check passed.", "verification")
    ]
  };
}

function guidedArtifactEvidence(
  kind: "runbook" | "adr" | "incident_timeline",
  sessionId: string,
  sessionRef: string,
  sessionText: string
): Map<string, WorkbenchValidationEvidence> {
  const evidence = new Map<string, WorkbenchValidationEvidence>([
    [sessionRef, guidedEvidence(sessionId, "message", sessionText, { role: "assistant" })]
  ]);
  if (kind === "runbook") {
    evidence.set("evidence:guided:runbook:problem", guidedEvidence(sessionId, "message", [
      "Migration 41 fails because the target index already exists.",
      "A restorable pre-migration database backup is available.",
      "Rollback remains required if the existing index definition does not match migration 41.",
      "If the definitions differ, stop, restore the pre-migration backup, and reconcile the index manually."
    ].join(" "), { role: "user" }));
    evidence.set("evidence:guided:runbook:change", guidedEvidence(sessionId, "message", "Implemented the migration 41 recovery: Confirm the existing index definition matches migration 41, then mark the migration applied.", { role: "assistant" }));
    evidence.set("evidence:guided:runbook:verification", guidedEvidence(sessionId, "tool_result", "Run the migration smoke check and confirm schema version 41.", { role: "tool", status: "passed", exitCode: 0, toolName: "migration smoke test" }));
  } else if (kind === "adr") {
    evidence.set("evidence:guided:adr:decision", guidedEvidence(sessionId, "message", [
      "Masthead must preserve offline operation and local ownership of canonical session data.",
      "Keep the canonical Masthead session database local in SQLite.",
      "The local-first storage decision was accepted.",
      "Make a hosted service the canonical session store.",
      "Revisit when multi-device concurrent writers become a supported product requirement."
    ].join(" "), { role: "user" }));
  } else {
    evidence.set("evidence:guided:incident_timeline:problem", guidedEvidence(sessionId, "message", [
      "Workbench publish attempts could not acquire the writer lease.",
      "Workbench publishing was unavailable while reads remained available.",
      "A stale writer lease survived an unclean daemon exit.",
      "The unclean exit prevented normal writer-lease cleanup."
    ].join(" "), { role: "user", observedAt: "2026-07-19T12:00:00.000Z" }));
    evidence.set("evidence:guided:incident_timeline:recovery", guidedEvidence(sessionId, "message", "Validate the stale owner, clear the lease, and restart the production daemon.", { role: "assistant", observedAt: "2026-07-19T12:05:00.000Z" }));
    evidence.set("evidence:guided:incident_timeline:verification", guidedEvidence(sessionId, "tool_result", "A canary draft saved and published once, and the database integrity check passed.", { role: "tool", observedAt: "2026-07-19T12:10:00.000Z", status: "passed", exitCode: 0, toolName: "database integrity check" }));
  }
  return evidence;
}

function guidedEvidence(
  sessionId: string,
  kind: WorkbenchValidationEvidence["kind"],
  text: string,
  options: Partial<WorkbenchValidationEvidence> = {}
): WorkbenchValidationEvidence {
  return {
    sessionId,
    kind,
    role: "system",
    text,
    observedAt: "2026-07-19T12:00:00.000Z",
    lowValue: false,
    ...options
  };
}

function guidedEvidenceRef(id: string): EvidenceRef {
  return { id, kind: "event", observedAt: "2026-07-19T12:00:00.000Z", source: "guided-quality-corpus" };
}

function guidedSupport(
  path: string,
  evidenceRef: string,
  excerpt: string,
  supportKind: WorkbenchClaimSupport["supportKind"]
): WorkbenchClaimSupport {
  return { path, evidenceRef, excerpt, supportKind };
}

function guidedCanonicalDossier(sessionId: string): SessionDossierDto {
  return {
    identity: { sessionId }, enrichment: { status: "not_enriched" },
    coverage: { level: "complete", warnings: [], transcript: {} }, narrative: {}, files: [], tools: [],
    verification: {}, attention: [], excerpts: [], timeline: [], reuse: {}, artifacts: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 }
  } as unknown as SessionDossierDto;
}

function guidedFailedTemplateInput(): GuidedAuthoringValidationInput {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    sessionId: `session:guided:template:${index}`,
    title: "Process selected authoring request",
    request: "Publish enriched session dossiers and identify reusable operational knowledge",
    evidence: [
      { id: `evidence:guided:template:${index}:first`, text: "Publish enriched session dossiers and identify reusable operational knowledge for the selected work." },
      { id: `evidence:guided:template:${index}:middle`, text: "The implementation changed a session-specific component and recorded its local result." },
      { id: `evidence:guided:template:${index}:last`, text: "The selected authoring request reached a final response without a recorded verification run." }
    ]
  }));
  const opportunities = (["runbook", "adr", "incident_timeline"] as const).map((kind, index) => ({
    opportunityId: `opportunity:guided:template:${kind}`,
    evidenceRefs: [`evidence:guided:template:${index}:middle`],
    suggestedKind: kind,
    signalStrength: "high" as const,
    summary: kind === "runbook" ? "Repeated procedure needs trigger verification and rollback guidance."
      : kind === "adr" ? "Decision needs alternatives consequences and reversal conditions."
        : "Incident needs impact timeline root cause remediation and recovery verification.",
    provenanceSessionIds: [`session:guided:template:${index}`]
  }));
  return {
    bundle: failedV3TemplateBundle({ assignmentId: "assignment:guided:template", evidenceRevision: "revision:guided:template", sessions, opportunities }),
    assignment: {
      assignmentId: "assignment:guided:template", requestId: "request:guided:template",
      evidenceRevision: "revision:guided:template", sessionIds: sessions.map(({ sessionId }) => sessionId),
      opportunityIds: opportunities.map(({ opportunityId }) => opportunityId)
    },
    canonicalDossiersBySession: new Map(sessions.map(({ sessionId }) => [sessionId, guidedCanonicalDossier(sessionId)])),
    evidenceByRef: new Map(sessions.flatMap((session) => session.evidence.map((item) => [item.id, guidedEvidence(session.sessionId, "message", item.text, { role: "user" })]))),
    coverage: sessions.map(({ sessionId }) => ({ sessionId, evidenceRevision: "revision:guided:template", accessedItems: 2, totalItems: 3, complete: false })),
    opportunities,
    requestAcceptedDrafts: []
  };
}

export function corpusSessionIds(): string[] {
  return durableArtifactCorpus.map((session) => session.id);
}

export function seedDurableArtifactCorpus(db: MastheadDatabase): void {
  seedFocusedAgentLedCorpus(db, durableArtifactCorpus);
}

export function seedDurableArtifactCorpusWithPerformedActions(db: MastheadDatabase): void {
  seedDurableArtifactCorpus(db);
  insertEvidence(db, oauthFailureFixedAndVerified.id, oauthPerformedActionEvidence);
  insertEvidence(db, databaseMigrationFailureFixedAndVerified.id, migrationPerformedActionEvidence);
}

export function seedFocusedAgentLedCorpus(
  db: MastheadDatabase,
  sessions: readonly DurableArtifactCorpusSession[]
): void {
  const fixedAt = "2026-07-01T12:00:00.000Z";
  db.prepare(
    "INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES ('host:corpus', 'corpus', ?, ?)"
  ).run(fixedAt, fixedAt);
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES ('runtime:corpus', 'codex', 'fixture', ?, ?)"
  ).run(fixedAt, fixedAt);
  const insertSession = db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
    ) VALUES (?, 'host:corpus', 'runtime:corpus', ?, 'Masthead', ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    `INSERT INTO workbench_session_state (
      session_id, publication_status, next_action, transcript_status, quality_status
    ) VALUES (?, 'publish_path', 'enrich', 'imported', 'passed')`
  );

  for (const session of sessions) {
    const lastAt = session.evidence.at(-1)?.observedAt ?? fixedAt;
    insertSession.run(session.id, session.id, session.title, fixedAt, lastAt, lastAt, fixedAt, lastAt);
    insertState.run(session.id);
    for (const evidence of session.evidence) insertEvidence(db, session.id, evidence);
  }
}

export function buildFocusedAgentLedBundle(
  run: Pick<WorkbenchAuthoringRunDto, "evidenceRevision" | "runId">,
  sessions: readonly DurableArtifactCorpusSession[],
  optionalKinds: readonly WorkbenchAutomaticArtifactKind[] = ["runbook", "adr", "incident_timeline"]
): WorkbenchAuthoringBundleV3 {
  return {
    artifacts: optionalKinds.map((kind) => focusedOptionalArtifact(kind, sessions)),
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision: run.evidenceRevision,
    runId: run.runId,
    sessionEnrichments: sessions.map((session) => focusedSessionEnrichment(session))
  };
}

export function seedToolHeavyPerformanceSessions(
  db: MastheadDatabase,
  sessionCount: number,
  toolsPerSession: number
): { evidenceItemsPerSession: number; sessionCount: number; toolsPerSession: number; totalEvidenceItems: number } {
  const at = "2026-07-12T00:00:00.000Z";
  db.prepare(
    "INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES ('host:perf', 'perf', ?, ?)"
  ).run(at, at);
  db.prepare(
    "INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES ('runtime:perf', 'codex', 'test', ?, ?)"
  ).run(at, at);
  const insertSession = db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
    ) VALUES (?, 'host:perf', 'runtime:perf', ?, 'Performance', ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    "INSERT INTO workbench_session_state (session_id, publication_status) VALUES (?, 'publish_path')"
  );
  const insertCall = db.prepare(
    "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, 'read_file', ?, '{}')"
  );
  const insertResult = db.prepare(
    "INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, source_ref_json) VALUES (?, ?, ?, 'succeeded', ?, '{}')"
  );
  withImmediateTransaction(db, () => {
    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      const sessionId = `session:perf:${String(sessionIndex).padStart(3, "0")}`;
      const observedAt = `2026-07-12T00:${String(sessionIndex % 60).padStart(2, "0")}:00.000Z`;
      insertSession.run(sessionId, sessionId, sessionId, observedAt, observedAt, observedAt, observedAt, observedAt);
      insertState.run(sessionId);
      for (let toolIndex = 0; toolIndex < toolsPerSession; toolIndex += 1) {
        const callId = `${sessionId}:tool:${toolIndex}`;
        insertCall.run(callId, sessionId, observedAt);
        insertResult.run(`${callId}:result`, callId, sessionId, observedAt);
      }
    }
  });
  const evidenceItemsPerSession = toolsPerSession * 2;
  return {
    evidenceItemsPerSession,
    sessionCount,
    toolsPerSession,
    totalEvidenceItems: sessionCount * evidenceItemsPerSession
  };
}

function insertEvidence(db: MastheadDatabase, sessionId: string, evidence: CorpusEvidence): void {
  const sourceRef = JSON.stringify({ fixture: "durable-artifact-corpus", id: evidence.id });
  const storageId = evidence.id.replace(new RegExp(`^${canonicalPrefix(evidence.kind)}:`), "");
  if (evidence.kind === "message") {
    db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, 'authoritative')`
    ).run(storageId, sessionId, evidence.text, `${evidence.id}:hash`, evidence.observedAt, sourceRef);
    return;
  }
  if (evidence.kind === "file_effect") {
    db.prepare(
      `INSERT INTO file_effects (
        file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(storageId, sessionId, evidence.text.replace(/^modified\s+/, ""), evidence.label ?? "modified", evidence.observedAt, sourceRef);
    return;
  }
  if (evidence.kind === "checkpoint") {
    db.prepare(
      `INSERT INTO checkpoints (
        checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(storageId, sessionId, evidence.label ?? "checkpoint", evidence.text, evidence.observedAt, sourceRef);
    return;
  }
  if (evidence.kind === "runtime_signal") {
    db.prepare(
      `INSERT INTO runtime_signals (
        signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
    ).run(
      storageId,
      sessionId,
      evidence.label ?? "signal",
      evidence.status ?? "info",
      evidence.text,
      evidence.observedAt,
      sourceRef
    );
    return;
  }
  const callId = `${storageId}:call`;
  db.prepare(
    `INSERT INTO tool_calls (
      tool_call_id, session_id, tool_name, started_at, source_ref_json
    ) VALUES (?, ?, 'exec_command', ?, ?)`
  ).run(callId, sessionId, evidence.observedAt, sourceRef);
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, exit_code, output_redacted, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    storageId,
    callId,
    sessionId,
    evidence.status ?? evidence.label ?? "succeeded",
    evidence.exitCode ?? null,
    evidence.text,
    evidence.observedAt,
    sourceRef
  );
}

function canonicalPrefix(kind: CorpusEvidence["kind"]): string {
  if (kind === "runtime_signal") return "signal";
  if (kind === "file_effect") return "file";
  return kind;
}

function focusedSessionEnrichment(
  session: DurableArtifactCorpusSession
): WorkbenchAuthoringBundleV3["sessionEnrichments"][number] {
  const evidence = session.evidence[0];
  if (!evidence) throw new Error(`focused_corpus_evidence_missing:${session.id}`);
  const evidenceRef = {
    id: evidence.id,
    kind: "event" as const,
    observedAt: evidence.observedAt,
    source: "canonical"
  };
  return {
    enrichment: {
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], openQuestions: [] },
        decisions: [],
        evidenceRefs: [evidenceRef],
        keyWork: [`Reviewed the canonical evidence for ${session.title}.`],
        outcome: `Captured the completed outcome for ${session.title}.`,
        verification: {
          commands: [],
          evidenceRefs: [evidenceRef],
          failures: [],
          status: "unknown",
          summary: "The selected canonical evidence supports this durable enrichment."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "low",
        evidenceRefs: [evidenceRef],
        state: "completed",
        text: `Agent-enriched account of ${session.title}, grounded in the selected canonical evidence.`
      },
      sessionTitle: {
        basis: "dominant_work",
        confidence: "low",
        evidenceRefs: [evidenceRef],
        text: session.title
      },
      version: "session-capsule-v4"
    },
    sessionId: session.id
  };
}

function focusedOptionalArtifact(
  kind: WorkbenchAutomaticArtifactKind,
  sessions: readonly DurableArtifactCorpusSession[]
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  if (kind === "runbook") return focusedMigrationRunbook(sessions);
  if (kind === "incident_timeline") return focusedIncidentTimeline(sessions);
  return focusedAdr(sessions);
}

function focusedMigrationRunbook(
  sessions: readonly DurableArtifactCorpusSession[]
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  const session = requireFocusedSession(sessions, databaseMigrationFailureFixedAndVerified.id);
  const failure = requireFocusedEvidence(session, "tool_result:migration:failure");
  const action = requireFocusedEvidence(session, "message:migration:action");
  const change = requireFocusedEvidence(session, "file:migration:change");
  const verified = requireFocusedEvidence(session, "tool_result:migration:verified");
  return {
    kind: "runbook",
    output: {
      changedFiles: ["migrations/041_retry.sql"],
      claimSupport: [
        durableSupport("problemSignature.symptoms[0]", failure.id, failure.text, "problem"),
        durableSupport("problemSignature.errorStrings[0]", failure.id, failure.text, "problem"),
        durableSupport("problemSignature.affectedScope", failure.id, failure.text, "problem"),
        durableSupport("preconditions[0]", failure.id, failure.text, "problem"),
        durableSupport("reproSteps[0]", failure.id, failure.text, "problem"),
        durableSupport("fixSteps[0]", action.id, action.text, "change"),
        durableSupport("commands[0]", action.id, action.text, "change"),
        durableSupport("changedFiles[0]", change.id, change.text, "change"),
        durableSupport("environmentRequirements[0]", failure.id, failure.text, "problem"),
        durableSupport("rootCause", failure.id, failure.text, "root_cause"),
        durableSupport("preventionNotes[0]", verified.id, verified.text, "remediation"),
        durableSupport("validationChecks[0]", verified.id, verified.text, "verification")
      ],
      commands: ["Apply the recorded migration repair."],
      confidence: "low",
      deadEnds: [],
      environmentRequirements: ["A restorable database snapshot is available."],
      evidenceRefs: [failure.id, action.id, change.id, verified.id],
      fixSteps: [`Apply the recorded migration change: ${change.text}.`],
      missingEvidence: [],
      preconditions: [failure.text],
      preventionNotes: [verified.text],
      problemSignature: {
        affectedScope: "Database migration 41",
        errorStrings: [failure.text],
        symptoms: [failure.text]
      },
      provenanceSessionIds: [session.id],
      reproSteps: [failure.text],
      risksOrGaps: [],
      rootCause: failure.text,
      title: "Recover migration 41 after an existing-index failure",
      validationChecks: [verified.text]
    },
    provenanceSessionIds: [session.id],
    seedSessionId: session.id
  };
}

function focusedAdr(
  sessions: readonly DurableArtifactCorpusSession[]
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  const session = sessions.find(({ id }) => id === explicitArchitectureDecision.id)
    ?? requireFocusedSession(sessions, misleadingSuggestionSession.id);
  const [decision, alternative] = session.evidence;
  if (!decision || !alternative) throw new Error(`focused_adr_evidence_missing:${session.id}`);
  return {
    kind: "adr",
    output: {
      alternatives: [alternative.text],
      claimSupport: [
        durableSupport("context", decision.id, decision.text, "problem"),
        durableSupport("decision", decision.id, decision.text, "decision"),
        durableSupport("alternatives[0]", alternative.id, alternative.text, "alternative"),
        durableSupport("consequences[0]", decision.id, decision.text, "decision"),
        durableSupport("status", decision.id, decision.text, "decision")
      ],
      confidence: "low",
      consequences: ["Offline operation remains available without a hosted dependency."],
      context: "The selected evidence records a durable storage direction and its operational tradeoff.",
      decision: decision.text,
      evidenceRefs: [decision.id, alternative.id],
      missingEvidence: [],
      provenanceSessionIds: [session.id],
      status: "accepted",
      title: session.id === misleadingSuggestionSession.id
        ? "Keep the authorization cache process-local"
        : "Keep the canonical session store local-first"
    },
    provenanceSessionIds: [session.id],
    seedSessionId: session.id
  };
}

function focusedIncidentTimeline(
  sessions: readonly DurableArtifactCorpusSession[]
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  const session = requireFocusedSession(sessions, productionIncidentWithRootCause.id);
  const [detected, triage, mitigated, restored] = session.evidence;
  if (!detected || !triage || !mitigated || !restored) {
    throw new Error(`focused_incident_evidence_missing:${session.id}`);
  }
  return {
    kind: "incident_timeline",
    output: {
      claimSupport: [
        durableSupport("symptom", detected.id, detected.text, "problem"),
        durableSupport("impact", detected.id, detected.text, "problem"),
        durableSupport("timeline[0].summary", detected.id, detected.text, "timeline"),
        durableSupport("timeline[1].summary", triage.id, triage.text, "timeline"),
        durableSupport("timeline[2].summary", mitigated.id, mitigated.text, "timeline"),
        durableSupport("timeline[3].summary", restored.id, restored.text, "timeline"),
        durableSupport("rootCause", triage.id, triage.text, "root_cause"),
        durableSupport("contributingFactors[0]", triage.id, triage.text, "problem"),
        durableSupport("remediation[0]", mitigated.id, mitigated.text, "remediation"),
        durableSupport("prevention[0]", restored.id, restored.text, "remediation"),
        durableSupport("status", restored.id, restored.text, "verification")
      ],
      confidence: "low",
      contributingFactors: [triage.text],
      evidenceRefs: session.evidence.map(({ id }) => id),
      impact: detected.text,
      missingEvidence: [],
      prevention: [restored.text],
      provenanceSessionIds: [session.id],
      remediation: [mitigated.text],
      rootCause: triage.text,
      status: "resolved",
      symptom: detected.text,
      timeline: session.evidence.map((item) => ({
        at: item.observedAt,
        evidenceRefs: [item.id],
        summary: item.text
      })),
      title: "Restore ingestion after SQLite writer lease exhaustion"
    },
    provenanceSessionIds: [session.id],
    seedSessionId: session.id
  };
}

function requireFocusedSession(
  sessions: readonly DurableArtifactCorpusSession[],
  sessionId: string
): DurableArtifactCorpusSession {
  const session = sessions.find(({ id }) => id === sessionId);
  if (!session) throw new Error(`focused_corpus_session_missing:${sessionId}`);
  return session;
}

function requireFocusedEvidence(session: DurableArtifactCorpusSession, evidenceId: string): CorpusEvidence {
  const evidence = session.evidence.find(({ id }) => id === evidenceId);
  if (!evidence) throw new Error(`focused_corpus_evidence_missing:${evidenceId}`);
  return evidence;
}

function durableArtifactFixtureDraft(
  candidate: WorkbenchArtifactCandidate
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  const output = candidate.kind === "runbook"
    ? durableRunbookOutput(candidate)
    : candidate.kind === "adr"
      ? durableAdrOutput(candidate)
      : durableIncidentOutput(candidate);
  return {
    kind: candidate.kind,
    output,
    provenanceSessionIds: candidate.provenanceSessionIds,
    seedSessionId: candidate.seedSessionId
  };
}

export function buildDurableArtifactFixtureBundleV3(
  run: { runId: string; evidenceRevision: string },
  candidate: WorkbenchArtifactCandidate
): WorkbenchAuthoringBundleV3 {
  return {
    artifacts: [durableArtifactFixtureDraft(candidate)],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision: run.evidenceRevision,
    runId: run.runId,
    sessionEnrichments: candidate.provenanceSessionIds.map((sessionId) => {
      const session = durableArtifactCorpus.find(({ id }) => id === sessionId);
      if (!session) throw new Error(`durable_corpus_session_missing:${sessionId}`);
      return focusedSessionEnrichment(session);
    })
  };
}

function durableRunbookOutput(candidate: WorkbenchArtifactCandidate): Record<string, unknown> {
  const problemRef = "tool_result:oauth:failure";
  const problem = "OAuth callback test failed with an invalid state nonce.";
  const changeRef = "file:oauth:change";
  const change = "modified auth/callback.ts";
  const actionRef = "message:oauth:action";
  const action = "Implemented callback nonce validation and ran the OAuth callback regression test.";
  const verificationRef = "checkpoint:oauth:verified";
  const verification = "Callback regression test passed after the nonce repair.";
  return {
    changedFiles: ["auth/callback.ts"],
    claimSupport: [
      durableSupport("problemSignature.symptoms[0]", problemRef, problem, "problem"),
      durableSupport("problemSignature.errorStrings[0]", problemRef, problem, "problem"),
      durableSupport("problemSignature.affectedScope", problemRef, problem, "problem"),
      durableSupport("preconditions[0]", problemRef, problem, "problem"),
      durableSupport("reproSteps[0]", problemRef, problem, "problem"),
      durableSupport("fixSteps[0]", actionRef, action, "change"),
      durableSupport("commands[0]", actionRef, action, "change"),
      durableSupport("changedFiles[0]", changeRef, change, "change"),
      durableSupport("environmentRequirements[0]", problemRef, problem, "problem"),
      durableSupport("preventionNotes[0]", verificationRef, verification, "remediation"),
      durableSupport("validationChecks[0]", verificationRef, verification, "verification")
    ],
    commands: ["Run the OAuth callback regression test."],
    confidence: "low",
    deadEnds: [],
    environmentRequirements: ["OAuth callback test environment"],
    evidenceRefs: [problemRef, actionRef, changeRef, verificationRef],
    fixSteps: [`Apply the recorded callback change: ${change}.`],
    missingEvidence: [],
    preconditions: ["The callback regression reproduces an invalid state nonce."],
    preventionNotes: ["Keep the callback regression in the verification suite."],
    problemSignature: {
      affectedScope: "OAuth callback state validation",
      errorStrings: ["invalid state nonce"],
      symptoms: [problem]
    },
    provenanceSessionIds: candidate.provenanceSessionIds,
    reproSteps: ["Run the OAuth callback regression test and observe the invalid state nonce."],
    risksOrGaps: [],
    rootCause: "The root cause remains unknown from the available evidence.",
    title: "Repair OAuth callback state nonce validation",
    validationChecks: [verification]
  };
}

function durableAdrOutput(candidate: WorkbenchArtifactCandidate): Record<string, unknown> {
  const decisionRef = "message:decision-local-first:decision";
  const decision = "Decision: adopt SQLite as the canonical local-first session store.";
  const alternativeRef = "message:decision-local-first:alternative";
  const alternative = "Rejected alternative: a hosted database would break offline operation.";
  return {
    alternatives: [alternative],
    claimSupport: [
      durableSupport("context", decisionRef, decision, "problem"),
      durableSupport("decision", decisionRef, decision, "decision"),
      durableSupport("status", decisionRef, decision, "decision"),
      durableSupport("alternatives[0]", alternativeRef, alternative, "alternative"),
      durableSupport("consequences[0]", decisionRef, decision, "decision")
    ],
    confidence: "low",
    consequences: ["The session store remains local and supports offline operation."],
    context: "The storage choice must preserve local operation without a hosted dependency.",
    decision,
    evidenceRefs: [decisionRef, alternativeRef],
    missingEvidence: [],
    provenanceSessionIds: candidate.provenanceSessionIds,
    status: "accepted",
    title: "Keep the canonical session store local-first"
  };
}

function durableIncidentOutput(candidate: WorkbenchArtifactCandidate): Record<string, unknown> {
  const detectedRef = "signal:incident-root-cause:detected";
  const detected = "Ingestion requests failed across production.";
  const triageRef = "signal:incident-root-cause:triage";
  const triage = "Triage isolated exhausted SQLite writer leases.";
  const mitigatedRef = "signal:incident-root-cause:mitigated";
  const mitigated = "The stuck writer was recycled and backlog processing resumed.";
  const restoredRef = "checkpoint:incident-root-cause:restored";
  const restored = "Service health and backlog drain were verified.";
  return {
    claimSupport: [
      durableSupport("symptom", detectedRef, detected, "problem"),
      durableSupport("impact", detectedRef, detected, "problem"),
      durableSupport("timeline[0].summary", detectedRef, detected, "timeline"),
      durableSupport("timeline[1].summary", triageRef, triage, "timeline"),
      durableSupport("timeline[2].summary", mitigatedRef, mitigated, "timeline"),
      durableSupport("timeline[3].summary", restoredRef, restored, "timeline"),
      durableSupport("rootCause", triageRef, triage, "root_cause"),
      durableSupport("contributingFactors[0]", triageRef, triage, "problem"),
      durableSupport("remediation[0]", mitigatedRef, mitigated, "remediation"),
      durableSupport("prevention[0]", restoredRef, restored, "remediation"),
      durableSupport("status", restoredRef, restored, "verification")
    ],
    confidence: "low",
    contributingFactors: [triage],
    evidenceRefs: [detectedRef, triageRef, mitigatedRef, restoredRef],
    impact: detected,
    missingEvidence: [],
    prevention: ["Monitor writer lease exhaustion and backlog health."],
    provenanceSessionIds: candidate.provenanceSessionIds,
    remediation: [mitigated],
    rootCause: triage,
    status: "resolved",
    symptom: detected,
    timeline: [
      { at: "2026-07-01T12:00:00.000Z", evidenceRefs: [detectedRef], summary: detected },
      { at: "2026-07-01T12:01:00.000Z", evidenceRefs: [triageRef], summary: triage },
      { at: "2026-07-01T12:02:00.000Z", evidenceRefs: [mitigatedRef], summary: mitigated },
      { at: "2026-07-01T12:03:00.000Z", evidenceRefs: [restoredRef], summary: restored }
    ],
    title: "Restore ingestion after SQLite writer lease exhaustion"
  };
}

function durableSupport(
  path: string,
  evidenceRef: string,
  excerpt: string,
  supportKind: WorkbenchClaimSupport["supportKind"]
): WorkbenchClaimSupport {
  return { path, evidenceRef, excerpt, supportKind };
}
