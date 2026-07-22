import { isAbsolute, resolve } from "node:path";
import {
  GUIDED_AUTHORING_IDENTITY_HEADERS,
  GUIDED_AUTHORING_OPERATIONS,
  GUIDED_AUTHORING_POLICY_VERSION,
  type GuidedAuthoringCapabilitiesDto,
  type GuidedAuthoringExpectedIdentity
} from "../shared/guidedAuthoring.ts";
import { normalizeMastheadBaseUrl } from "../shared/instanceIdentity.ts";
import { isAbsoluteAuthoringCommand } from "../shared/workbenchAuthoring.ts";
import {
  approveGuidedCanary,
  buildGuidedDraftScaffold,
  createGuidedRequest,
  finishGuidedAssignment,
  inspectGuidedAssignment,
  listPendingGuidedCanaries,
  rejectGuidedCanary,
  reviewGuidedAssignment,
  saveGuidedDraft,
  startGuidedAssignment
} from "../workbench/authoring/guidedAuthoringService.ts";
import { parseGuidedAuthoringBundleV4 } from "../workbench/authoring/authoringSchemas.ts";
import { getGuidedAuthoringRequest } from "./db/guidedAuthoringRepository.ts";
import type { SessionTranscriptKindFilter } from "./db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

const GUIDED_DRAFT_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const evidenceKinds = new Set<SessionTranscriptKindFilter>([
  "all", "user", "assistant", "tools", "checkpoints", "files", "signals"
]);

export type GuidedAuthoringHttpResult = { status: number; body: unknown };
export type GuidedAuthoringHttpHeaders = Record<string, string | string[] | undefined>;

export type GuidedAuthoringHttpContext = {
  authoringCommand: string;
  db: MastheadDatabase;
  identity: GuidedAuthoringExpectedIdentity;
};

export function guidedAuthoringCapabilities(
  context: GuidedAuthoringHttpContext
): GuidedAuthoringCapabilitiesDto {
  const command = requiredString(context.authoringCommand, "authoring_command_unavailable");
  if (!isAbsoluteAuthoringCommand(command)) throw new Error("authoring_command_unavailable");
  return {
    baseUrl: context.identity.baseUrl,
    buildSha: context.identity.buildSha,
    bundleVersion: "workbench-authoring-v4",
    canarySessions: 3,
    capability: "artifact_authoring",
    command,
    databaseId: context.identity.databaseId,
    instanceId: context.identity.instanceId,
    instanceManifest: context.identity.instanceManifest,
    maxSessionsPerAssignment: 12,
    operations: [...GUIDED_AUTHORING_OPERATIONS],
    policyVersion: GUIDED_AUTHORING_POLICY_VERSION,
    protocol: "masthead.workbench.authoring/v1"
  };
}

