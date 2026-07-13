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
  origin: "automatic" | "proposal";
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

export type WorkbenchArtifactSignatureMember = {
  kind: WorkbenchAutomaticKind;
  signatureKey: string;
  sessionId: string;
  evidenceRevision: string;
  sourceRevision: number;
  signalEvidenceRefs: string[];
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
  origin: "automatic" | "proposal";
  status: WorkbenchArtifactCandidateStatus;
  dismissalReason: string | null;
  dismissalEvidenceRefsJson: string | null;
  createdAt: string;
  updatedAt: string;
};

type SignatureMemberRow = {
  kind: WorkbenchAutomaticKind;
  signatureKey: string;
  sessionId: string;
  evidenceRevision: string;
  sourceRevision: number;
  signalEvidenceRefsJson: string;
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
  origin,
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
      supersedes_candidate_id, origin, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    input.origin,
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

export function listWorkbenchArtifactCandidatePage(
  db: MastheadDatabase,
  input: {
    cursor?: { candidateId: string; updatedAt: string };
    kind?: WorkbenchAutomaticKind;
    limit: number;
    status?: WorkbenchArtifactCandidateStatus;
  }
): { candidates: StoredWorkbenchArtifactCandidate[]; nextCursor?: { candidateId: string; updatedAt: string } } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (input.status) {
    conditions.push("status = ?");
    params.push(input.status);
  }
  if (input.kind) {
    conditions.push("kind = ?");
    params.push(input.kind);
  }
  if (input.cursor) {
    conditions.push("(updated_at < ? OR (updated_at = ? AND candidate_id > ?))");
    params.push(input.cursor.updatedAt, input.cursor.updatedAt, input.cursor.candidateId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`${CANDIDATE_SELECT}${where} ORDER BY updated_at DESC, candidate_id LIMIT ?`)
    .all(...params, input.limit + 1) as CandidateRow[];
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit).map(rowToCandidate);
  const last = page.at(-1);
  return {
    candidates: page,
    ...(hasMore && last ? { nextCursor: { candidateId: last.candidateId, updatedAt: last.updatedAt } } : {})
  };
}

export function listCurrentWorkbenchArtifactCandidatesForReconciliation(
  db: MastheadDatabase,
  input: {
    sessionIds: string[];
    identities: Array<{ kind: WorkbenchAutomaticKind; signatureKey: string }>;
  }
): StoredWorkbenchArtifactCandidate[] {
  const sessionIds = normalizedStrings(input.sessionIds);
  const branches: string[] = [];
  const params: string[] = [];
  if (sessionIds.length > 0) {
    branches.push(
      `SELECT provenance.candidate_id
       FROM workbench_artifact_candidate_provenance provenance
       JOIN workbench_artifact_candidates candidates ON candidates.candidate_id = provenance.candidate_id
       WHERE provenance.session_id IN (${sessionIds.map(() => "?").join(", ")})
         AND candidates.status IN ('pending', 'claimed', 'published')`
    );
    params.push(...sessionIds);
  }
  for (const identity of input.identities) {
    branches.push(
      `SELECT candidate_id FROM workbench_artifact_candidates
       WHERE kind = ? AND signature_key = ? AND status IN ('pending', 'claimed', 'published')`
    );
    params.push(identity.kind, identity.signatureKey);
  }
  if (branches.length === 0) return [];
  const rows = db.prepare(
    `${CANDIDATE_SELECT}
     WHERE candidate_id IN (${branches.join(" UNION ")})
     ORDER BY updated_at DESC, candidate_id`
  ).all(...params) as CandidateRow[];
  return rows.map(rowToCandidate);
}

export function listCurrentWorkbenchArtifactCandidatesForSeed(
  db: MastheadDatabase,
  input: { kind: WorkbenchAutomaticKind; provenanceSessionIds: string[]; seedSessionId: string; signatureKey?: string }
): StoredWorkbenchArtifactCandidate[] {
  const exact = findCurrentCandidate(db, input);
  if (exact) return [exact];
  const sessionIds = normalizedStrings(input.provenanceSessionIds);
  if (sessionIds.length === 0) return [];
  const rows = db.prepare(
    `${CANDIDATE_SELECT}
     WHERE kind = ? AND status IN ('pending', 'claimed', 'published')
       AND candidate_id IN (
         SELECT candidate_id FROM workbench_artifact_candidate_provenance
         WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})
       )
     ORDER BY candidate_id
     LIMIT 2`
  ).all(input.kind, ...sessionIds) as CandidateRow[];
  return rows.map(rowToCandidate);
}

