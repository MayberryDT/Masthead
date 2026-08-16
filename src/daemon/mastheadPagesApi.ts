import { createHash, randomUUID } from "node:crypto";

import { validateRemovePageRequestV1 } from "../mastheadPages/contract.ts";
import { EvidenceSelectionError, resolvePublicEvidenceCandidates } from "../mastheadPages/evidence.ts";
import { checkSessionDossierEligibility, type EligibilityReason } from "../mastheadPages/eligibility.ts";
import { scanPageEgress, type EgressFinding } from "../mastheadPages/egressPreflight.ts";
import { projectSessionDossier, ProjectionError } from "../mastheadPages/publicProjection.ts";
import { finalizePageReview, sha256CanonicalRequest } from "../mastheadPages/review.ts";
import type {
  EvidenceItemV1,
  EvidenceSupport,
  ObjectId,
  PageLicense,
  PageRevisionV1,
  PublishPageRequestV1,
  RemovePageRequestV1,
  SourceLinkV1
} from "../mastheadPages/types.ts";
import type { PublishedSessionDossierV1 } from "../shared/sessionDossier.ts";
import type {
  MastheadPagesSelectionResolverMode,
  ResolveMastheadPagesSelectionResult
} from "../mastheadPages/selection.ts";
import { getAuthoringValidationEvidenceByRef } from "../workbench/authoring/evidenceCatalog.ts";
import {
  getLogbookArtifactDetail,
  listEligibleMastheadPagesArtifactIds,
  type LogbookArtifactDetailDto,
  type LogbookArtifactSearchQuery
} from "./db/logbookArtifactRepository.ts";
import { resolveMaterializedMastheadPagesSelection } from "./db/mastheadPagesEligibilityRepository.ts";
import {
  getMastheadPagesMapping,
  getPendingMastheadPagesOperation,
  markMastheadPagesRemoved,
  recordMastheadPagesFailure,
  recordMastheadPagesPublication,
  stageMastheadPagesPublication,
  stageMastheadPagesRemoval,
  type MastheadPagesFailureRecord,
  type MastheadPagesPendingOperation,
  type MastheadPagesPublicationReceipt,
  type MastheadPagesReleaseMapping
} from "./db/mastheadPagesRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

export const MASTHEAD_PAGES_MAX_ARTIFACT_IDS = 500;
export const MASTHEAD_PAGES_BODY_LIMIT_BYTES = 1_048_576;
const GENERATOR_VERSION_FALLBACK = "0.1.15";

export function migrateLegacyPendingRemovalDigests(db: MastheadDatabase): number {
  const rows = db.prepare(
    `SELECT lineage_id AS lineageId,
            pending_request_json AS requestJson,
            pending_request_digest AS requestDigest,
            pending_idempotency_key AS idempotencyKey
     FROM masthead_pages_release_mappings
     WHERE pending_operation_kind = 'remove'`
  ).all() as Array<{
    lineageId: string;
    requestJson: string;
    requestDigest: string;
    idempotencyKey: string;
  }>;
  let migrated = 0;
  for (const row of rows) {
    const legacyDigest = `sha256-${createHash("sha256").update(row.requestJson, "utf8").digest("hex")}`;
    if (row.requestDigest !== legacyDigest) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.requestJson) as unknown;
    } catch {
      continue;
    }
    const validated = validateRemovePageRequestV1(parsed);
    if (!validated.ok || validated.value.idempotencyKey !== row.idempotencyKey) continue;
    const canonicalDigest = sha256CanonicalRequest(validated.value);
    if (canonicalDigest === row.requestDigest) continue;
    const result = db.prepare(
      `UPDATE masthead_pages_release_mappings
       SET pending_request_digest = ?, updated_at = ?
       WHERE lineage_id = ?
         AND pending_operation_kind = 'remove'
         AND pending_request_json = ?
         AND pending_request_digest = ?`
    ).run(canonicalDigest, new Date().toISOString(), row.lineageId, row.requestJson, row.requestDigest);
    migrated += Number(result.changes);
  }
  return migrated;
}

const FORBIDDEN_RENDERER_ENVELOPE_KEYS = new Set([
  "object",
  "request",
  "requests",
  "requestJson",
  "envelope",
  "page",
  "pages",
  "protocolVersion",
  "objectId",
  "pageId",
  "refreshToken",
  "accessToken",
  "token",
  "authorization",
  "bearer",
  "deviceCode"
]);

