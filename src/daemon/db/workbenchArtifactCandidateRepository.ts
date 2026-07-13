import type { WorkbenchAutomaticKind } from "./workbenchPipelineRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type WorkbenchArtifactCandidateStatus =
  | "pending"
  | "claimed"
  | "published"
  | "dismissed"
  | "superseded";

export type StoredWorkbenchArtifactCandidate = {
  candidateId: string;
  kind: WorkbenchAutomaticKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  signalEvidenceRefs: string[];
  signalSummary: string;
  signatureKey?: string;
  evidenceRevision: string;
  supersedesCandidateId?: string;
  status: WorkbenchArtifactCandidateStatus;
  dismissalReason?: string;
  dismissalEvidenceRefs?: string[];
  createdAt: string;
  updatedAt: string;
};

type CandidateRow = {
  candidateId: string;
  kind: WorkbenchAutomaticKind;
  seedSessionId: string;
  provenanceSessionIdsJson: string;
  signalEvidenceRefsJson: string;
  signalSummary: string;
  signatureKey: string | null;
  evidenceRevision: string;
  supersedesCandidateId: string | null;
  status: WorkbenchArtifactCandidateStatus;
  dismissalReason: string | null;
  dismissalEvidenceRefsJson: string | null;
  createdAt: string;
  updatedAt: string;
};

const CANDIDATE_SELECT = `SELECT
  candidate_id AS candidateId,
  kind,
  seed_session_id AS seedSessionId,
  provenance_session_ids_json AS provenanceSessionIdsJson,
  signal_evidence_refs_json AS signalEvidenceRefsJson,
  signal_summary AS signalSummary,
  signature_key AS signatureKey,
  evidence_revision AS evidenceRevision,
  supersedes_candidate_id AS supersedesCandidateId,
  status,
  dismissal_reason AS dismissalReason,
  dismissal_evidence_refs_json AS dismissalEvidenceRefsJson,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM workbench_artifact_candidates`;

export function saveWorkbenchArtifactCandidate(
  db: MastheadDatabase,
  input: Omit<StoredWorkbenchArtifactCandidate, "createdAt" | "status" | "updatedAt"> & {
    status?: WorkbenchArtifactCandidateStatus;
  }
): StoredWorkbenchArtifactCandidate {
  const provenanceSessionIds = normalizedStrings(input.provenanceSessionIds);
  const signalEvidenceRefs = normalizedStrings(input.signalEvidenceRefs);
  if (provenanceSessionIds.length < 1 || provenanceSessionIds.length > 12) {
    throw new Error("candidate_provenance_count_invalid");
  }
  if (!provenanceSessionIds.includes(input.seedSessionId)) {
    throw new Error("candidate_seed_not_in_provenance");
  }
  if (signalEvidenceRefs.length === 0) throw new Error("candidate_positive_evidence_required");
  for (const sessionId of provenanceSessionIds) {
    if (!db.prepare("SELECT 1 FROM sessions WHERE session_id = ? AND deleted_at IS NULL").get(sessionId)) {
      throw new Error(`candidate_provenance_session_not_found:${sessionId}`);
    }
  }

  const sameRevision = getWorkbenchArtifactCandidate(db, input.candidateId);
  if (sameRevision) return sameRevision;

  const existing = findCurrentCandidate(db, {
    kind: input.kind,
    seedSessionId: input.seedSessionId,
    signatureKey: input.signatureKey
  });
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status === "published") return existing;
    if (existing.status === "claimed") throw new Error("artifact_candidate_reconciliation_deferred");
    throw new Error("artifact_candidate_reconciliation_required");
  }

  db.prepare(
    `INSERT INTO workbench_artifact_candidates (
      candidate_id, kind, seed_session_id, provenance_session_ids_json,
      signal_evidence_refs_json, signal_summary, signature_key, evidence_revision,
      supersedes_candidate_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.candidateId,
    input.kind,
    input.seedSessionId,
    JSON.stringify(provenanceSessionIds),
    JSON.stringify(signalEvidenceRefs),
    input.signalSummary.trim(),
    input.signatureKey ?? null,
    input.evidenceRevision,
    input.supersedesCandidateId ?? null,
    input.status ?? "pending",
    now,
    now
  );
  return getWorkbenchArtifactCandidate(db, input.candidateId)!;
}

export function getWorkbenchArtifactCandidate(
  db: MastheadDatabase,
  candidateId: string
): StoredWorkbenchArtifactCandidate | undefined {
  const row = db.prepare(`${CANDIDATE_SELECT} WHERE candidate_id = ?`).get(candidateId) as CandidateRow | undefined;
  return row ? rowToCandidate(row) : undefined;
}

export function listWorkbenchArtifactCandidates(
  db: MastheadDatabase,
  input: { status?: WorkbenchArtifactCandidateStatus } = {}
): StoredWorkbenchArtifactCandidate[] {
  const rows = input.status
    ? (db
        .prepare(`${CANDIDATE_SELECT} WHERE status = ? ORDER BY updated_at DESC, candidate_id`)
        .all(input.status) as CandidateRow[])
    : (db.prepare(`${CANDIDATE_SELECT} ORDER BY updated_at DESC, candidate_id`).all() as CandidateRow[]);
  return rows.map(rowToCandidate);
}

export function setWorkbenchArtifactCandidateStatus(
  db: MastheadDatabase,
  input: { candidateId: string; status: Exclude<WorkbenchArtifactCandidateStatus, "dismissed"> }
): StoredWorkbenchArtifactCandidate {
  const existing = getWorkbenchArtifactCandidate(db, input.candidateId);
  if (!existing) throw new Error(`artifact_candidate_not_found:${input.candidateId}`);
  const allowed: Partial<Record<WorkbenchArtifactCandidateStatus, WorkbenchArtifactCandidateStatus[]>> = {
    pending: ["claimed", "published", "superseded"],
    claimed: ["pending", "published", "superseded"],
    published: ["superseded"]
  };
  if (!(allowed[existing.status] ?? []).includes(input.status)) {
    throw new Error(`artifact_candidate_transition_invalid:${existing.status}:${input.status}`);
  }
  db.prepare(
    `UPDATE workbench_artifact_candidates
     SET status = ?, updated_at = ?
     WHERE candidate_id = ?`
  ).run(input.status, new Date().toISOString(), input.candidateId);
  return getWorkbenchArtifactCandidate(db, input.candidateId)!;
}

export function dismissWorkbenchArtifactCandidate(
  db: MastheadDatabase,
  input: { candidateId: string; reason: string; signalEvidenceRefs: string[] }
): StoredWorkbenchArtifactCandidate {
  const existing = getWorkbenchArtifactCandidate(db, input.candidateId);
  if (!existing) throw new Error(`artifact_candidate_not_found:${input.candidateId}`);
  if (existing.status !== "pending" && existing.status !== "claimed") {
    throw new Error(`artifact_candidate_transition_invalid:${existing.status}:dismissed`);
  }
  const reason = input.reason.trim();
  if (reason.length < 12) throw new Error("candidate_dismissal_reason_too_short");
  const evidenceRefs = normalizedStrings(input.signalEvidenceRefs);
  if (
    evidenceRefs.length === 0 ||
    evidenceRefs.length !== existing.signalEvidenceRefs.length ||
    evidenceRefs.some((ref) => !existing.signalEvidenceRefs.includes(ref))
  ) {
    throw new Error("candidate_dismissal_evidence_invalid");
  }
  db.prepare(
    `UPDATE workbench_artifact_candidates
     SET status = 'dismissed', dismissal_reason = ?, dismissal_evidence_refs_json = ?, updated_at = ?
     WHERE candidate_id = ?`
  ).run(reason, JSON.stringify(evidenceRefs), new Date().toISOString(), input.candidateId);
  return getWorkbenchArtifactCandidate(db, input.candidateId)!;
}

export function hasWorkbenchArtifactCandidateScan(
  db: MastheadDatabase,
  input: { evidenceRevision: string; sessionId: string }
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM workbench_artifact_candidate_scans
         WHERE session_id = ? AND evidence_revision = ?`
      )
      .get(input.sessionId, input.evidenceRevision)
  );
}

