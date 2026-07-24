import type {
  WorkbenchAuthoringV5AuthoredDraft,
  WorkbenchAuthoringV5PackDto,
  WorkbenchAuthoringV5PackReceipt,
  WorkbenchAuthoringV5RequestDto,
  WorkbenchAuthoringV5RequestReceipt,
  WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type RequestRow = {
  requestId: string;
  actorId: string;
  creationInstanceId: string;
  instanceManifest: string;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  status: WorkbenchAuthoringV5RequestDto["status"];
  receiptJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type PackRow = {
  packId: string;
  requestId: string;
  ordinal: number;
  status: WorkbenchAuthoringV5PackDto["status"];
  evidenceRevision: string;
  currentDraftRevision: number;
  draftJson: string | null;
  outcomesJson: string | null;
  receiptJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CreateWorkbenchAuthoringV5RecordInput = {
  requestId: string;
  actorId: string;
  identity: {
    creationInstanceId: string;
    instanceManifest: string;
    baseUrl: string;
    databaseId: string;
    buildSha: string;
  };
  sessions: Array<{ sessionId: string; ordinal: number }>;
  packs: Array<{ packId: string; ordinal: number; evidenceRevision: string; sessionIds: string[] }>;
};

export function insertWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: CreateWorkbenchAuthoringV5RecordInput
): WorkbenchAuthoringV5RequestDto {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workbench_authoring_v5_requests (
      request_id, actor_id, creation_instance_id, instance_manifest, base_url, database_id,
      build_sha, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    input.requestId, input.actorId, input.identity.creationInstanceId, input.identity.instanceManifest,
    input.identity.baseUrl, input.identity.databaseId, input.identity.buildSha, now, now
  );
  const insertSession = db.prepare(
    `INSERT INTO workbench_authoring_v5_request_sessions
     (request_id, session_id, ordinal, state) VALUES (?, ?, ?, 'pending')`
  );
  for (const session of input.sessions) insertSession.run(input.requestId, session.sessionId, session.ordinal);
  const insertPack = db.prepare(
    `INSERT INTO workbench_authoring_v5_packs
     (pack_id, request_id, ordinal, status, evidence_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMembership = db.prepare(
    `INSERT INTO workbench_authoring_v5_pack_sessions
     (pack_id, request_id, session_id, ordinal) VALUES (?, ?, ?, ?)`
  );
  input.packs.forEach((pack, packIndex) => {
    insertPack.run(
      pack.packId, input.requestId, pack.ordinal, packIndex === 0 ? "available" : "pending",
      pack.evidenceRevision, now, now
    );
    pack.sessionIds.forEach((sessionId, ordinal) => insertMembership.run(pack.packId, input.requestId, sessionId, ordinal));
  });
  return requireWorkbenchAuthoringV5Request(db, input.requestId);
}

export function insertWorkbenchAuthoringV5EvidenceSnapshot(
  db: MastheadDatabase,
  input: {
    requestId: string;
    sessionId: string;
    sessionDigest: string;
    evidence: SessionTranscriptItem[];
  }
): void {
  db.prepare(
    `INSERT INTO workbench_authoring_v5_evidence_snapshots (
      request_id, session_id, session_digest, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    input.requestId,
    input.sessionId,
    input.sessionDigest,
    JSON.stringify(input.evidence),
    new Date().toISOString()
  );
}

export function getWorkbenchAuthoringV5EvidenceSnapshot(
  db: MastheadDatabase,
  requestId: string,
  sessionId: string
): { sessionDigest: string; evidence: SessionTranscriptItem[] } | undefined {
  const row = db.prepare(
    `SELECT session_digest AS sessionDigest, evidence_json AS evidenceJson
     FROM workbench_authoring_v5_evidence_snapshots
     WHERE request_id = ? AND session_id = ?`
  ).get(requestId, sessionId) as { sessionDigest: string; evidenceJson: string } | undefined;
  if (!row) return undefined;
  const evidence = JSON.parse(row.evidenceJson) as unknown;
  if (!Array.isArray(evidence)) throw new Error("authoring_v5_evidence_snapshot_invalid");
  return { evidence: evidence as SessionTranscriptItem[], sessionDigest: row.sessionDigest };
}

export function getWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  requestId: string
): WorkbenchAuthoringV5RequestDto | undefined {
  const row = requestRow(db, requestId);
  if (!row) return undefined;
  const packs = listWorkbenchAuthoringV5Packs(db, requestId);
  const counts = db.prepare(
    `SELECT COUNT(*) AS sessionCount,
      SUM(CASE WHEN state IN ('published','soft_flagged','rejected') THEN 1 ELSE 0 END) AS attempted,
      SUM(CASE WHEN state IN ('published','soft_flagged') THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN state = 'soft_flagged' THEN 1 ELSE 0 END) AS softFlagged,
      SUM(CASE WHEN state = 'rejected' THEN 1 ELSE 0 END) AS rejected
     FROM workbench_authoring_v5_request_sessions WHERE request_id = ?`
  ).get(requestId) as Record<string, number | null>;
  const current = packs.find(({ status }) => status === "active" || status === "saved");
  return {
    requestId: row.requestId,
    actorId: row.actorId,
    contractVersion: "workbench-authoring-v5",
    status: row.status,
    baseUrl: row.baseUrl,
    databaseId: row.databaseId,
    buildSha: row.buildSha,
    instanceManifest: row.instanceManifest,
    creationInstanceId: row.creationInstanceId,
    sessionCount: Number(counts.sessionCount ?? 0),
    attemptedSessionCount: Number(counts.attempted ?? 0),
    publishedSessionCount: Number(counts.published ?? 0),
    softFlaggedSessionCount: Number(counts.softFlagged ?? 0),
    rejectedSessionCount: Number(counts.rejected ?? 0),
    packCount: packs.length,
    packSizes: packs.map(({ sessionIds }) => sessionIds.length),
    ...(current ? { currentPackId: current.packId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {})
  };
}

export function requireWorkbenchAuthoringV5Request(db: MastheadDatabase, requestId: string): WorkbenchAuthoringV5RequestDto {
  const request = getWorkbenchAuthoringV5Request(db, requestId);
  if (!request) throw new Error("authoring_v5_request_not_found");
  return request;
}

export function listWorkbenchAuthoringV5Packs(db: MastheadDatabase, requestId: string): WorkbenchAuthoringV5PackDto[] {
  return (db.prepare(`${packSelect} WHERE request_id = ? ORDER BY ordinal`).all(requestId) as PackRow[]).map((row) => packDto(db, row));
}

export function getWorkbenchAuthoringV5Pack(db: MastheadDatabase, packId: string): WorkbenchAuthoringV5PackDto | undefined {
  const row = db.prepare(`${packSelect} WHERE pack_id = ?`).get(packId) as PackRow | undefined;
  return row ? packDto(db, row) : undefined;
}

export function requireWorkbenchAuthoringV5Pack(db: MastheadDatabase, packId: string): WorkbenchAuthoringV5PackDto {
  const pack = getWorkbenchAuthoringV5Pack(db, packId);
  if (!pack) throw new Error("authoring_v5_pack_not_found");
  return pack;
}

export function activeOrAvailableWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  requestId: string
): WorkbenchAuthoringV5PackDto | undefined {
  const row = db.prepare(
    `${packSelect} WHERE request_id = ? AND status IN ('active','saved','available') ORDER BY ordinal LIMIT 1`
  ).get(requestId) as PackRow | undefined;
  return row ? packDto(db, row) : undefined;
}

export function activateWorkbenchAuthoringV5Pack(db: MastheadDatabase, packId: string): WorkbenchAuthoringV5PackDto {
  const pack = requireWorkbenchAuthoringV5Pack(db, packId);
  if (pack.status === "active" || pack.status === "saved") return pack;
  if (pack.status !== "available") throw new Error("authoring_v5_pack_not_available");
  const now = new Date().toISOString();
  db.prepare("UPDATE workbench_authoring_v5_packs SET status = 'active', updated_at = ? WHERE pack_id = ? AND status = 'available'")
    .run(now, packId);
  db.prepare("UPDATE workbench_authoring_v5_requests SET status = 'active', updated_at = ? WHERE request_id = ? AND status IN ('open','active')")
    .run(now, pack.requestId);
  db.prepare(
    `UPDATE workbench_authoring_v5_request_sessions SET state = 'assigned'
     WHERE request_id = ? AND state = 'pending' AND session_id IN (
       SELECT session_id FROM workbench_authoring_v5_pack_sessions WHERE pack_id = ?
     )`
  ).run(pack.requestId, packId);
  return requireWorkbenchAuthoringV5Pack(db, packId);
}

export function recordWorkbenchAuthoringV5EvidenceAccess(
  db: MastheadDatabase,
  input: { packId: string; requestId: string; sessionId: string; evidenceRevision: string; evidenceRefs: string[] }
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_evidence_access
     (pack_id, request_id, session_id, evidence_revision, evidence_ref, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const evidenceRef of input.evidenceRefs) {
    insert.run(input.packId, input.requestId, input.sessionId, input.evidenceRevision, evidenceRef, now);
  }
}

export function listWorkbenchAuthoringV5EvidenceAccess(
  db: MastheadDatabase,
  packId: string,
  evidenceRevision: string
): Array<{ sessionId: string; evidenceRef: string }> {
  return db.prepare(
    `SELECT session_id AS sessionId, evidence_ref AS evidenceRef
     FROM workbench_authoring_v5_evidence_access WHERE pack_id = ? AND evidence_revision = ?`
  ).all(packId, evidenceRevision) as Array<{ sessionId: string; evidenceRef: string }>;
}

export function saveWorkbenchAuthoringV5PackDraft(
  db: MastheadDatabase,
  input: { packId: string; draft: WorkbenchAuthoringV5AuthoredDraft; outcomes: WorkbenchAuthoringV5SessionOutcome[] }
): WorkbenchAuthoringV5PackDto {
  const pack = requireWorkbenchAuthoringV5Pack(db, input.packId);
  if (pack.status === "completed") throw new Error("authoring_v5_pack_completed");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workbench_authoring_v5_packs
     SET status = 'saved', current_draft_revision = current_draft_revision + 1,
         draft_json = ?, outcomes_json = ?, updated_at = ?
     WHERE pack_id = ? AND status IN ('active','saved')`
  ).run(JSON.stringify(input.draft), JSON.stringify(input.outcomes), now, input.packId);
  return requireWorkbenchAuthoringV5Pack(db, input.packId);
}

export function getSavedWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  packId: string
): { draft: WorkbenchAuthoringV5AuthoredDraft; outcomes: WorkbenchAuthoringV5SessionOutcome[] } | undefined {
  const row = db.prepare(
    "SELECT draft_json AS draftJson, outcomes_json AS outcomesJson FROM workbench_authoring_v5_packs WHERE pack_id = ?"
  ).get(packId) as { draftJson: string | null; outcomesJson: string | null } | undefined;
  if (!row?.draftJson || !row.outcomesJson) return undefined;
  return { draft: JSON.parse(row.draftJson), outcomes: JSON.parse(row.outcomesJson) };
}

export function getWorkbenchAuthoringV5PackReceipt(
  db: MastheadDatabase,
  packId: string
): WorkbenchAuthoringV5PackReceipt | undefined {
  const row = db.prepare("SELECT receipt_json AS receiptJson FROM workbench_authoring_v5_packs WHERE pack_id = ?")
    .get(packId) as { receiptJson: string | null } | undefined;
  return row?.receiptJson ? JSON.parse(row.receiptJson) : undefined;
}

export function getWorkbenchAuthoringV5RequestReceipt(
  db: MastheadDatabase,
  requestId: string
): WorkbenchAuthoringV5RequestReceipt | undefined {
  const row = requestRow(db, requestId);
  return row?.receiptJson ? JSON.parse(row.receiptJson) : undefined;
}

export function completeWorkbenchAuthoringV5PackRecord(
  db: MastheadDatabase,
  input: {
    packReceipt: WorkbenchAuthoringV5PackReceipt;
    requestReceipt?: WorkbenchAuthoringV5RequestReceipt;
  }
): void {
  const { packReceipt } = input;
  const now = packReceipt.completedAt;
  db.prepare(
    `UPDATE workbench_authoring_v5_packs SET status = 'completed', receipt_json = ?, completed_at = ?, updated_at = ?
     WHERE pack_id = ? AND status = 'saved' AND receipt_json IS NULL`
  ).run(JSON.stringify(packReceipt), now, now, packReceipt.packId);
  for (const outcome of packReceipt.outcomes) {
    const state = outcome.disposition === "hard_reject" ? "rejected" :
      outcome.disposition === "soft_flag" ? "soft_flagged" : "published";
    db.prepare(
      `UPDATE workbench_authoring_v5_request_sessions SET state = ?
       WHERE request_id = ? AND session_id = ? AND state = 'assigned'`
    ).run(state, packReceipt.requestId, outcome.sessionId);
  }
  const next = db.prepare(
    `SELECT pack_id AS packId FROM workbench_authoring_v5_packs
     WHERE request_id = ? AND ordinal > (
       SELECT ordinal FROM workbench_authoring_v5_packs WHERE pack_id = ?
     ) AND status = 'pending' ORDER BY ordinal LIMIT 1`
  ).get(packReceipt.requestId, packReceipt.packId) as { packId: string } | undefined;
  if (next) {
    db.prepare("UPDATE workbench_authoring_v5_packs SET status = 'available', updated_at = ? WHERE pack_id = ?")
      .run(now, next.packId);
    db.prepare("UPDATE workbench_authoring_v5_requests SET status = 'active', updated_at = ? WHERE request_id = ?")
      .run(now, packReceipt.requestId);
  } else if (input.requestReceipt) {
    db.prepare(
      `UPDATE workbench_authoring_v5_requests
       SET status = 'completed', receipt_json = ?, completed_at = ?, updated_at = ? WHERE request_id = ?`
    ).run(JSON.stringify(input.requestReceipt), now, now, packReceipt.requestId);
  }
}

export function requestBindingForWorkbenchAuthoringV5Pack(db: MastheadDatabase, packId: string): RequestRow | undefined {
  return db.prepare(
    `SELECT request.request_id AS requestId, request.actor_id AS actorId,
      request.creation_instance_id AS creationInstanceId, request.instance_manifest AS instanceManifest,
      request.base_url AS baseUrl, request.database_id AS databaseId, request.build_sha AS buildSha,
      request.status, request.receipt_json AS receiptJson, request.created_at AS createdAt,
      request.updated_at AS updatedAt, request.completed_at AS completedAt
     FROM workbench_authoring_v5_packs AS pack
     JOIN workbench_authoring_v5_requests AS request ON request.request_id = pack.request_id
     WHERE pack.pack_id = ?`
  ).get(packId) as RequestRow | undefined;
}

function requestRow(db: MastheadDatabase, requestId: string): RequestRow | undefined {
  return db.prepare(
    `SELECT request_id AS requestId, actor_id AS actorId, creation_instance_id AS creationInstanceId,
      instance_manifest AS instanceManifest, base_url AS baseUrl, database_id AS databaseId,
      build_sha AS buildSha, status, receipt_json AS receiptJson, created_at AS createdAt,
      updated_at AS updatedAt, completed_at AS completedAt
     FROM workbench_authoring_v5_requests WHERE request_id = ?`
  ).get(requestId) as RequestRow | undefined;
}

const packSelect = `SELECT pack_id AS packId, request_id AS requestId, ordinal, status,
  evidence_revision AS evidenceRevision, current_draft_revision AS currentDraftRevision,
  draft_json AS draftJson, outcomes_json AS outcomesJson, receipt_json AS receiptJson,
  created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
  FROM workbench_authoring_v5_packs`;

function packDto(db: MastheadDatabase, row: PackRow): WorkbenchAuthoringV5PackDto {
  const sessionIds = (db.prepare(
    "SELECT session_id AS sessionId FROM workbench_authoring_v5_pack_sessions WHERE pack_id = ? ORDER BY ordinal"
  ).all(row.packId) as Array<{ sessionId: string }>).map(({ sessionId }) => sessionId);
  return {
    packId: row.packId,
    requestId: row.requestId,
    ordinal: Number(row.ordinal),
    status: row.status,
    evidenceRevision: row.evidenceRevision,
    sessionIds,
    currentDraftRevision: Number(row.currentDraftRevision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {})
  };
}
