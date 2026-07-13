import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringContractVersion,
  WorkbenchAuthoringFinding,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringRunDto,
  WorkbenchAuthoringRunStatus,
  WorkbenchStoredAuthoringBundle
} from "../../shared/workbenchAuthoring.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type WorkbenchAuthoringRunRow = {
  runId: string;
  actorId: string;
  databaseId: string;
  status: WorkbenchAuthoringRunStatus;
  evidenceRevision: string;
  contractVersion: WorkbenchAuthoringContractVersion;
  candidateId: string | null;
  bundleJson: string | null;
  findingsJson: string;
  receiptJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type WorkbenchAuthoringRunSessionRow = {
  sessionId: string;
  claimId: string;
  expiresAt: string;
  releasedAt: string | null;
  conflicting: number;
};

export function createWorkbenchAuthoringRun(
  db: MastheadDatabase,
  input: {
    actorId: string;
    databaseId: string;
    evidenceRevision: string;
    contractVersion?: WorkbenchAuthoringContractVersion;
    candidateId?: string;
    runId: string;
    sessions: Array<{ claimId: string; ordinal: number; sessionId: string }>;
  }
): WorkbenchAuthoringRunDto {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const run = createWorkbenchAuthoringRunInTransaction(db, input);
    db.exec("COMMIT;");
    return run;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function createWorkbenchAuthoringRunInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    databaseId: string;
    evidenceRevision: string;
    contractVersion?: WorkbenchAuthoringContractVersion;
    candidateId?: string;
    runId: string;
    sessions: Array<{ claimId: string; ordinal: number; sessionId: string }>;
  }
): WorkbenchAuthoringRunDto {
  if (input.sessions.length === 0) throw new Error("authoring_run_requires_sessions");
  const contractVersion = input.contractVersion ?? "workbench-authoring-v1";
  const candidateId = input.candidateId?.trim() || undefined;
  if (contractVersion === "workbench-authoring-v2" && !candidateId) {
    throw new Error("authoring_v2_candidate_required");
  }
  if (contractVersion === "workbench-authoring-v1" && candidateId) {
    throw new Error("authoring_v1_candidate_not_supported");
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workbench_authoring_runs (
      run_id, actor_id, database_id, status, evidence_revision,
      contract_version, candidate_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.actorId,
    input.databaseId,
    input.evidenceRevision,
    contractVersion,
    candidateId ?? null,
    now,
    now
  );
  const insertSession = db.prepare(
    `INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal)
     VALUES (?, ?, ?, ?)`
  );
  for (const session of input.sessions) {
    insertSession.run(input.runId, session.sessionId, session.claimId, session.ordinal);
  }
  return getWorkbenchAuthoringRun(db, input.runId)!;
}

export function getWorkbenchAuthoringRun(db: MastheadDatabase, runId: string): WorkbenchAuthoringRunDto | undefined {
  const row = db
    .prepare(
      `SELECT
        run_id AS runId,
        actor_id AS actorId,
        database_id AS databaseId,
        status,
        evidence_revision AS evidenceRevision,
        contract_version AS contractVersion,
        candidate_id AS candidateId,
        bundle_json AS bundleJson,
        findings_json AS findingsJson,
        receipt_json AS receiptJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        completed_at AS completedAt
       FROM workbench_authoring_runs
       WHERE run_id = ?`
    )
    .get(runId) as WorkbenchAuthoringRunRow | undefined;
  if (!row) return undefined;

  const now = new Date().toISOString();
  const sessions = db
    .prepare(
      `SELECT
        run_sessions.session_id AS sessionId,
        run_sessions.claim_id AS claimId,
        claims.expires_at AS expiresAt,
        claims.released_at AS releasedAt,
        EXISTS (
          SELECT 1
          FROM workbench_claims AS active_claims
          WHERE active_claims.session_id = run_sessions.session_id
            AND active_claims.claim_id <> run_sessions.claim_id
            AND active_claims.released_at IS NULL
            AND active_claims.expires_at > ?
        ) AS conflicting
       FROM workbench_authoring_run_sessions AS run_sessions
       JOIN workbench_claims AS claims ON claims.claim_id = run_sessions.claim_id
       WHERE run_sessions.run_id = ?
       ORDER BY run_sessions.ordinal ASC, run_sessions.session_id ASC`
    )
    .all(now, runId) as WorkbenchAuthoringRunSessionRow[];

  const dto: WorkbenchAuthoringRunDto = {
    actorId: row.actorId,
    claimIds: sessions.map((session) => session.claimId),
    claimsExpireAt: sessions.map((session) => session.expiresAt).sort()[0]!,
    claimStatus: claimStatus(sessions, now),
    createdAt: row.createdAt,
    databaseId: row.databaseId,
    contractVersion: row.contractVersion,
    evidenceRevision: row.evidenceRevision,
    findings: parseJson<WorkbenchAuthoringFinding[]>(row.findingsJson),
    runId: row.runId,
    sessionIds: sessions.map((session) => session.sessionId),
    status: row.status,
    updatedAt: row.updatedAt
  };
  if (row.candidateId) dto.candidateId = row.candidateId;
  if (row.bundleJson) dto.bundle = parseJson<WorkbenchStoredAuthoringBundle>(row.bundleJson);
  if (row.receiptJson) dto.receipt = parseJson<WorkbenchAuthoringReceipt>(row.receiptJson);
  if (row.completedAt) dto.completedAt = row.completedAt;
  return dto;
}

export function findReusableWorkbenchAuthoringRun(
  db: MastheadDatabase,
  input: {
    actorId: string;
    candidateId?: string;
    contractVersion?: WorkbenchAuthoringContractVersion;
    databaseId: string;
    sessionIds: string[];
  }
): WorkbenchAuthoringRunDto | undefined {
  const expectedSessionSet = normalizeSessionSet(input.sessionIds);
  const contractVersion = input.contractVersion ?? "workbench-authoring-v1";
  const candidateId = input.candidateId?.trim() || null;
  const candidates = db
    .prepare(
      `SELECT run_id AS runId
       FROM workbench_authoring_runs
       WHERE actor_id = ?
         AND database_id = ?
         AND contract_version = ?
         AND candidate_id IS ?
       ORDER BY updated_at DESC, run_id DESC`
    )
    .all(input.actorId, input.databaseId, contractVersion, candidateId) as Array<{ runId: string }>;
  for (const candidate of candidates) {
    const run = getWorkbenchAuthoringRun(db, candidate.runId)!;
    if (sessionSetsEqual(normalizeSessionSet(run.sessionIds), expectedSessionSet)) return run;
  }
  return undefined;
}

export function resetWorkbenchAuthoringRunEvidence(
  db: MastheadDatabase,
  input: { evidenceRevision: string; runId: string; updatedAt: string }
): WorkbenchAuthoringRunDto {
  const existing = getWorkbenchAuthoringRun(db, input.runId);
  if (!existing) throw new Error(`authoring_run_not_found:${input.runId}`);
  if (existing.status === "completed") return existing;
  db.prepare(
    `UPDATE workbench_authoring_runs
     SET status = 'open',
       evidence_revision = ?,
       bundle_json = NULL,
       findings_json = '[]',
       updated_at = ?
     WHERE run_id = ?`
  ).run(input.evidenceRevision, input.updatedAt, input.runId);
  return getWorkbenchAuthoringRun(db, input.runId)!;
}

export function saveWorkbenchAuthoringSubmission(
  db: MastheadDatabase,
  input: {
    bundle: WorkbenchAuthoringBundle | WorkbenchAuthoringBundleV2;
    evidenceRevision: string;
    findings: WorkbenchAuthoringFinding[];
    runId: string;
    status: "needs_revision" | "ready_to_finish";
  }
): WorkbenchAuthoringRunDto {
  const existing = getWorkbenchAuthoringRun(db, input.runId);
  if (!existing) throw new Error(`authoring_run_not_found:${input.runId}`);
  if (existing.status === "completed") return existing;
  if (input.bundle.bundleVersion !== existing.contractVersion) {
    throw new Error("unsupported_authoring_bundle_version");
  }
  if (
    input.bundle.bundleVersion === "workbench-authoring-v2" &&
    input.bundle.candidateId !== existing.candidateId
  ) {
    throw new Error("authoring_candidate_mismatch");
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE workbench_authoring_runs
     SET status = ?, evidence_revision = ?, bundle_json = ?, findings_json = ?, updated_at = ?
     WHERE run_id = ?`
  ).run(
    input.status,
    input.evidenceRevision,
    JSON.stringify(input.bundle),
    JSON.stringify(input.findings),
    updatedAt,
    input.runId
  );
  return getWorkbenchAuthoringRun(db, input.runId)!;
}

export function completeWorkbenchAuthoringRun(
  db: MastheadDatabase,
  input: { runId: string; receipt: WorkbenchAuthoringReceipt }
): WorkbenchAuthoringReceipt {
  const existing = getWorkbenchAuthoringRun(db, input.runId);
  if (!existing) throw new Error(`authoring_run_not_found:${input.runId}`);
  if (existing.receipt) return existing.receipt;

  db.prepare(
    `UPDATE workbench_authoring_runs
     SET status = 'completed', receipt_json = ?, completed_at = ?, updated_at = ?
     WHERE run_id = ?`
  ).run(JSON.stringify(input.receipt), input.receipt.completedAt, input.receipt.completedAt, input.runId);
  return getWorkbenchAuthoringRun(db, input.runId)!.receipt!;
}

function claimStatus(
  sessions: WorkbenchAuthoringRunSessionRow[],
  now: string
): WorkbenchAuthoringRunDto["claimStatus"] {
  if (sessions.some((session) => Boolean(session.conflicting))) return "conflicted";
  if (sessions.some((session) => session.releasedAt !== null)) return "released";
  if (sessions.some((session) => session.expiresAt <= now)) return "expired";
  return "active";
}

function normalizeSessionSet(sessionIds: string[]): string[] {
  return [...new Set(sessionIds)].sort();
}

function sessionSetsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((sessionId, index) => sessionId === right[index]);
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}