export type PublicEvidenceCandidate = {
  ref: string;
  kind: string;
  role: string;
  text: string;
  observedAt: string;
  label?: string;
  lowValue: boolean;
  toolName?: string;
};

export type PreparedPageReview = {
  artifactId: string;
  eligibility: "eligible" | "ineligible";
  ineligibilityReason?: EligibilityReason | "artifact_not_found";
  baseObject?: PageRevisionV1;
  evidenceCandidates: PublicEvidenceCandidate[];
  findings: EgressFinding[];
  existingRelease?: MastheadPagesReleaseMapping;
  contentFingerprint?: string;
  lineageId?: string;
  title?: string;
};

export type DaemonFinalizedPageReview = {
  artifactId: string;
  decision: "ready" | "needs_review" | "blocked";
  findings: EgressFinding[];
  request?: PublishPageRequestV1;
  requestDigest?: ObjectId;
  staged: boolean;
  existingRelease?: MastheadPagesReleaseMapping;
};

export type MastheadPagesHttpResult = { status: number; body: unknown };

export type MastheadPagesHttpContext = {
  db: MastheadDatabase;
  generatorVersion?: string;
  selectionResolverMode?: MastheadPagesSelectionResolverMode;
};

export function isMastheadPagesPath(pathname: string): boolean {
  return (
    pathname === "/masthead-pages/reviews/prepare" ||
    pathname === "/masthead-pages/reviews/finalize" ||
    pathname === "/masthead-pages/selection/resolve" ||
    pathname === "/masthead-pages/selection/materialized/resolve" ||
    pathname === "/masthead-pages/operations/removal/stage" ||
    pathname === "/masthead-pages/publications/record" ||
    pathname === "/masthead-pages/failures/record" ||
    /^\/masthead-pages\/operations\/pending\/[^/]+$/.test(pathname)
  );
}

export function getMastheadPagesBodyLimit(_pathname: string, defaultLimitBytes: number): number {
  return Math.max(defaultLimitBytes, MASTHEAD_PAGES_BODY_LIMIT_BYTES);
}

export function mastheadPagesInvalidJsonResult(error: unknown): MastheadPagesHttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.startsWith("Request body exceeds") ? "request_body_too_large" : "invalid_json";
  return { status: 400, body: { ok: false, error: { code, message } } };
}

export function routeMastheadPagesRequest(
  context: MastheadPagesHttpContext,
  request: { method: string; url: URL; body?: unknown }
): MastheadPagesHttpResult | undefined {
  const { pathname } = request.url;
  if (!isMastheadPagesPath(pathname)) return undefined;

  try {
    if (pathname === "/masthead-pages/reviews/prepare") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: prepareReviews(context, request.body) };
    }

    if (pathname === "/masthead-pages/reviews/finalize") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: finalizeReviews(context, request.body) };
    }

    if (pathname === "/masthead-pages/selection/resolve") {
      if (request.method !== "POST") return methodNotAllowed();
      const body =
        context.selectionResolverMode === "materialized"
          ? resolveMaterializedSelection(context, request.body)
          : resolveSelection(context, request.body);
      return { status: 200, body };
    }

    if (pathname === "/masthead-pages/selection/materialized/resolve") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: resolveMaterializedSelection(context, request.body) };
    }

    if (pathname === "/masthead-pages/operations/removal/stage") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: stageRemoval(context, request.body) };
    }

    if (pathname === "/masthead-pages/publications/record") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: recordPublication(context, request.body) };
    }

    if (pathname === "/masthead-pages/failures/record") {
      if (request.method !== "POST") return methodNotAllowed();
      return { status: 200, body: recordFailure(context, request.body) };
    }

    const pendingMatch = pathname.match(/^\/masthead-pages\/operations\/pending\/([^/]+)$/);
    if (pendingMatch?.[1]) {
      if (request.method !== "GET") return methodNotAllowed();
      const artifactId = decodeURIComponent(pendingMatch[1]);
      const pending = getPendingMastheadPagesOperation(context.db, artifactId);
      if (!pending) {
        return { status: 404, body: { ok: false, error: { code: "pending_operation_not_found", message: "No staged operation" } } };
      }
      return { status: 200, body: { ok: true, operation: pending } };
    }

    return undefined;
  } catch (error) {
    return mastheadPagesErrorResult(error);
  }
}