export function routeGuidedAuthoringRequest(
  context: GuidedAuthoringHttpContext,
  request: { method: string; url: URL; body?: unknown; headers?: GuidedAuthoringHttpHeaders }
): GuidedAuthoringHttpResult | undefined {
  const { pathname } = request.url;
  if (!isGuidedAuthoringPath(pathname)) return undefined;
  try {
    if (pathname === "/workbench/authoring/requests") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = record(request.body);
      const expectedIdentity = expectedIdentityFromBody(body);
      assertOptionalStableIdentityAliases(body, expectedIdentity);
      return {
        body: createGuidedRequest(context.db, {
          actorId: optionalString(body.actorId) ?? "workbench",
          command: context.authoringCommand,
          currentIdentity: context.identity,
          expectedIdentity,
          sessionIds: stringArray(body.sessionIds, "sessionIds")
        }),
        status: 201
      };
    }

    if (pathname === "/workbench/authoring/canaries/pending") {
      if (request.method !== "GET") return methodNotAllowed();
      return { body: listPendingGuidedCanaries(context.db, { command: context.authoringCommand }), status: 200 };
    }

    const requestMatch = pathname.match(/^\/workbench\/authoring\/requests\/([^/]+)(?:\/(start|canary-decision))?$/);
    if (requestMatch?.[1]) {
      const requestId = decodeSegment(requestMatch[1], "requestId");
      const operation = requestMatch[2];
      if (!operation) {
        if (request.method !== "GET") return methodNotAllowed();
        const guidedRequest = getGuidedAuthoringRequest(context.db, requestId);
        if (!guidedRequest) throw new Error("guided_request_not_found");
        return { body: guidedRequest, status: 200 };
      }
      if (request.method !== "POST") return methodNotAllowed();
      const body = record(request.body);
      const expectedIdentity = expectedIdentityFromBody(body);
      if (operation === "start") {
        return {
          body: startGuidedAssignment(context.db, {
            command: context.authoringCommand,
            currentIdentity: context.identity,
            expectedIdentity,
            requestId
          }),
          status: 200
        };
      }
      const decision = requiredString(body.decision, "decision");
      if (decision !== "approved" && decision !== "rejected") throw invalid("decision must be approved or rejected");
      const input = {
        assignmentId: requiredString(body.assignmentId, "assignmentId"),
        command: context.authoringCommand,
        currentIdentity: context.identity,
        draftRevision: positiveInteger(body.draftRevision, "draftRevision"),
        evidenceRevision: requiredString(body.evidenceRevision, "evidenceRevision"),
        expectedIdentity,
        notes: requiredString(body.notes, "notes"),
        requestId,
        reviewedBy: requiredString(body.reviewedBy, "reviewedBy")
      };
      return {
        body: decision === "approved"
          ? approveGuidedCanary(context.db, input)
          : rejectGuidedCanary(context.db, input),
        status: 200
      };
    }

    const assignmentMatch = pathname.match(/^\/workbench\/authoring\/assignments\/([^/]+)\/(inspect|scaffold|draft|review|finish)$/);
    if (!assignmentMatch?.[1] || !assignmentMatch[2]) return undefined;
    const assignmentId = decodeSegment(assignmentMatch[1], "assignmentId");
    const operation = assignmentMatch[2];
    if (operation === "review") {
      if (request.method !== "GET") return methodNotAllowed();
      return {
        body: reviewGuidedAssignment(context.db, { assignmentId, command: context.authoringCommand }),
        status: 200
      };
    }
    if (operation === "scaffold") {
      if (request.method !== "GET") return methodNotAllowed();
      return { body: buildGuidedDraftScaffold(context.db, { assignmentId, command: context.authoringCommand }), status: 200 };
    }
    if (operation === "inspect") {
      if (request.method !== "GET") return methodNotAllowed();
      return {
        body: inspectGuidedAssignment(context.db, {
          assignmentId,
          command: context.authoringCommand,
          currentIdentity: context.identity,
          expectedIdentity: expectedIdentityFromHeaders(request.headers),
          cursor: optionalQuery(request.url, "cursor"),
          kind: optionalEvidenceKind(request.url.searchParams.get("kind")),
          limit: optionalLimit(request.url.searchParams.get("limit")),
          order: optionalOrder(request.url.searchParams.get("order")),
          query: optionalQuery(request.url, "query") ?? optionalQuery(request.url, "q"),
          sessionId: optionalQuery(request.url, "sessionId")
        }),
        status: 200
      };
    }
    if (request.method !== "POST") return methodNotAllowed();
    const body = record(request.body);
    const expectedIdentity = expectedIdentityFromBody(body);
    if (operation === "draft") {
      return {
        body: saveGuidedDraft(context.db, {
          assignmentId,
          command: context.authoringCommand,
          currentIdentity: context.identity,
          draft: parseGuidedAuthoringBundleV4(body.draft),
          expectedIdentity
        }),
        status: 200
      };
    }
    return {
      body: finishGuidedAssignment(context.db, {
        assignmentId,
        command: context.authoringCommand,
        currentIdentity: context.identity,
        expectedIdentity
      }),
      status: 200
    };
  } catch (error) {
    return guidedAuthoringErrorResult(error);
  }
}

export function isGuidedAuthoringPath(pathname: string): boolean {
  return pathname === "/workbench/authoring/requests" ||
    pathname === "/workbench/authoring/canaries/pending" ||
    /^\/workbench\/authoring\/requests\/[^/]+(?:\/(?:start|canary-decision))?$/.test(pathname) ||
    /^\/workbench\/authoring\/assignments\/[^/]+\/(?:inspect|scaffold|draft|review|finish)$/.test(pathname);
}

export function getGuidedAuthoringBodyLimit(pathname: string, defaultLimitBytes: number): number {
  return /^\/workbench\/authoring\/assignments\/[^/]+\/draft$/.test(pathname)
    ? GUIDED_DRAFT_BODY_LIMIT_BYTES
    : defaultLimitBytes;
}

export function guidedAuthoringErrorResult(error: unknown): GuidedAuthoringHttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(message);
  if (code === "invalid_request" || guidedBadRequestCodes.has(code) ||
      code === "unsupported_authoring_bundle_version" || code === "invalid_guided_authoring_bundle" ||
      code.startsWith("invalid_guided_authoring_bundle_") || code.startsWith("unexpected_guided_authoring_bundle_property")) {
    return failure(400, code, message);
  }
  if (["guided_request_not_found", "guided_assignment_not_found", "session_not_found"].includes(code)) {
    return failure(404, code, message);
  }
  if (code.endsWith("_identity_mismatch") || code.startsWith("guided_") ||
      guidedConflictCodes.has(code) || code === "evidence_revision_changed") {
    return failure(409, code, message);
  }
  return failure(500, "authoring_internal_error", "Workbench authoring request failed");
}

