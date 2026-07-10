import { randomUUID } from "node:crypto";
import type { SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringEvidenceManifest,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringFinding,
  WorkbenchAuthoringRunDto
} from "../../shared/workbenchAuthoring.ts";
import type { SessionArtifactRecord } from "../../daemon/db/sessionArtifactRepository.ts";
import { listSessionArtifacts } from "../../daemon/db/sessionArtifactRepository.ts";
import { iterateSessionTranscriptItems, type SessionTranscriptKindFilter } from "../../daemon/db/sessionTranscriptRepository.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";
import {
  createWorkbenchAuthoringRunInTransaction,
  findReusableWorkbenchAuthoringRun,
  getWorkbenchAuthoringRun,
  resetWorkbenchAuthoringRunEvidence,
  saveWorkbenchAuthoringSubmission
} from "../../daemon/db/workbenchAuthoringRepository.ts";
import {
  claimWorkbenchSessionsInTransaction,
  ensureWorkbenchSessionState,
  markWorkbenchQualityPassedInTransaction,
  markWorkbenchTranscriptAvailableInTransaction,
  recordWorkbenchActivity,
  renewOrReacquireAuthoringClaimsInTransaction
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck } from "../qualityPrecheck.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";
import { getAuthoringBundleSchema } from "./authoringSchemas.ts";
import {
  authoringEvidenceRevision,
  getAuthoringEvidenceManifest,
  getAuthoringEvidencePage
} from "./evidenceCatalog.ts";
import { validateAuthoringBundle } from "./authoringValidation.ts";

const AUTHORING_LEASE_MS = 60 * 60_000;

export type OpenAuthoringRunResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidence: WorkbenchAuthoringEvidenceManifest;
  bundleSchema: Record<string, unknown>;
  contract: {
    contractVersion: "workbench-authoring-v1";
    sessionPackageRequired: true;
    automaticKinds: ["runbook", "adr", "incident_timeline"];
    completion: "publish_and_resolve";
    evidencePolicy: "all_canonical_redacted_evidence";
  };
  currentArtifacts: SessionArtifactRecord[];
};

export type WorkbenchAuthoringRunStatusResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidenceStatus: "current" | "changed";
};

export type GetAuthoringRunEvidenceInput = {
  runId: string;
  sessionId: string;
  cursor?: string;
  limit?: number;
  kind?: SessionTranscriptKindFilter;
  query?: string;
  order?: SessionTranscriptOrder;
};

export type SubmitAuthoringBundleResult = {
  ok: true;
  accepted: boolean;
  findings: WorkbenchAuthoringFinding[];
  run: WorkbenchAuthoringRunDto;
};

export function openAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAuthoringRunResult {
  return immediateTransaction(db, () => {
    const sessionIds = normalizeSessionIds(input.sessionIds);
    if (sessionIds.length === 0) throw new Error("authoring_run_requires_sessions");
    for (const sessionId of sessionIds) assertSessionExists(db, sessionId);

    const databaseId = getOrCreateDatabaseIdentity(db);
    if (input.databaseId !== databaseId) throw new Error("database_identity_mismatch");

    const evidence = authoringEvidenceManifestWithWarnings(db, sessionIds);
    const reusable = findReusableWorkbenchAuthoringRun(db, {
      actorId: input.actorId,
      databaseId,
      sessionIds
    });
    if (reusable?.status === "completed") {
      return openResult(db, reusable, evidence);
    }
    assertCanonicalEvidence(db, evidence);
    if (reusable?.evidenceRevision === evidence.evidenceRevision) return openResult(db, reusable, evidence);
    if (reusable) {
      resetWorkbenchAuthoringRunEvidence(db, {
        evidenceRevision: evidence.evidenceRevision,
        runId: reusable.runId,
        updatedAt: new Date().toISOString()
      });
      const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
        actorId: input.actorId,
        expiresAt: authoringLeaseExpiry(),
        runId: reusable.runId
      });
      return openResult(db, run, evidence);
    }

    assertSessionsUnclaimed(db, sessionIds);
    const actor = { id: input.actorId, kind: "agent" } as const;
    for (const sessionId of sessionIds) {
      ensureWorkbenchSessionState(db, sessionId);
      markWorkbenchTranscriptAvailableInTransaction(db, { actor, sessionId });
      markWorkbenchQualityPassedInTransaction(db, { actor, sessionId });
    }

    const claims = claimWorkbenchSessionsInTransaction(db, {
      claimedBy: input.actorId,
      expiresAt: authoringLeaseExpiry(),
      sessionIds
    }).claims;
    const runId = `authoring:${randomUUID()}`;
    const run = createWorkbenchAuthoringRunInTransaction(db, {
      actorId: input.actorId,
      databaseId,
      evidenceRevision: evidence.evidenceRevision,
      runId,
      sessions: claims.map((claim, ordinal) => ({
        claimId: claim.claimId,
        ordinal,
        sessionId: claim.sessionId
      }))
    });
    for (const claim of claims) {
      recordWorkbenchActivity(db, {
        actor,
        details: { evidenceRevision: evidence.evidenceRevision },
        eventType: "authoring_opened",
        relatedClaimId: claim.claimId,
        relatedRunId: runId,
        sessionId: claim.sessionId,
        summary: "Workbench authoring opened"
      });
    }
    return openResult(db, run, evidence);
  });
}

