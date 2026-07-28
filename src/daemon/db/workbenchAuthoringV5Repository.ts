import type {
  WorkbenchAuthoringV5AuthoredDraft,
  WorkbenchAuthoringV5PackDto,
  WorkbenchAuthoringV5PackReceipt,
  WorkbenchAuthoringV5RequestDto,
  WorkbenchAuthoringV5RequestReceipt,
  WorkbenchAuthoringV5PreparationDto,
  WorkbenchAuthoringV5SelectionDto,
  WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import type { SessionTranscriptItem } from "../../shared/sessionTranscript.ts";
import type { SessionTranscriptRowIdCutoffs } from "./sessionTranscriptRepository.ts";
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

export type WorkbenchAuthoringV5PreparationRecord = WorkbenchAuthoringV5PreparationDto & {
  creationToken: string;
  requestFingerprint: string;
  actorId: string;
  identity: {
    creationInstanceId: string;
    instanceManifest: string;
    baseUrl: string;
    databaseId: string;
    buildSha: string;
  };
  requestedSessionIds: string[];
  readinessBySessionId: Record<string, WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"] | null>;
  evidenceCutoffs: SessionTranscriptRowIdCutoffs;
  selection?: WorkbenchAuthoringV5SelectionDto;
};

export function insertWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  input: {
    requestId: string;
    creationToken: string;
    requestFingerprint: string;
    actorId: string;
    identity: WorkbenchAuthoringV5PreparationRecord["identity"];
    requestedSessionIds: string[];
    readinessBySessionId: WorkbenchAuthoringV5PreparationRecord["readinessBySessionId"];
    evidenceCutoffs: SessionTranscriptRowIdCutoffs;
  }
): WorkbenchAuthoringV5PreparationRecord {
  const existing = getWorkbenchAuthoringV5PreparationByToken(db, input.creationToken);
  if (existing) {
    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw new Error("authoring_v5_creation_token_conflict");
    }
    return existing;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workbench_authoring_v5_request_preparations (
      request_id, creation_token, request_fingerprint, actor_id, creation_instance_id,
      instance_manifest, base_url, database_id, build_sha, requested_session_ids_json,
      readiness_json, evidence_cutoffs_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)`
  ).run(
    input.requestId, input.creationToken, input.requestFingerprint, input.actorId,
    input.identity.creationInstanceId, input.identity.instanceManifest, input.identity.baseUrl,
    input.identity.databaseId, input.identity.buildSha, JSON.stringify(input.requestedSessionIds),
    JSON.stringify(input.readinessBySessionId), JSON.stringify(input.evidenceCutoffs), now, now
  );
  return requireWorkbenchAuthoringV5Preparation(db, input.requestId);
}

export function getWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  requestId: string
): WorkbenchAuthoringV5PreparationRecord | undefined {
  const row = db.prepare(
    `SELECT request_id AS requestId, creation_token AS creationToken,
      request_fingerprint AS requestFingerprint, actor_id AS actorId,
      creation_instance_id AS creationInstanceId, instance_manifest AS instanceManifest,
      base_url AS baseUrl, database_id AS databaseId, build_sha AS buildSha,
      requested_session_ids_json AS requestedSessionIdsJson, readiness_json AS readinessJson,
      evidence_cutoffs_json AS evidenceCutoffsJson, status,
      selection_json AS selectionJson, error_code AS errorCode, error_message AS errorMessage,
      created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
     FROM workbench_authoring_v5_request_preparations WHERE request_id = ?`
  ).get(requestId) as any;
  if (!row) return undefined;
  const requestedSessionIds = JSON.parse(row.requestedSessionIdsJson) as unknown;
  if (!Array.isArray(requestedSessionIds) || requestedSessionIds.some((value) => typeof value !== "string")) {
    throw new Error("authoring_v5_preparation_invalid");
  }
  const readinessBySessionId = JSON.parse(row.readinessJson) as WorkbenchAuthoringV5PreparationRecord["readinessBySessionId"];
  const evidenceCutoffs = JSON.parse(row.evidenceCutoffsJson) as SessionTranscriptRowIdCutoffs;
  const prepared = db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_authoring_v5_preparation_sessions WHERE request_id = ?"
  ).get(requestId) as { count: number };
  return {
    actorId: row.actorId,
    createdAt: row.createdAt,
    creationToken: row.creationToken,
    identity: {
      baseUrl: row.baseUrl,
      buildSha: row.buildSha,
      creationInstanceId: row.creationInstanceId,
      databaseId: row.databaseId,
      instanceManifest: row.instanceManifest
    },
    preparedSessionCount: Number(prepared.count),
    readinessBySessionId,
    evidenceCutoffs,
    requestFingerprint: row.requestFingerprint,
    requestId: row.requestId,
    requestedSessionCount: requestedSessionIds.length,
    requestedSessionIds: requestedSessionIds as string[],
    status: row.status,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    ...(row.selectionJson ? { selection: JSON.parse(row.selectionJson) } : {})
  };
}

export function requireWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  requestId: string
): WorkbenchAuthoringV5PreparationRecord {
  const preparation = getWorkbenchAuthoringV5Preparation(db, requestId);
  if (!preparation) throw new Error("authoring_v5_request_not_found");
  return preparation;
}

export function getWorkbenchAuthoringV5PreparationByToken(
  db: MastheadDatabase,
  creationToken: string
): WorkbenchAuthoringV5PreparationRecord | undefined {
  const row = db.prepare(
    "SELECT request_id AS requestId FROM workbench_authoring_v5_request_preparations WHERE creation_token = ?"
  ).get(creationToken) as { requestId: string } | undefined;
  return row ? getWorkbenchAuthoringV5Preparation(db, row.requestId) : undefined;
}

export function listPreparingWorkbenchAuthoringV5RequestIds(db: MastheadDatabase): string[] {
  return (db.prepare(
    "SELECT request_id AS requestId FROM workbench_authoring_v5_request_preparations WHERE status = 'preparing' ORDER BY created_at"
  ).all() as Array<{ requestId: string }>).map(({ requestId }) => requestId);
}

export function nextWorkbenchAuthoringV5PreparationOrdinal(db: MastheadDatabase, requestId: string): number | undefined {
  const preparation = requireWorkbenchAuthoringV5Preparation(db, requestId);
  const row = db.prepare(
    "SELECT COALESCE(MAX(ordinal) + 1, 0) AS ordinal FROM workbench_authoring_v5_preparation_sessions WHERE request_id = ?"
  ).get(requestId) as { ordinal: number };
  const ordinal = Number(row.ordinal);
  return ordinal < preparation.requestedSessionCount ? ordinal : undefined;
}

export function recordWorkbenchAuthoringV5PreparedSession(
  db: MastheadDatabase,
  input: {
    requestId: string;
    sessionId: string;
    ordinal: number;
    outcome: "eligible" | "excluded";
    exclusionReason?: WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"];
    sessionDigest?: string;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_preparation_sessions
     (request_id, session_id, ordinal, outcome, exclusion_reason, session_digest)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.requestId, input.sessionId, input.ordinal, input.outcome,
    input.exclusionReason ?? null, input.sessionDigest ?? null
  );
  db.prepare(
    "UPDATE workbench_authoring_v5_request_preparations SET updated_at = ? WHERE request_id = ?"
  ).run(new Date().toISOString(), input.requestId);
}

export function listWorkbenchAuthoringV5PreparedSessions(
  db: MastheadDatabase,
  requestId: string
): Array<{
  sessionId: string;
  ordinal: number;
  outcome: "eligible" | "excluded";
  exclusionReason: WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"] | null;
  sessionDigest: string | null;
}> {
  return db.prepare(
    `SELECT session_id AS sessionId, ordinal, outcome, exclusion_reason AS exclusionReason,
      session_digest AS sessionDigest
     FROM workbench_authoring_v5_preparation_sessions WHERE request_id = ? ORDER BY ordinal`
  ).all(requestId) as any;
}

export function completeWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  requestId: string,
  selection: WorkbenchAuthoringV5SelectionDto
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workbench_authoring_v5_request_preparations
     SET status = 'ready', selection_json = ?, error_code = NULL, error_message = NULL,
         completed_at = ?, updated_at = ? WHERE request_id = ? AND status = 'preparing'`
  ).run(JSON.stringify(selection), now, now, requestId);
}

