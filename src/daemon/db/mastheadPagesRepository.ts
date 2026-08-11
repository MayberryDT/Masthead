import type { MastheadDatabase } from "./sqlite.ts";
import { withImmediateTransaction } from "./sqlite.ts";

export type MastheadPagesMappingStatus = "none" | "live" | "failed" | "removed";
export type MastheadPagesPendingOperationKind = "publish" | "remove";

export type MastheadPagesReleaseMapping = {
  lineageId: string;
  sourceArtifactId: string;
  localContentFingerprint: string;
  pagesAccountId: string;
  publicLogbookId: string;
  pageId?: string;
  objectId?: string;
  parentObjectId?: string;
  friendlyUrl?: string;
  exactUrl?: string;
  egressFingerprint?: string;
  status: MastheadPagesMappingStatus;
  lastErrorClass?: string;
  lastErrorMessage?: string;
  pendingOperationKind?: MastheadPagesPendingOperationKind;
  pendingRequestJson?: string;
  pendingRequestDigest?: string;
  pendingIdempotencyKey?: string;
  pendingStagedAt?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  removedAt?: string;
};

export type MastheadPagesPendingOperation = {
  lineageId: string;
  sourceArtifactId: string;
  operationKind: MastheadPagesPendingOperationKind;
  requestJson: string;
  requestDigest: string;
  idempotencyKey: string;
  stagedAt: string;
};

export type StageMastheadPagesPublicationInput = {
  artifactId: string;
  pagesAccountId: string;
  publicLogbookId: string;
  localContentFingerprint: string;
  egressFingerprint: string;
  requestJson: string;
  requestDigest: string;
  idempotencyKey: string;
  stagedAt?: string;
};

export type StageMastheadPagesRemovalInput = {
  artifactId: string;
  requestJson: string;
  requestDigest: string;
  idempotencyKey: string;
  stagedAt?: string;
};

export type MastheadPagesPublicationReceipt = {
  artifactId: string;
  pageId: string;
  objectId: string;
  parentObjectId?: string;
  pagesAccountId: string;
  publicLogbookId: string;
  localContentFingerprint: string;
  egressFingerprint: string;
  friendlyUrl: string;
  exactUrl: string;
  publishedAt: string;
};

export type MastheadPagesFailureRecord = {
  errorClass: string;
  message: string;
  retryable: boolean;
  recordedAt?: string;
  currentObjectId?: string;
};

type MappingRow = {
  created_at: string;
  egress_fingerprint: string | null;
  exact_url: string | null;
  friendly_url: string | null;
  last_error_class: string | null;
  last_error_message: string | null;
  lineage_id: string;
  local_content_fingerprint: string;
  object_id: string | null;
  page_id: string | null;
  pages_account_id: string;
  parent_object_id: string | null;
  pending_idempotency_key: string | null;
  pending_operation_kind: MastheadPagesPendingOperationKind | null;
  pending_request_digest: string | null;
  pending_request_json: string | null;
  pending_staged_at: string | null;
  public_logbook_id: string;
  published_at: string | null;
  removed_at: string | null;
  source_artifact_id: string;
  status: MastheadPagesMappingStatus;
  updated_at: string;
};

const MAPPING_SELECT = `SELECT
  lineage_id,
  source_artifact_id,
  local_content_fingerprint,
  pages_account_id,
  public_logbook_id,
  page_id,
  object_id,
  parent_object_id,
  friendly_url,
  exact_url,
  egress_fingerprint,
  status,
  last_error_class,
  last_error_message,
  pending_operation_kind,
  pending_request_json,
  pending_request_digest,
  pending_idempotency_key,
  pending_staged_at,
  created_at,
  updated_at,
  published_at,
  removed_at
FROM masthead_pages_release_mappings`;

export function getMastheadPagesMapping(
  db: MastheadDatabase,
  artifactId: string
): MastheadPagesReleaseMapping | undefined {
  const lineageId = resolveLineageId(db, artifactId);
  if (!lineageId) return undefined;
  const row = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(lineageId) as MappingRow | undefined;
  return row ? mappingFromRow(row) : undefined;
}