export function getAuthoringRunStatus(db: MastheadDatabase, runId: string): WorkbenchAuthoringRunStatusResult {
  const run = requireAuthoringRun(db, runId);
  return {
    evidenceStatus: authoringEvidenceRevision(db, run.sessionIds) === run.evidenceRevision ? "current" : "changed",
    ok: true,
    run
  };
}

export function getAuthoringRunEvidence(
  db: MastheadDatabase,
  input: GetAuthoringRunEvidenceInput
): WorkbenchAuthoringEvidencePage {
  const run = requireAuthoringRun(db, input.runId);
  if (!run.sessionIds.includes(input.sessionId)) {
    throw new Error(`authoring_session_not_in_run:${input.sessionId}`);
  }
  const currentRevision = authoringEvidenceRevision(db, run.sessionIds);
  if (currentRevision !== run.evidenceRevision) throw new Error("evidence_revision_changed");
  return {
    ...getAuthoringEvidencePage(db, input),
    evidenceRevision: currentRevision
  };
}

export function submitAuthoringBundle(
  db: MastheadDatabase,
  input: { bundle: WorkbenchAuthoringBundle; runId: string }
): SubmitAuthoringBundleResult {
  return immediateTransaction(db, () => {
    const existing = requireAuthoringRun(db, input.runId);
    if (existing.status === "completed") throw new Error(`authoring_run_completed:${input.runId}`);
    if (input.bundle.runId !== input.runId) throw new Error("authoring_run_mismatch");

    const renewed = renewOrReacquireAuthoringClaimsInTransaction(db, {
      actorId: existing.actorId,
      expiresAt: authoringLeaseExpiry(),
      runId: input.runId
    });
    const currentEvidenceRevision = authoringEvidenceRevision(db, renewed.sessionIds);
    if (currentEvidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_changed");
    if (input.bundle.evidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_mismatch");

    const validation = validateAuthoringBundle({
      bundle: input.bundle,
      coverageWarningsBySession: coverageWarningsBySession(db, renewed.sessionIds),
      evidenceByRef: evidenceByRef(db, renewed.sessionIds),
      publishedArtifacts: currentArtifacts(db, renewed.sessionIds),
      selectedSessionIds: renewed.sessionIds
    });
    const run = saveWorkbenchAuthoringSubmission(db, {
      bundle: input.bundle,
      evidenceRevision: currentEvidenceRevision,
      findings: validation.findings,
      runId: input.runId,
      status: validation.ok ? "ready_to_finish" : "needs_revision"
    });
    return {
      accepted: validation.ok,
      findings: validation.findings,
      ok: true,
      run
    };
  });
}

function openResult(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto,
  evidence: WorkbenchAuthoringEvidenceManifest
): OpenAuthoringRunResult {
  return {
    bundleSchema: getAuthoringBundleSchema(),
    contract: {
      automaticKinds: ["runbook", "adr", "incident_timeline"],
      completion: "publish_and_resolve",
      contractVersion: "workbench-authoring-v1",
      evidencePolicy: "all_canonical_redacted_evidence",
      sessionPackageRequired: true
    },
    currentArtifacts: currentArtifacts(db, run.sessionIds),
    evidence,
    ok: true,
    run
  };
}

function immediateTransaction<T>(db: MastheadDatabase, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function requireAuthoringRun(db: MastheadDatabase, runId: string): WorkbenchAuthoringRunDto {
  const run = getWorkbenchAuthoringRun(db, runId);
  if (!run) throw new Error(`authoring_run_not_found:${runId}`);
  return run;
}

function normalizeSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))].sort();
}