export function recordWorkbenchArtifactCandidateScan(
  db: MastheadDatabase,
  input: { evidenceRevision: string; sessionId: string }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_artifact_candidate_scans (session_id, evidence_revision, scanned_at)
     VALUES (?, ?, ?)`
  ).run(input.sessionId, input.evidenceRevision, new Date().toISOString());
}

function findCurrentCandidate(
  db: MastheadDatabase,
  input: { kind: WorkbenchAutomaticKind; seedSessionId: string; signatureKey?: string }
): StoredWorkbenchArtifactCandidate | undefined {
  const row = input.signatureKey
    ? (db
        .prepare(
          `${CANDIDATE_SELECT}
           WHERE kind = ? AND signature_key = ? AND status IN ('pending', 'claimed', 'published')`
        )
        .get(input.kind, input.signatureKey) as CandidateRow | undefined)
    : (db
        .prepare(
          `${CANDIDATE_SELECT}
           WHERE kind = ? AND seed_session_id = ? AND signature_key IS NULL
             AND status IN ('pending', 'claimed', 'published')`
        )
        .get(input.kind, input.seedSessionId) as CandidateRow | undefined);
  return row ? rowToCandidate(row) : undefined;
}

function rowToCandidate(row: CandidateRow): StoredWorkbenchArtifactCandidate {
  return {
    candidateId: row.candidateId,
    kind: row.kind,
    seedSessionId: row.seedSessionId,
    provenanceSessionIds: JSON.parse(row.provenanceSessionIdsJson) as string[],
    signalEvidenceRefs: JSON.parse(row.signalEvidenceRefsJson) as string[],
    signalSummary: row.signalSummary,
    ...(row.signatureKey ? { signatureKey: row.signatureKey } : {}),
    evidenceRevision: row.evidenceRevision,
    ...(row.supersedesCandidateId ? { supersedesCandidateId: row.supersedesCandidateId } : {}),
    status: row.status,
    ...(row.dismissalReason ? { dismissalReason: row.dismissalReason } : {}),
    ...(row.dismissalEvidenceRefsJson
      ? { dismissalEvidenceRefs: JSON.parse(row.dismissalEvidenceRefsJson) as string[] }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