export function getPendingMastheadPagesOperation(
  db: MastheadDatabase,
  artifactId: string
): MastheadPagesPendingOperation | undefined {
  const mapping = getMastheadPagesMapping(db, artifactId);
  if (
    !mapping?.pendingOperationKind ||
    mapping.pendingRequestJson === undefined ||
    mapping.pendingRequestDigest === undefined ||
    mapping.pendingIdempotencyKey === undefined ||
    mapping.pendingStagedAt === undefined
  ) {
    return undefined;
  }
  return {
    lineageId: mapping.lineageId,
    sourceArtifactId: mapping.sourceArtifactId,
    operationKind: mapping.pendingOperationKind,
    requestJson: mapping.pendingRequestJson,
    requestDigest: mapping.pendingRequestDigest,
    idempotencyKey: mapping.pendingIdempotencyKey,
    stagedAt: mapping.pendingStagedAt
  };
}

export function stageMastheadPagesPublication(
  db: MastheadDatabase,
  input: StageMastheadPagesPublicationInput
): MastheadPagesReleaseMapping {
  return withImmediateTransaction(db, () => stageMastheadPagesPublicationInTransaction(db, input));
}

export function stageMastheadPagesPublicationInTransaction(
  db: MastheadDatabase,
  input: StageMastheadPagesPublicationInput
): MastheadPagesReleaseMapping {
  assertTransaction(db);
  const artifact = requireArtifactLineage(db, input.artifactId);
  const now = input.stagedAt ?? new Date().toISOString();
  const existing = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(artifact.lineageId) as
    | MappingRow
    | undefined;

  if (existing) {
    db.prepare(
      `UPDATE masthead_pages_release_mappings SET
        source_artifact_id = ?,
        local_content_fingerprint = ?,
        pages_account_id = ?,
        public_logbook_id = ?,
        egress_fingerprint = ?,
        last_error_class = NULL,
        last_error_message = NULL,
        pending_operation_kind = 'publish',
        pending_request_json = ?,
        pending_request_digest = ?,
        pending_idempotency_key = ?,
        pending_staged_at = ?,
        updated_at = ?,
        removed_at = CASE WHEN status = 'removed' THEN NULL ELSE removed_at END,
        status = CASE WHEN status = 'removed' THEN 'none' ELSE status END
      WHERE lineage_id = ?`
    ).run(
      input.artifactId,
      input.localContentFingerprint,
      input.pagesAccountId,
      input.publicLogbookId,
      input.egressFingerprint,
      input.requestJson,
      input.requestDigest,
      input.idempotencyKey,
      now,
      now,
      artifact.lineageId
    );
  } else {
    db.prepare(
      `INSERT INTO masthead_pages_release_mappings (
        lineage_id,
        source_artifact_id,
        local_content_fingerprint,
        pages_account_id,
        public_logbook_id,
        egress_fingerprint,
        status,
        pending_operation_kind,
        pending_request_json,
        pending_request_digest,
        pending_idempotency_key,
        pending_staged_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'none', 'publish', ?, ?, ?, ?, ?, ?)`
    ).run(
      artifact.lineageId,
      input.artifactId,
      input.localContentFingerprint,
      input.pagesAccountId,
      input.publicLogbookId,
      input.egressFingerprint,
      input.requestJson,
      input.requestDigest,
      input.idempotencyKey,
      now,
      now,
      now
    );
  }

  return requireMappingByLineage(db, artifact.lineageId);
}

export function stageMastheadPagesRemoval(
  db: MastheadDatabase,
  input: StageMastheadPagesRemovalInput
): MastheadPagesReleaseMapping {
  return withImmediateTransaction(db, () => stageMastheadPagesRemovalInTransaction(db, input));
}

export function stageMastheadPagesRemovalInTransaction(
  db: MastheadDatabase,
  input: StageMastheadPagesRemovalInput
): MastheadPagesReleaseMapping {
  assertTransaction(db);
  const artifact = requireArtifactLineage(db, input.artifactId);
  const existing = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(artifact.lineageId) as
    | MappingRow
    | undefined;
  if (!existing?.page_id) throw new Error("masthead_pages_mapping_missing_page");
  if (existing.status === "removed" && !existing.pending_operation_kind) {
    throw new Error("masthead_pages_mapping_already_removed");
  }

  const now = input.stagedAt ?? new Date().toISOString();
  db.prepare(
    `UPDATE masthead_pages_release_mappings SET
      source_artifact_id = ?,
      last_error_class = NULL,
      last_error_message = NULL,
      pending_operation_kind = 'remove',
      pending_request_json = ?,
      pending_request_digest = ?,
      pending_idempotency_key = ?,
      pending_staged_at = ?,
      updated_at = ?
    WHERE lineage_id = ?`
  ).run(
    input.artifactId,
    input.requestJson,
    input.requestDigest,
    input.idempotencyKey,
    now,
    now,
    artifact.lineageId
  );

  return requireMappingByLineage(db, artifact.lineageId);
}