export function findBestWorkbenchArtifactCandidatePredecessor(
  db: MastheadDatabase,
  input: { kind: WorkbenchAutomaticKind; provenanceSessionIds: string[]; seedSessionId: string; signatureKey?: string }
): StoredWorkbenchArtifactCandidate | undefined {
  const sessionIds = normalizedStrings(input.provenanceSessionIds);
  const identityClause = input.signatureKey
    ? "kind = ? AND signature_key = ?"
    : "kind = ? AND seed_session_id = ? AND signature_key IS NULL";
  const overlapBranch = sessionIds.length > 0
    ? `UNION
       SELECT candidate_id FROM workbench_artifact_candidate_provenance
       WHERE session_id IN (${sessionIds.map(() => "?").join(", ")})`
    : "";
  const row = db.prepare(
    `${CANDIDATE_SELECT}
     WHERE kind = ? AND candidate_id IN (
       SELECT candidate_id FROM workbench_artifact_candidates
       WHERE ${identityClause}
       ${overlapBranch}
     )
     ORDER BY CASE WHEN status IN ('pending', 'claimed', 'published') THEN 0 ELSE 1 END,
       workbench_artifact_candidates.rowid DESC
     LIMIT 1`
  ).get(
    input.kind,
    input.kind,
    input.signatureKey ?? input.seedSessionId,
    ...sessionIds
  ) as CandidateRow | undefined;
  return row ? rowToCandidate(row) : undefined;
}

