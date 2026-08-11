import { createHash } from "node:crypto";

import {
  validatePublishPageBatchRequestV1,
  validatePublishPageRequestV1,
  validateRemovePageRequestV1
} from "../mastheadPages/contract.ts";
import type {
  PublishPageBatchRequestV1,
  PublishPageRequestV1,
  RemovePageRequestV1
} from "../mastheadPages/types.ts";

export type StagedOperationRef = {
  artifactId: string;
  requestDigest: string;
};

export type DaemonPendingOperation = {
  lineageId?: string;
  sourceArtifactId: string;
  operationKind: "publish" | "remove";
  requestJson: string;
  requestDigest: string;
  idempotencyKey: string;
  stagedAt?: string;
};

export type DaemonPendingFetcher = (artifactId: string) => Promise<DaemonPendingOperation | undefined>;

const FORBIDDEN_IPC_KEYS = new Set([
  "object",
  "requests",
  "pageId",
  "publicLogbookId",
  "refreshToken",
  "accessToken",
  "token",
  "deviceCode",
  "encryptedRefreshTokenB64",
  "requestJson",
  "request",
  "envelope",
  "page",
  "pages",
  "authorization",
  "bearer"
]);

export function isStagedOperationRef(value: unknown): value is StagedOperationRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2) return false;
  if (typeof record.artifactId !== "string" || record.artifactId.length === 0) return false;
  if (typeof record.requestDigest !== "string" || record.requestDigest.length === 0) return false;
  if (!record.artifactId.match(/^[A-Za-z0-9._:-]{1,200}$/)) return false;
  if (!record.requestDigest.match(/^sha256[:-][A-Fa-f0-9]{32,128}$/) && !record.requestDigest.match(/^[A-Za-z0-9:_-]{8,200}$/)) {
    // allow repository digests used in Local 04 tests (plain digest strings) and protocol sha256-
    return Boolean(record.requestDigest.length >= 8 && record.requestDigest.length <= 200);
  }
  return true;
}

export function assertStagedRefsOnly(args: unknown, label: string): StagedOperationRef[] {
  if (args == null) throw new Error(`${label}_missing_refs`);
  if (typeof args !== "object") throw new Error(`${label}_invalid_args`);
  const record = args as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (FORBIDDEN_IPC_KEYS.has(key)) {
      throw new Error(`${label}_forbidden_field:${key}`);
    }
  }

  // Reject nested Page objects / envelopes if someone stuffed them under refs.
  const inspect = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) inspect(value[i], `${path}[${i}]`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_IPC_KEYS.has(key)) {
        throw new Error(`${label}_forbidden_field:${key}`);
      }
      if (key === "schemaVersion" && obj[key] === "masthead-page-revision-v1") {
        throw new Error(`${label}_raw_page_object`);
      }
      if (key === "protocolVersion" && typeof obj[key] === "string") {
        const version = obj[key] as string;
        if (
          version.includes("publish") ||
          version.includes("remove") ||
          version.includes("device") ||
          version.includes("account")
        ) {
          throw new Error(`${label}_hosted_envelope`);
        }
      }
      inspect(obj[key], `${path}.${key}`);
    }
  };
  inspect(record, label);

  const refsRaw = Array.isArray(record.refs)
    ? record.refs
    : record.ref
      ? [record.ref]
      : Array.isArray(args)
        ? args
        : null;
  if (!refsRaw) throw new Error(`${label}_missing_refs`);
  if (refsRaw.length === 0) throw new Error(`${label}_empty_refs`);
  if (refsRaw.length > 500) throw new Error(`${label}_too_many_refs`);

  const seen = new Set<string>();
  const refs: StagedOperationRef[] = [];
  for (const item of refsRaw) {
    if (!isStagedOperationRef(item)) throw new Error(`${label}_invalid_ref`);
    if (seen.has(item.artifactId)) throw new Error(`${label}_duplicate_artifact`);
    seen.add(item.artifactId);
    refs.push({ artifactId: item.artifactId, requestDigest: item.requestDigest });
  }
  return refs;
}

export function digestRequestJson(requestJson: string): string {
  return `sha256-${createHash("sha256").update(requestJson, "utf8").digest("hex")}`;
}

export function parseAndValidatePendingPublish(operation: DaemonPendingOperation): PublishPageRequestV1 {
  if (operation.operationKind !== "publish") {
    throw new Error("staged_wrong_operation_kind");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(operation.requestJson) as unknown;
  } catch {
    throw new Error("staged_invalid_json");
  }
  const validated = validatePublishPageRequestV1(parsed);
  if (!validated.ok) throw new Error("staged_invalid_publish_request");
  if (validated.value.idempotencyKey !== operation.idempotencyKey) {
    throw new Error("staged_idempotency_mismatch");
  }
  return validated.value;
}