function assertSessionExists(db: MastheadDatabase, sessionId: string): void {
  const row = db
    .prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND deleted_at IS NULL")
    .get(sessionId) as { found: number } | undefined;
  if (!row) throw new Error(`session_not_found:${sessionId}`);
}

function assertCanonicalEvidence(db: MastheadDatabase, evidence: WorkbenchAuthoringEvidenceManifest): void {
  for (const session of evidence.sessions) {
    const hasUsableText = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId: session.sessionId })].some(
      (item) => item.text.trim().length > 0 && !item.lowValue
    );
    if (session.totalItems === 0 || !hasUsableText) {
      throw new Error(`missing_canonical_evidence:${session.sessionId}`);
    }
  }
}

function assertSessionsUnclaimed(db: MastheadDatabase, sessionIds: string[]): void {
  const now = new Date().toISOString();
  for (const sessionId of sessionIds) {
    const active = db
      .prepare(
        `SELECT 1 AS active
         FROM workbench_claims
         WHERE session_id = ? AND released_at IS NULL AND expires_at > ?
         LIMIT 1`
      )
      .get(sessionId, now) as { active: number } | undefined;
    if (active) throw new Error(`authoring_claim_conflict:${sessionId}`);
  }
}

function authoringLeaseExpiry(): string {
  return new Date(Date.now() + AUTHORING_LEASE_MS).toISOString();
}

function authoringEvidenceManifestWithWarnings(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchAuthoringEvidenceManifest {
  const manifest = getAuthoringEvidenceManifest(db, sessionIds);
  const warnings = coverageWarningsBySession(db, sessionIds);
  return {
    ...manifest,
    sessions: manifest.sessions.map((session) => ({
      ...session,
      warnings: warnings.get(session.sessionId) ?? []
    }))
  };
}

function coverageWarningsBySession(db: MastheadDatabase, sessionIds: string[]): Map<string, string[]> {
  return new Map(
    sessionIds.map((sessionId) => {
      const summary = getAuthoringEvidenceManifest(db, [sessionId]).sessions[0]!;
      const warnings: string[] = [];
      const precheck = runCaptureQualityPrecheck(db, sessionId);
      if (!precheck.ok) warnings.push(`Capture quality precheck reported ${precheck.reason}.`);
      if (summary.coverage.messages < 2) warnings.push("Fewer than two canonical messages are available.");
      if (summary.coverage.userMessages === 0) warnings.push("No user-authored message is available.");
      if (summary.coverage.assistantMessages === 0) warnings.push("No assistant-authored message is available.");
      return [sessionId, warnings] as const;
    })
  );
}

function evidenceByRef(db: MastheadDatabase, sessionIds: string[]): Map<string, WorkbenchValidationEvidence> {
  const evidence = new Map<string, WorkbenchValidationEvidence>();
  for (const sessionId of sessionIds) {
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      evidence.set(item.itemId, {
        exitCode: item.exitCode,
        kind: item.kind,
        sessionId,
        status: item.status
      });
    }
  }
  return evidence;
}

function currentArtifacts(db: MastheadDatabase, sessionIds: string[]): SessionArtifactRecord[] {
  const artifacts = new Map<string, SessionArtifactRecord>();
  for (const sessionId of sessionIds) {
    for (const artifact of listSessionArtifacts(db, { sessionId })) {
      if (artifact.status === "current") artifacts.set(artifact.artifactId, artifact);
    }
  }
  return [...artifacts.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}
