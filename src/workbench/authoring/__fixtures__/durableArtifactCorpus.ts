import { withImmediateTransaction, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import type {
  WorkbenchAuthoringBundleV2,
  WorkbenchClaimSupport
} from "../../../shared/workbenchAuthoring.ts";
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

export function corpusSessionIds(): string[] {
  return durableArtifactCorpus.map((session) => session.id);
}

export function seedDurableArtifactCorpus(db: MastheadDatabase): void {
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
    "INSERT INTO workbench_session_state (session_id, publication_status) VALUES (?, 'publish_path')"
  );

  for (const session of durableArtifactCorpus) {
    const lastAt = session.evidence.at(-1)?.observedAt ?? fixedAt;
    insertSession.run(session.id, session.id, session.title, fixedAt, lastAt, lastAt, fixedAt, lastAt);
    insertState.run(session.id);
    for (const evidence of session.evidence) insertEvidence(db, session.id, evidence);
  }
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

export function buildDurableArtifactFixtureBundle(
  run: { runId: string; evidenceRevision: string },
  candidate: WorkbenchArtifactCandidate
): WorkbenchAuthoringBundleV2 {
  const output = candidate.kind === "runbook"
    ? durableRunbookOutput(candidate)
    : candidate.kind === "adr"
      ? durableAdrOutput(candidate)
      : durableIncidentOutput(candidate);
  return {
    artifact: {
      kind: candidate.kind,
      output,
      provenanceSessionIds: candidate.provenanceSessionIds,
      seedSessionId: candidate.seedSessionId
    },
    bundleVersion: "workbench-authoring-v2",
    candidateId: candidate.candidateId,
    evidenceRevision: run.evidenceRevision,
    runId: run.runId
  };
}

function durableRunbookOutput(candidate: WorkbenchArtifactCandidate): Record<string, unknown> {
  const problemRef = "tool_result:oauth:failure";
  const problem = "OAuth callback test failed with an invalid state nonce.";
  const changeRef = "file:oauth:change";
  const change = "modified auth/callback.ts";
  const verificationRef = "checkpoint:oauth:verified";
  const verification = "Callback regression test passed after the nonce repair.";
  return {
    changedFiles: ["auth/callback.ts"],
    claimSupport: [
      durableSupport("problemSignature.symptoms[0]", problemRef, problem, "problem"),
      durableSupport("fixSteps[0]", changeRef, change, "change"),
      durableSupport("validationChecks[0]", verificationRef, verification, "verification")
    ],
    commands: ["Run the OAuth callback regression test."],
    confidence: "low",
    deadEnds: [],
    environmentRequirements: ["OAuth callback test environment"],
    evidenceRefs: [problemRef, changeRef, verificationRef],
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
      durableSupport("decision", decisionRef, decision, "decision"),
      durableSupport("alternatives[0]", alternativeRef, alternative, "alternative")
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
      durableSupport("timeline[0].summary", detectedRef, detected, "timeline"),
      durableSupport("timeline[1].summary", triageRef, triage, "timeline"),
      durableSupport("timeline[2].summary", mitigatedRef, mitigated, "timeline"),
      durableSupport("timeline[3].summary", restoredRef, restored, "timeline"),
      durableSupport("rootCause", triageRef, triage, "root_cause"),
      durableSupport("remediation[0]", mitigatedRef, mitigated, "remediation")
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