function expectedIdentityFromBody(body: Record<string, unknown>): GuidedAuthoringExpectedIdentity {
  return parseExpectedIdentity(body.expectedIdentity);
}

function expectedIdentityFromHeaders(headers: GuidedAuthoringHttpHeaders | undefined): GuidedAuthoringExpectedIdentity {
  const read = (name: string): string => {
    const value = headers?.[name] ?? headers?.[name.toLowerCase()];
    return requiredString(Array.isArray(value) ? value[0] : value, name);
  };
  return parseExpectedIdentity({
    baseUrl: read(GUIDED_AUTHORING_IDENTITY_HEADERS.baseUrl),
    databaseId: read(GUIDED_AUTHORING_IDENTITY_HEADERS.databaseId),
    buildSha: read(GUIDED_AUTHORING_IDENTITY_HEADERS.buildSha),
    instanceManifest: read(GUIDED_AUTHORING_IDENTITY_HEADERS.instanceManifest),
    instanceId: read(GUIDED_AUTHORING_IDENTITY_HEADERS.instanceId)
  });
}

function parseExpectedIdentity(value: unknown): GuidedAuthoringExpectedIdentity {
  const identity = record(value, "expectedIdentity must be a JSON object");
  let baseUrl: string;
  try {
    baseUrl = normalizeMastheadBaseUrl(requiredString(identity.baseUrl, "expectedIdentity.baseUrl"));
  } catch {
    throw invalid("expectedIdentity.baseUrl is invalid");
  }
  const instanceManifest = requiredString(identity.instanceManifest, "expectedIdentity.instanceManifest");
  if (!isAbsolute(instanceManifest) || resolve(instanceManifest) !== instanceManifest) {
    throw invalid("expectedIdentity.instanceManifest is invalid");
  }
  return {
    baseUrl,
    buildSha: requiredString(identity.buildSha, "expectedIdentity.buildSha"),
    databaseId: requiredString(identity.databaseId, "expectedIdentity.databaseId"),
    instanceId: requiredString(identity.instanceId, "expectedIdentity.instanceId"),
    instanceManifest
  };
}

function assertOptionalStableIdentityAliases(body: Record<string, unknown>, identity: GuidedAuthoringExpectedIdentity): void {
  if (body.databaseId !== undefined && requiredString(body.databaseId, "databaseId") !== identity.databaseId) {
    throw new Error("database_identity_mismatch");
  }
  if (body.buildSha !== undefined && requiredString(body.buildSha, "buildSha") !== identity.buildSha) {
    throw new Error("build_identity_mismatch");
  }
}

function record(value: unknown, message = "request body must be a JSON object"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(message);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid(`${name} must be a non-empty array`);
  return value.map((item) => requiredString(item, `${name}[]`));
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw invalid(`${name} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value, "actorId");
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid(`${name} must be a positive integer`);
  return Number(value);
}

function decodeSegment(value: string, name: string): string {
  try {
    return requiredString(decodeURIComponent(value), name);
  } catch (error) {
    if (error instanceof URIError) throw invalid(`${name} is invalid`);
    throw error;
  }
}

function optionalQuery(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value?.trim() || undefined;
}

function optionalEvidenceKind(value: string | null): SessionTranscriptKindFilter | undefined {
  if (value === null) return undefined;
  if (!evidenceKinds.has(value as SessionTranscriptKindFilter)) throw invalid("kind is invalid");
  return value as SessionTranscriptKindFilter;
}

function optionalOrder(value: string | null): "asc" | "desc" | undefined {
  if (value === null) return undefined;
  if (value !== "asc" && value !== "desc") throw invalid("order must be asc or desc");
  return value;
}

function optionalLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 250) throw invalid("limit must be between 1 and 250");
  return parsed;
}

function methodNotAllowed(): GuidedAuthoringHttpResult {
  return failure(405, "method_not_allowed", "Method not allowed for Workbench authoring route");
}

function invalid(message: string): Error {
  return new Error(`invalid_request:${message}`);
}

function errorCode(message: string): string {
  const separator = message.indexOf(":");
  return (separator < 0 ? message : message.slice(0, separator)) || "authoring_request_failed";
}

function failure(status: number, code: string, message: string): GuidedAuthoringHttpResult {
  return { body: { error: { code, message }, ok: false }, status };
}

const guidedBadRequestCodes = new Set([
  "authoring_session_id_blank",
  "authoring_session_id_duplicate",
  "guided_selection_empty",
  "invalid_canary_decision"
]);

const guidedConflictCodes = new Set([
  "authoring_contract_retired",
  "authoring_session_not_compile_ready",
  "authoring_session_not_on_publish_path",
  "missing_canonical_evidence"
]);