export function findExactWorkbenchArtifactCandidate(
  db: MastheadDatabase,
  input: { kind: WorkbenchAutomaticKind; seedSessionId: string; signatureKey?: string }
): StoredWorkbenchArtifactCandidate | undefined {
  const identityClause = input.signatureKey
    ? "signature_key = ?"
    : "seed_session_id = ? AND signature_key IS NULL";
  const row = db.prepare(
    `${CANDIDATE_SELECT}
     WHERE kind = ? AND ${identityClause}
     ORDER BY CASE WHEN status IN ('pending', 'claimed', 'published') THEN 0 ELSE 1 END,
       workbench_artifact_candidates.rowid DESC
     LIMIT 1`
  ).get(input.kind, input.signatureKey ?? input.seedSessionId) as CandidateRow | undefined;
  return row ? rowToCandidate(row) : undefined;
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

export function publishClaimedWorkbenchArtifactCandidateInTransaction(
  db: MastheadDatabase,
  candidateId: string
): StoredWorkbenchArtifactCandidate {
  const candidate = getWorkbenchArtifactCandidate(db, candidateId);
  if (!candidate) throw new Error(`artifact_candidate_not_found:${candidateId}`);
  if (candidate.status !== "claimed") {
    throw new Error(`artifact_candidate_transition_invalid:${candidate.status}:published`);
  }
  return setWorkbenchArtifactCandidateStatus(db, { candidateId, status: "published" });
}

export function dismissWorkbenchArtifactCandidate(
  db: MastheadDatabase,
  input: { candidateId: string; reason: string; signalEvidenceRefs: string[] }
): StoredWorkbenchArtifactCandidate {
  const existing = getWorkbenchArtifactCandidate(db, input.candidateId);
  if (!existing) throw new Error(`artifact_candidate_not_found:${input.candidateId}`);
  if (existing.status !== "pending") {
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
  input: { sessionId: string; sourceRevision: number }
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM workbench_artifact_candidate_scans
         WHERE session_id = ? AND source_revision = ?`
      )
      .get(input.sessionId, input.sourceRevision)
  );
}

export function getWorkbenchArtifactCandidateSourceRevision(
  db: MastheadDatabase,
  sessionId: string
): number {
  const row = db
    .prepare(
      `SELECT source_revision AS sourceRevision
       FROM workbench_artifact_candidate_source_revisions
       WHERE session_id = ?`
    )
    .get(sessionId) as { sourceRevision: number } | undefined;
  return row?.sourceRevision ?? 0;
}

export function recordWorkbenchArtifactCandidateScan(
  db: MastheadDatabase,
  input: { evidenceRevision: string; sessionId: string; sourceRevision: number }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_artifact_candidate_scans (
      session_id, evidence_revision, source_revision, scanned_at
    ) VALUES (?, ?, ?, ?)`
  ).run(input.sessionId, input.evidenceRevision, input.sourceRevision, new Date().toISOString());
}

export function listWorkbenchArtifactSignatureMembersForSessions(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchArtifactSignatureMember[] {
  const normalized = normalizedStrings(sessionIds);
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => "?").join(", ");
  return (
    db
      .prepare(
        `SELECT kind,
          signature_key AS signatureKey,
          session_id AS sessionId,
          evidence_revision AS evidenceRevision,
          source_revision AS sourceRevision,
          signal_evidence_refs_json AS signalEvidenceRefsJson
         FROM workbench_artifact_candidate_signature_members
         WHERE session_id IN (${placeholders})
         ORDER BY kind, signature_key, session_id`
      )
      .all(...normalized) as SignatureMemberRow[]
  ).map(rowToSignatureMember);
}

export function listWorkbenchArtifactSignatureMembersForIdentities(
  db: MastheadDatabase,
  identities: Array<{ kind: WorkbenchAutomaticKind; signatureKey: string }>
): WorkbenchArtifactSignatureMember[] {
  const uniqueIdentities = [
    ...new Map(
      identities.map((identity) => [`${identity.kind}\0${identity.signatureKey}`, identity])
    ).values()
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.signatureKey.localeCompare(right.signatureKey)
  );
  return uniqueIdentities.flatMap((identity) =>
    (
      db
        .prepare(
          `SELECT members.kind,
            members.signature_key AS signatureKey,
            members.session_id AS sessionId,
            members.evidence_revision AS evidenceRevision,
            members.source_revision AS sourceRevision,
            members.signal_evidence_refs_json AS signalEvidenceRefsJson
           FROM workbench_artifact_candidate_signature_members members
           LEFT JOIN workbench_artifact_candidate_source_revisions revisions
             ON revisions.session_id = members.session_id
           WHERE members.kind = ? AND members.signature_key = ?
             AND members.source_revision = COALESCE(revisions.source_revision, 0)
           ORDER BY members.session_id
           LIMIT 12`
        )
        .all(identity.kind, identity.signatureKey) as SignatureMemberRow[]
    ).map(rowToSignatureMember)
  );
}

export function replaceWorkbenchArtifactSignatureMembersForSessions(
  db: MastheadDatabase,
  input: { sessionIds: string[]; members: WorkbenchArtifactSignatureMember[] }
): void {
  const sessionIds = normalizedStrings(input.sessionIds);
  const remove = db.prepare(
    "DELETE FROM workbench_artifact_candidate_signature_members WHERE session_id = ?"
  );
  for (const sessionId of sessionIds) remove.run(sessionId);
  const insert = db.prepare(
    `INSERT INTO workbench_artifact_candidate_signature_members (
      kind, signature_key, session_id, evidence_revision, signal_evidence_refs_json, updated_at
      , source_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const updatedAt = new Date().toISOString();
  for (const member of input.members) {
    if (!sessionIds.includes(member.sessionId)) throw new Error("signature_member_session_not_replaced");
    insert.run(
      member.kind,
      member.signatureKey,
      member.sessionId,
      member.evidenceRevision,
      JSON.stringify(normalizedStrings(member.signalEvidenceRefs)),
      updatedAt,
      member.sourceRevision
    );
  }
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
    origin: row.origin,
    status: row.status,
    ...(row.dismissalReason ? { dismissalReason: row.dismissalReason } : {}),
    ...(row.dismissalEvidenceRefsJson
      ? { dismissalEvidenceRefs: JSON.parse(row.dismissalEvidenceRefsJson) as string[] }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function rowToSignatureMember(row: SignatureMemberRow): WorkbenchArtifactSignatureMember {
  return {
    kind: row.kind,
    signatureKey: row.signatureKey,
    sessionId: row.sessionId,
    evidenceRevision: row.evidenceRevision,
    sourceRevision: row.sourceRevision,
    signalEvidenceRefs: JSON.parse(row.signalEvidenceRefsJson) as string[]
  };
}

function normalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