function prepareReviews(context: MastheadPagesHttpContext, body: unknown): {
  ok: true;
  items: PreparedPageReview[];
} {
  assertNoRendererEnvelope(body, "prepare");
  const record = asRecord(body);
  const artifactIds = stringArray(record.artifactIds, "artifactIds");
  assertArtifactIdLimit(artifactIds);

  const items = artifactIds.map((artifactId) => prepareOne(context, artifactId));
  return { ok: true, items };
}

function prepareOne(context: MastheadPagesHttpContext, artifactId: string): PreparedPageReview {
  const detail = getLogbookArtifactDetail(context.db, artifactId);
  if (!detail) {
    return {
      artifactId,
      eligibility: "ineligible",
      ineligibilityReason: "artifact_not_found",
      evidenceCandidates: [],
      findings: []
    };
  }

  const dossier = asDossier(detail.body);
  const eligibility = checkSessionDossierEligibility({
    artifactKind: detail.capsule.kind,
    status: detail.status,
    publicationStatus: detail.publicationStatus,
    schemaVersion: detail.schemaVersion,
    content: dossier,
    provenanceSessionIds: detail.provenanceSessionIds
  });

  const existingRelease = getMastheadPagesMapping(context.db, artifactId);
  if (!eligibility.eligible) {
    return {
      artifactId,
      eligibility: "ineligible",
      ineligibilityReason: eligibility.reason,
      evidenceCandidates: [],
      findings: [],
      existingRelease,
      contentFingerprint: detail.contentFingerprint,
      lineageId: detail.lineageId,
      title: detail.capsule.title
    };
  }

  const sessionId = detail.provenanceSessionIds[0]!;
  const evidenceCandidates = listEvidenceCandidates(context.db, sessionId);
  let baseObject: PageRevisionV1 | undefined;
  let findings: EgressFinding[] = [];
  try {
    baseObject = projectSessionDossier({
      dossier,
      license: "all-rights-reserved",
      generatorVersion: generatorVersion(context),
      evidence: []
    });
    findings = scanPageEgress(baseObject).findings;
  } catch (error) {
    if (error instanceof ProjectionError) {
      findings = [
        {
          severity: "block",
          code: error.code,
          path: "object",
          message: error.message
        }
      ];
    } else {
      throw error;
    }
  }

  return {
    artifactId,
    eligibility: "eligible",
    baseObject,
    evidenceCandidates,
    findings,
    existingRelease,
    contentFingerprint: detail.contentFingerprint,
    lineageId: detail.lineageId,
    title: detail.capsule.title
  };
}

function finalizeReviews(context: MastheadPagesHttpContext, body: unknown): {
  ok: true;
  items: DaemonFinalizedPageReview[];
} {
  assertNoRendererEnvelope(body, "finalize");
  const record = asRecord(body);
  const rawItems = record.items;
  if (!Array.isArray(rawItems)) throw clientError("invalid_request", "items must be an array");
  if (rawItems.length === 0) throw clientError("invalid_request", "items must not be empty");
  assertArtifactIdLimit(rawItems.map((item) => {
    const row = asRecord(item);
    return requiredString(row.artifactId, "artifactId");
  }));

  const items = rawItems.map((item) => finalizeOne(context, item));
  return { ok: true, items };
}