export function recordMastheadPagesPublication(
  db: MastheadDatabase,
  receipt: MastheadPagesPublicationReceipt
): MastheadPagesReleaseMapping {
  return withImmediateTransaction(db, () => recordMastheadPagesPublicationInTransaction(db, receipt));
}

export function recordMastheadPagesPublicationInTransaction(
  db: MastheadDatabase,
  receipt: MastheadPagesPublicationReceipt
): MastheadPagesReleaseMapping {
  assertTransaction(db);
  const artifact = requireArtifactLineage(db, receipt.artifactId);
  const existing = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(artifact.lineageId) as
    | MappingRow
    | undefined;
  const now = receipt.publishedAt;

  if (existing) {
    db.prepare(
      `UPDATE masthead_pages_release_mappings SET
        source_artifact_id = ?,
        local_content_fingerprint = ?,
        pages_account_id = ?,
        public_logbook_id = ?,
        page_id = ?,
        object_id = ?,
        parent_object_id = ?,
        friendly_url = ?,
        exact_url = ?,
        egress_fingerprint = ?,
        status = 'live',
        last_error_class = NULL,
        last_error_message = NULL,
        pending_operation_kind = NULL,
        pending_request_json = NULL,
        pending_request_digest = NULL,
        pending_idempotency_key = NULL,
        pending_staged_at = NULL,
        updated_at = ?,
        published_at = ?,
        removed_at = NULL
      WHERE lineage_id = ?`
    ).run(
      receipt.artifactId,
      receipt.localContentFingerprint,
      receipt.pagesAccountId,
      receipt.publicLogbookId,
      receipt.pageId,
      receipt.objectId,
      receipt.parentObjectId ?? null,
      receipt.friendlyUrl,
      receipt.exactUrl,
      receipt.egressFingerprint,
      now,
      now,
      artifact.lineageId
    );
  } else {
    db.prepare(
      `INSERT INTO masthead_pages_release_mappings (
        lineage_id,
        source_artifact_id,
        local_content_fingerprint,
        pages_account_id,
        public_logbook_id,
        page_id,
        object_id,
        parent_object_id,
        friendly_url,
        exact_url,
        egress_fingerprint,
        status,
        created_at,
        updated_at,
        published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)`
    ).run(
      artifact.lineageId,
      receipt.artifactId,
      receipt.localContentFingerprint,
      receipt.pagesAccountId,
      receipt.publicLogbookId,
      receipt.pageId,
      receipt.objectId,
      receipt.parentObjectId ?? null,
      receipt.friendlyUrl,
      receipt.exactUrl,
      receipt.egressFingerprint,
      now,
      now,
      now
    );
  }

  return requireMappingByLineage(db, artifact.lineageId);
}

export function recordMastheadPagesFailure(
  db: MastheadDatabase,
  artifactId: string,
  failure: MastheadPagesFailureRecord
): MastheadPagesReleaseMapping {
  return withImmediateTransaction(db, () => recordMastheadPagesFailureInTransaction(db, artifactId, failure));
}

export function recordMastheadPagesFailureInTransaction(
  db: MastheadDatabase,
  artifactId: string,
  failure: MastheadPagesFailureRecord
): MastheadPagesReleaseMapping {
  assertTransaction(db);
  const artifact = requireArtifactLineage(db, artifactId);
  const existing = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(artifact.lineageId) as
    | MappingRow
    | undefined;
  if (!existing) throw new Error("masthead_pages_mapping_missing");

  const now = failure.recordedAt ?? new Date().toISOString();
  if (failure.retryable) {
    db.prepare(
      `UPDATE masthead_pages_release_mappings SET
        source_artifact_id = ?,
        last_error_class = ?,
        last_error_message = ?,
        object_id = COALESCE(?, object_id),
        updated_at = ?
      WHERE lineage_id = ?`
    ).run(
      artifactId,
      failure.errorClass,
      failure.message,
      failure.currentObjectId ?? null,
      now,
      artifact.lineageId
    );
  } else {
    db.prepare(
      `UPDATE masthead_pages_release_mappings SET
        source_artifact_id = ?,
        status = 'failed',
        last_error_class = ?,
        last_error_message = ?,
        object_id = COALESCE(?, object_id),
        pending_operation_kind = NULL,
        pending_request_json = NULL,
        pending_request_digest = NULL,
        pending_idempotency_key = NULL,
        pending_staged_at = NULL,
        updated_at = ?
      WHERE lineage_id = ?`
    ).run(
      artifactId,
      failure.errorClass,
      failure.message,
      failure.currentObjectId ?? null,
      now,
      artifact.lineageId
    );
  }

  return requireMappingByLineage(db, artifact.lineageId);
}