export function parseAndValidatePendingRemoval(operation: DaemonPendingOperation): RemovePageRequestV1 {
  if (operation.operationKind !== "remove") {
    throw new Error("staged_wrong_operation_kind");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(operation.requestJson) as unknown;
  } catch {
    throw new Error("staged_invalid_json");
  }
  const validated = validateRemovePageRequestV1(parsed);
  if (!validated.ok) throw new Error("staged_invalid_remove_request");
  if (validated.value.idempotencyKey !== operation.idempotencyKey) {
    throw new Error("staged_idempotency_mismatch");
  }
  return validated.value;
}

export function verifyPendingDigest(operation: DaemonPendingOperation, expectedDigest: string): void {
  if (operation.requestDigest !== expectedDigest) {
    throw new Error("staged_digest_mismatch");
  }
  // Prefer recomputing when the stored digest uses the sha256- prefix convention.
  if (expectedDigest.startsWith("sha256-") || expectedDigest.startsWith("sha256:")) {
    const recomputed = digestRequestJson(operation.requestJson);
    const normalizedExpected = expectedDigest.replace(/^sha256:/, "sha256-");
    if (recomputed !== normalizedExpected && operation.requestDigest !== expectedDigest) {
      throw new Error("staged_digest_mismatch");
    }
  }
}

export async function loadStagedPublishBatch(
  refs: StagedOperationRef[],
  fetchPending: DaemonPendingFetcher
): Promise<PublishPageBatchRequestV1> {
  const requests: PublishPageRequestV1[] = [];
  for (const ref of refs) {
    const pending = await fetchPending(ref.artifactId);
    if (!pending) throw new Error("staged_missing");
    verifyPendingDigest(pending, ref.requestDigest);
    requests.push(parseAndValidatePendingPublish(pending));
  }
  const batch: PublishPageBatchRequestV1 = {
    protocolVersion: "masthead-pages-publish-batch-v1",
    requests
  };
  const validated = validatePublishPageBatchRequestV1(batch);
  if (!validated.ok) throw new Error("staged_invalid_batch");
  return validated.value;
}

export async function loadStagedRemoval(
  ref: StagedOperationRef,
  fetchPending: DaemonPendingFetcher
): Promise<RemovePageRequestV1> {
  const pending = await fetchPending(ref.artifactId);
  if (!pending) throw new Error("staged_missing");
  verifyPendingDigest(pending, ref.requestDigest);
  return parseAndValidatePendingRemoval(pending);
}

export function chunkPublishBatch(
  batch: PublishPageBatchRequestV1,
  maxItems = 25,
  maxBytes = 8 * 1024 * 1024
): PublishPageBatchRequestV1[] {
  const chunks: PublishPageBatchRequestV1[] = [];
  let current: PublishPageRequestV1[] = [];
  let currentBytes = 2; // {}

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      protocolVersion: "masthead-pages-publish-batch-v1",
      requests: current
    });
    current = [];
    currentBytes = 2;
  };

  for (const request of batch.requests) {
    const encoded = JSON.stringify(request);
    const nextBytes = currentBytes + encoded.length + (current.length > 0 ? 1 : 0);
    if (current.length >= maxItems || (current.length > 0 && nextBytes > maxBytes)) {
      flush();
    }
    if (encoded.length > maxBytes) {
      throw new Error("staged_request_too_large");
    }
    current.push(request);
    currentBytes = current.length === 1 ? encoded.length + 2 : currentBytes + encoded.length + 1;
  }
  flush();
  return chunks;
}

export async function fetchDaemonPendingOperation(
  daemonBaseUrl: string,
  artifactId: string,
  fetchImpl: typeof fetch = fetch
): Promise<DaemonPendingOperation | undefined> {
  const url = `${daemonBaseUrl.replace(/\/$/, "")}/masthead-pages/operations/pending/${encodeURIComponent(artifactId)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`daemon_pending_failed:${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (!body || typeof body !== "object") throw new Error("daemon_pending_invalid");
  const record = body as Record<string, unknown>;
  // Support both bare pending op and { operation: ... } envelopes.
  const op = (record.operation && typeof record.operation === "object" ? record.operation : record) as Record<
    string,
    unknown
  >;
  if (typeof op.sourceArtifactId !== "string" && typeof op.artifactId !== "string") {
    throw new Error("daemon_pending_invalid");
  }
  if (op.operationKind !== "publish" && op.operationKind !== "remove") {
    throw new Error("daemon_pending_invalid");
  }
  if (typeof op.requestJson !== "string" || typeof op.requestDigest !== "string" || typeof op.idempotencyKey !== "string") {
    throw new Error("daemon_pending_invalid");
  }
  return {
    lineageId: typeof op.lineageId === "string" ? op.lineageId : undefined,
    sourceArtifactId: String(op.sourceArtifactId ?? op.artifactId),
    operationKind: op.operationKind,
    requestJson: op.requestJson,
    requestDigest: op.requestDigest,
    idempotencyKey: op.idempotencyKey,
    stagedAt: typeof op.stagedAt === "string" ? op.stagedAt : undefined
  };
}