function finalizeOne(context: MastheadPagesHttpContext, raw: unknown): DaemonFinalizedPageReview {
  assertNoRendererEnvelope(raw, "finalize_item");
  const input = asRecord(raw);
  const artifactId = requiredString(input.artifactId, "artifactId");
  const detail = requireEligibleDetail(context.db, artifactId);
  const dossier = asDossier(detail.body);
  const sessionId = detail.provenanceSessionIds[0]!;
  const publicLogbookId = requiredString(input.publicLogbookId, "publicLogbookId");
  const pagesAccountId = requiredString(input.pagesAccountId, "pagesAccountId");
  const slug = requiredString(input.slug, "slug");
  const license = parseLicense(input.license);
  const idempotencyKey =
    optionalString(input.idempotencyKey) ?? randomUUID();
  const acknowledgeWarnings = input.acknowledgeWarnings === true;
  const selections = parseEvidenceSelections(input.evidenceSelections ?? input.selectedEvidence);
  const evidenceByRef = getAuthoringValidationEvidenceByRef(context.db, [sessionId]);
  let evidence: EvidenceItemV1[];
  try {
    evidence = resolvePublicEvidenceCandidates(evidenceByRef, { sessionId, selections });
  } catch (error) {
    if (error instanceof EvidenceSelectionError) {
      throw clientError(error.code, error.message);
    }
    throw error;
  }

  const existingRelease = getMastheadPagesMapping(context.db, artifactId);
  const finalized = finalizePageReview({
    dossier,
    license,
    generatorVersion: generatorVersion(context),
    evidence,
    sourceLinks: parseSourceLinks(input.sourceLinks),
    topics: optionalStringArray(input.topics),
    technologies: optionalStringArray(input.technologies),
    includeSourceDate: input.includeSourceDate === true,
    publicLogbookId,
    slug,
    idempotencyKey,
    pageId: existingRelease?.pageId,
    expectedParentObjectId: existingRelease?.objectId as ObjectId | undefined
  });

  const shouldStage =
    finalized.decision === "ready" || (finalized.decision === "needs_review" && acknowledgeWarnings);

  let staged = false;
  let mapping = existingRelease;
  if (shouldStage) {
    const requestJson = JSON.stringify(finalized.request);
    mapping = stageMastheadPagesPublication(context.db, {
      artifactId,
      pagesAccountId,
      publicLogbookId,
      localContentFingerprint: detail.contentFingerprint,
      egressFingerprint: finalized.requestDigest,
      requestJson,
      requestDigest: finalized.requestDigest,
      idempotencyKey: finalized.request.idempotencyKey
    });
    staged = true;
  }

  return {
    artifactId,
    decision: finalized.decision,
    findings: finalized.findings,
    request: finalized.request,
    requestDigest: finalized.requestDigest,
    staged,
    existingRelease: mapping
  };
}

function resolveSelection(
  context: MastheadPagesHttpContext,
  body: unknown
): { ok: true; artifactIds: string[] } {
  const { limit, query } = selectionQuery(body);
  // Local 19 owns the read cutover and may return the discriminated result only
  // after shadow parity proves that the materialized resolver is complete.
  const artifactIds = listEligibleMastheadPagesArtifactIds(context.db, query, limit);
  return { ok: true, artifactIds };
}

function resolveMaterializedSelection(
  context: MastheadPagesHttpContext,
  body: unknown
): { ok: true } & ResolveMastheadPagesSelectionResult {
  const { limit, query } = selectionQuery(body);
  return { ok: true, ...resolveMaterializedMastheadPagesSelection(context.db, query, limit) };
}

function selectionQuery(body: unknown): {
  limit: number;
  query: LogbookArtifactSearchQuery;
} {
  assertNoRendererEnvelope(body, "selection");
  const record = asRecord(body ?? {});
  const limitRaw = record.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(MASTHEAD_PAGES_MAX_ARTIFACT_IDS, Math.trunc(limitRaw)))
      : MASTHEAD_PAGES_MAX_ARTIFACT_IDS;
  return {
    limit,
    query: {
      q: optionalString(record.q) ?? optionalString(record.query),
      project: optionalString(record.project),
      dateFrom: optionalString(record.dateFrom),
      dateTo: optionalString(record.dateTo),
      kind: "session_dossier",
      limit
    }
  };
}

function stageRemoval(context: MastheadPagesHttpContext, body: unknown): {
  ok: true;
  artifactId: string;
  requestDigest: ObjectId;
  operation: MastheadPagesPendingOperation;
  mapping: MastheadPagesReleaseMapping;
} {
  assertNoRendererEnvelope(body, "removal");
  const record = asRecord(body);
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "artifactId") {
    throw clientError("invalid_request", "removal staging accepts only artifactId");
  }
  const artifactId = requiredString(record.artifactId, "artifactId");
  const mapping = getMastheadPagesMapping(context.db, artifactId);
  if (!mapping?.pageId) {
    throw clientError("mapping_missing_page", "No live Masthead Pages mapping with pageId");
  }
  const idempotencyKey = randomUUID();
  const request: RemovePageRequestV1 = {
    protocolVersion: "masthead-pages-remove-v1",
    pageId: mapping.pageId,
    idempotencyKey
  };
  const requestJson = JSON.stringify(request);
  const requestDigest = sha256CanonicalRequest(request);
  const updated = stageMastheadPagesRemoval(context.db, {
    artifactId,
    requestJson,
    requestDigest,
    idempotencyKey
  });
  const operation = getPendingMastheadPagesOperation(context.db, artifactId);
  if (!operation) throw new Error("staged_removal_missing");
  return { ok: true, artifactId, requestDigest, operation, mapping: updated };
}