export function markMastheadPagesRemoved(
  db: MastheadDatabase,
  artifactId: string,
  removedAt: string
): MastheadPagesReleaseMapping {
  return withImmediateTransaction(db, () => markMastheadPagesRemovedInTransaction(db, artifactId, removedAt));
}

export function markMastheadPagesRemovedInTransaction(
  db: MastheadDatabase,
  artifactId: string,
  removedAt: string
): MastheadPagesReleaseMapping {
  assertTransaction(db);
  const artifact = requireArtifactLineage(db, artifactId);
  const existing = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(artifact.lineageId) as
    | MappingRow
    | undefined;
  if (!existing) throw new Error("masthead_pages_mapping_missing");

  db.prepare(
    `UPDATE masthead_pages_release_mappings SET
      source_artifact_id = ?,
      status = 'removed',
      last_error_class = NULL,
      last_error_message = NULL,
      pending_operation_kind = NULL,
      pending_request_json = NULL,
      pending_request_digest = NULL,
      pending_idempotency_key = NULL,
      pending_staged_at = NULL,
      updated_at = ?,
      removed_at = ?
    WHERE lineage_id = ?`
  ).run(artifactId, removedAt, removedAt, artifact.lineageId);

  return requireMappingByLineage(db, artifact.lineageId);
}

function resolveLineageId(db: MastheadDatabase, artifactId: string): string | undefined {
  const row = db.prepare(
    `SELECT COALESCE(lineage_id, artifact_id) AS lineageId
     FROM session_artifacts
     WHERE artifact_id = ?`
  ).get(artifactId) as { lineageId: string } | undefined;
  return row?.lineageId;
}

function requireArtifactLineage(
  db: MastheadDatabase,
  artifactId: string
): { artifactId: string; lineageId: string } {
  const lineageId = resolveLineageId(db, artifactId);
  if (!lineageId) throw new Error(`masthead_pages_artifact_missing:${artifactId}`);
  return { artifactId, lineageId };
}

function requireMappingByLineage(db: MastheadDatabase, lineageId: string): MastheadPagesReleaseMapping {
  const row = db.prepare(`${MAPPING_SELECT} WHERE lineage_id = ?`).get(lineageId) as MappingRow | undefined;
  if (!row) throw new Error(`masthead_pages_mapping_missing:${lineageId}`);
  return mappingFromRow(row);
}

function mappingFromRow(row: MappingRow): MastheadPagesReleaseMapping {
  return {
    lineageId: row.lineage_id,
    sourceArtifactId: row.source_artifact_id,
    localContentFingerprint: row.local_content_fingerprint,
    pagesAccountId: row.pages_account_id,
    publicLogbookId: row.public_logbook_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.page_id ? { pageId: row.page_id } : {}),
    ...(row.object_id ? { objectId: row.object_id } : {}),
    ...(row.parent_object_id ? { parentObjectId: row.parent_object_id } : {}),
    ...(row.friendly_url ? { friendlyUrl: row.friendly_url } : {}),
    ...(row.exact_url ? { exactUrl: row.exact_url } : {}),
    ...(row.egress_fingerprint ? { egressFingerprint: row.egress_fingerprint } : {}),
    ...(row.last_error_class ? { lastErrorClass: row.last_error_class } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    ...(row.pending_operation_kind ? { pendingOperationKind: row.pending_operation_kind } : {}),
    ...(row.pending_request_json !== null ? { pendingRequestJson: row.pending_request_json } : {}),
    ...(row.pending_request_digest ? { pendingRequestDigest: row.pending_request_digest } : {}),
    ...(row.pending_idempotency_key ? { pendingIdempotencyKey: row.pending_idempotency_key } : {}),
    ...(row.pending_staged_at ? { pendingStagedAt: row.pending_staged_at } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.removed_at ? { removedAt: row.removed_at } : {})
  };
}

function assertTransaction(db: MastheadDatabase): void {
  if (!db.isTransaction) throw new Error("masthead_pages_mapping_transaction_required");
}