export function recordWorkbenchAuthoringV5PreparationSelection(
  db: MastheadDatabase,
  requestId: string,
  selection: WorkbenchAuthoringV5SelectionDto
): void {
  db.prepare(
    "UPDATE workbench_authoring_v5_request_preparations SET selection_json = ?, updated_at = ? WHERE request_id = ?"
  ).run(JSON.stringify(selection), new Date().toISOString(), requestId);
}

export function retryWorkbenchAuthoringV5Preparation(db: MastheadDatabase, requestId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE workbench_authoring_v5_request_preparations
     SET status = 'preparing', error_code = NULL, error_message = NULL, completed_at = NULL, updated_at = ?
     WHERE request_id = ? AND status = 'failed'`
  ).run(now, requestId);
}

export function failWorkbenchAuthoringV5Preparation(
  db: MastheadDatabase,
  requestId: string,
  error: unknown
): void {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0] || "authoring_v5_preparation_failed";
  db.prepare(
    `UPDATE workbench_authoring_v5_request_preparations
     SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
     WHERE request_id = ? AND status = 'preparing'`
  ).run(code, message, now, now, requestId);
}

export function insertWorkbenchAuthoringV5Request(
  db: MastheadDatabase,
  input: CreateWorkbenchAuthoringV5RecordInput
): WorkbenchAuthoringV5RequestDto {
  insertWorkbenchAuthoringV5RequestShell(db, input);
  insertWorkbenchAuthoringV5RequestSessions(db, input.requestId, input.sessions);
  for (const [packIndex, pack] of input.packs.entries()) {
    insertWorkbenchAuthoringV5Pack(db, input.requestId, pack, packIndex === 0);
  }
  return requireWorkbenchAuthoringV5Request(db, input.requestId);
}

export function insertWorkbenchAuthoringV5RequestShell(
  db: MastheadDatabase,
  input: Pick<CreateWorkbenchAuthoringV5RecordInput, "actorId" | "identity" | "requestId">
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_requests (
      request_id, actor_id, creation_instance_id, instance_manifest, base_url, database_id,
      build_sha, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    input.requestId, input.actorId, input.identity.creationInstanceId, input.identity.instanceManifest,
    input.identity.baseUrl, input.identity.databaseId, input.identity.buildSha, now, now
  );
}

export function insertWorkbenchAuthoringV5RequestSessions(
  db: MastheadDatabase,
  requestId: string,
  sessions: Array<{ sessionId: string; ordinal: number }>
): void {
  const insertSession = db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_request_sessions
     (request_id, session_id, ordinal, state) VALUES (?, ?, ?, 'pending')`
  );
  for (const session of sessions) insertSession.run(requestId, session.sessionId, session.ordinal);
}