function recordPublication(context: MastheadPagesHttpContext, body: unknown): {
  ok: true;
  mapping: MastheadPagesReleaseMapping;
} {
  assertNoRendererEnvelope(body, "publication_record", { allowReceiptFields: true });
  const record = asRecord(body);
  const receipt: MastheadPagesPublicationReceipt = {
    artifactId: requiredString(record.artifactId, "artifactId"),
    pageId: requiredString(record.pageId, "pageId"),
    objectId: requiredString(record.objectId, "objectId"),
    parentObjectId: optionalString(record.parentObjectId),
    pagesAccountId: requiredString(record.pagesAccountId, "pagesAccountId"),
    publicLogbookId: requiredString(record.publicLogbookId, "publicLogbookId"),
    localContentFingerprint: requiredString(record.localContentFingerprint, "localContentFingerprint"),
    egressFingerprint: requiredString(record.egressFingerprint, "egressFingerprint"),
    friendlyUrl: requiredString(record.friendlyUrl, "friendlyUrl"),
    exactUrl: requiredString(record.exactUrl, "exactUrl"),
    publishedAt: requiredString(record.publishedAt, "publishedAt")
  };
  const mapping = recordMastheadPagesPublication(context.db, receipt);
  return { ok: true, mapping };
}

function recordFailure(context: MastheadPagesHttpContext, body: unknown): {
  ok: true;
  mapping: MastheadPagesReleaseMapping;
  removed?: boolean;
} {
  assertNoRendererEnvelope(body, "failure_record", { allowReceiptFields: true });
  const record = asRecord(body);
  const artifactId = requiredString(record.artifactId, "artifactId");
  if (record.kind === "removed" || record.status === "removed") {
    const removedAt = optionalString(record.removedAt) ?? new Date().toISOString();
    const mapping = markMastheadPagesRemoved(context.db, artifactId, removedAt);
    return { ok: true, mapping, removed: true };
  }
  const failure: MastheadPagesFailureRecord = {
    errorClass: requiredString(record.errorClass, "errorClass"),
    message: requiredString(record.message, "message"),
    retryable: record.retryable === true,
    recordedAt: optionalString(record.recordedAt),
    currentObjectId: optionalString(record.currentObjectId)
  };
  const mapping = recordMastheadPagesFailure(context.db, artifactId, failure);
  return { ok: true, mapping };
}

function requireEligibleDetail(db: MastheadDatabase, artifactId: string): LogbookArtifactDetailDto {
  const detail = getLogbookArtifactDetail(db, artifactId);
  if (!detail) throw clientError("artifact_not_found", "Artifact is not a current published Logbook Page");
  const dossier = asDossier(detail.body);
  const eligibility = checkSessionDossierEligibility({
    artifactKind: detail.capsule.kind,
    status: detail.status,
    publicationStatus: detail.publicationStatus,
    schemaVersion: detail.schemaVersion,
    content: dossier,
    provenanceSessionIds: detail.provenanceSessionIds
  });
  if (!eligibility.eligible) {
    throw clientError(eligibility.reason, `Artifact is not eligible: ${eligibility.reason}`);
  }
  return detail;
}

function listEvidenceCandidates(db: MastheadDatabase, sessionId: string): PublicEvidenceCandidate[] {
  const byRef = getAuthoringValidationEvidenceByRef(db, [sessionId]);
  return [...byRef.entries()]
    .map(([ref, item]) => ({
      ref,
      kind: item.kind,
      role: item.role,
      text: item.text,
      observedAt: item.observedAt,
      label: item.label,
      lowValue: item.lowValue,
      toolName: item.toolName
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

function asDossier(body: unknown): PublishedSessionDossierV1 {
  if (!body || typeof body !== "object") {
    throw clientError("invalid_dossier", "Artifact body is not a session dossier object");
  }
  return body as PublishedSessionDossierV1;
}

function parseEvidenceSelections(value: unknown): Array<{
  ref: string;
  kind: EvidenceItemV1["kind"];
  label: string;
  supports: EvidenceSupport[];
}> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw clientError("invalid_request", "evidenceSelections must be an array");
  return value.map((entry, index) => {
    const row = asRecord(entry);
    const ref = requiredString(row.ref, `evidenceSelections[${index}].ref`);
    const kindRaw = requiredString(row.kind, `evidenceSelections[${index}].kind`);
    if (kindRaw !== "excerpt" && kindRaw !== "verification") {
      throw clientError("evidence_kind_invalid", "Evidence kind must be excerpt or verification");
    }
    const label = requiredString(row.label, `evidenceSelections[${index}].label`);
    const supportsRaw = row.supports;
    if (!Array.isArray(supportsRaw) || supportsRaw.length === 0) {
      throw clientError("evidence_support_invalid", "Evidence must support one or more public sections");
    }
    const supports = supportsRaw.map((item) => String(item)) as EvidenceSupport[];
    return { ref, kind: kindRaw, label, supports };
  });
}

function parseSourceLinks(value: unknown): SourceLinkV1[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw clientError("invalid_request", "sourceLinks must be an array");
  return value.map((entry, index) => {
    const row = asRecord(entry);
    const rel = requiredString(row.rel, `sourceLinks[${index}].rel`);
    if (rel !== "repository" && rel !== "commit") {
      throw clientError("invalid_source_link", "sourceLinks rel must be repository or commit");
    }
    return {
      rel,
      label: requiredString(row.label, `sourceLinks[${index}].label`),
      url: requiredString(row.url, `sourceLinks[${index}].url`)
    };
  });
}

function parseLicense(value: unknown): PageLicense {
  const license = requiredString(value, "license");
  if (license !== "all-rights-reserved" && license !== "cc-by-4.0") {
    throw clientError("invalid_license", "license must be all-rights-reserved or cc-by-4.0");
  }
  return license;
}

function generatorVersion(context: MastheadPagesHttpContext): string {
  return context.generatorVersion?.trim() || GENERATOR_VERSION_FALLBACK;
}

function assertArtifactIdLimit(ids: string[]): void {
  if (ids.length > MASTHEAD_PAGES_MAX_ARTIFACT_IDS) {
    throw clientError("too_many_artifact_ids", `At most ${MASTHEAD_PAGES_MAX_ARTIFACT_IDS} artifact IDs are allowed`);
  }
  if (ids.length === 0) {
    throw clientError("invalid_request", "artifactIds must not be empty");
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) throw clientError("invalid_request", "artifactIds must be non-empty strings");
    if (seen.has(id)) throw clientError("duplicate_artifact_id", `Duplicate artifact id: ${id}`);
    seen.add(id);
  }
}

function assertNoRendererEnvelope(
  value: unknown,
  label: string,
  options: { allowReceiptFields?: boolean } = {}
): void {
  const allowedReceipt = new Set([
    "pageId",
    "objectId",
    "parentObjectId",
    "currentObjectId"
  ]);
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) walk(node[i], `${path}[${i}]`);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_RENDERER_ENVELOPE_KEYS.has(key)) {
        if (options.allowReceiptFields && allowedReceipt.has(key)) {
          continue;
        }
        throw clientError("renderer_envelope_rejected", `${label} rejects renderer-supplied field ${key}`);
      }
      if (key === "schemaVersion" && record[key] === "masthead-page-revision-v1") {
        throw clientError("renderer_envelope_rejected", `${label} rejects prebuilt Page objects`);
      }
      walk(record[key], `${path}.${key}`);
    }
  };
  walk(value, label);
}

function mastheadPagesErrorResult(error: unknown): MastheadPagesHttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof ClientError
      ? error.code
      : message.startsWith("masthead_pages_")
        ? message
        : "invalid_request";
  const status =
    code === "artifact_not_found" || code === "pending_operation_not_found"
      ? 404
      : code === "mapping_missing_page" || code === "masthead_pages_mapping_missing_page"
        ? 409
        : 400;
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message
      }
    }
  };
}

class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ClientError";
  }
}

function clientError(code: string, message: string): ClientError {
  return new ClientError(code, message);
}

function methodNotAllowed(): MastheadPagesHttpResult {
  return { status: 405, body: { ok: false, error: { code: "method_not_allowed", message: "Method not allowed" } } };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("invalid_request", "Expected a JSON object body");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("invalid_request", `${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw clientError("invalid_request", "Expected a string array");
  return value.map((item, index) => {
    if (typeof item !== "string") throw clientError("invalid_request", `Expected string at index ${index}`);
    return item;
  });
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw clientError("invalid_request", `${field} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw clientError("invalid_request", `${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

// Re-export digest helper for tests that assert stability without importing review internals.
export { sha256CanonicalRequest };