export function insertWorkbenchAuthoringV5Pack(
  db: MastheadDatabase,
  requestId: string,
  pack: CreateWorkbenchAuthoringV5RecordInput["packs"][number],
  available: boolean
): void {
  const now = new Date().toISOString();
  const insertPack = db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_packs
     (pack_id, request_id, ordinal, status, evidence_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMembership = db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_pack_sessions
     (pack_id, request_id, session_id, ordinal) VALUES (?, ?, ?, ?)`
  );
  insertPack.run(
    pack.packId, requestId, pack.ordinal, available ? "available" : "pending",
    pack.evidenceRevision, now, now
  );
  pack.sessionIds.forEach((sessionId, ordinal) => insertMembership.run(pack.packId, requestId, sessionId, ordinal));
}

export function releaseFirstWorkbenchAuthoringV5Pack(db: MastheadDatabase, requestId: string): void {
  db.prepare(
    `UPDATE workbench_authoring_v5_packs SET status = 'available', updated_at = ?
     WHERE request_id = ? AND ordinal = 0 AND status = 'pending'`
  ).run(new Date().toISOString(), requestId);
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
    `INSERT OR IGNORE INTO workbench_authoring_v5_evidence_snapshots (
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

export function insertWorkbenchAuthoringV5PreparationEvidencePage(
  db: MastheadDatabase,
  input: {
    requestId: string;
    sessionId: string;
    pageOrdinal: number;
    itemOffset: number;
    items: SessionTranscriptItem[];
    usableEvidence: boolean;
    pageDigest: string;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_preparation_evidence_pages (
      request_id, session_id, page_ordinal, item_offset, item_count,
      usable_evidence, page_digest, evidence_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.requestId,
    input.sessionId,
    input.pageOrdinal,
    input.itemOffset,
    input.items.length,
    input.usableEvidence ? 1 : 0,
    input.pageDigest,
    JSON.stringify(input.items)
  );
}

export function getWorkbenchAuthoringV5PreparationEvidenceProgress(
  db: MastheadDatabase,
  requestId: string,
  sessionId: string
): { nextOffset: number; nextPageOrdinal: number; usableEvidence: boolean; pageDigests: string[] } {
  const rows = db.prepare(
    `SELECT page_ordinal AS pageOrdinal, item_offset AS itemOffset, item_count AS itemCount,
      usable_evidence AS usableEvidence, page_digest AS pageDigest
     FROM workbench_authoring_v5_preparation_evidence_pages
     WHERE request_id = ? AND session_id = ? ORDER BY page_ordinal`
  ).all(requestId, sessionId) as Array<{
    pageOrdinal: number;
    itemOffset: number;
    itemCount: number;
    usableEvidence: number;
    pageDigest: string;
  }>;
  const last = rows.at(-1);
  return {
    nextOffset: last ? Number(last.itemOffset) + Number(last.itemCount) : 0,
    nextPageOrdinal: last ? Number(last.pageOrdinal) + 1 : 0,
    pageDigests: rows.map(({ pageDigest }) => pageDigest),
    usableEvidence: rows.some(({ usableEvidence }) => Number(usableEvidence) === 1)
  };
}

export function insertPagedWorkbenchAuthoringV5EvidenceSnapshot(
  db: MastheadDatabase,
  input: { requestId: string; sessionId: string; sessionDigest: string }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workbench_authoring_v5_evidence_snapshots (
      request_id, session_id, session_digest, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(
    input.requestId,
    input.sessionId,
    input.sessionDigest,
    JSON.stringify({ storage: "preparation_pages" }),
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
  if (Array.isArray(evidence)) return { evidence: evidence as SessionTranscriptItem[], sessionDigest: row.sessionDigest };
  if (
    evidence && typeof evidence === "object" && !Array.isArray(evidence) &&
    (evidence as { storage?: unknown }).storage === "preparation_pages"
  ) {
    const pages = db.prepare(
      `SELECT evidence_json AS evidenceJson
       FROM workbench_authoring_v5_preparation_evidence_pages
       WHERE request_id = ? AND session_id = ? ORDER BY page_ordinal`
    ).all(requestId, sessionId) as Array<{ evidenceJson: string }>;
    const items = pages.flatMap((page) => {
      const parsed = JSON.parse(page.evidenceJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("authoring_v5_evidence_snapshot_invalid");
      return parsed as SessionTranscriptItem[];
    });
    return { evidence: items, sessionDigest: row.sessionDigest };
  }
  throw new Error("authoring_v5_evidence_snapshot_invalid");
}

/** Request ids still open or active, newest first (resume UI). */
export function listIncompleteWorkbenchAuthoringV5RequestIds(db: MastheadDatabase): string[] {
  return (
    db.prepare(
      `SELECT request_id AS requestId FROM workbench_authoring_v5_requests
       WHERE status IN ('open', 'active')
       ORDER BY updated_at DESC, created_at DESC`
    ).all() as Array<{ requestId: string }>
  ).map(({ requestId }) => requestId);
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
