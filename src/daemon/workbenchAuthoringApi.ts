import type { SessionTranscriptOrder } from "../shared/sessionTranscript.ts";
import {
  getAuthoringRunContext,
  getAuthoringRunEvidence,
  getAuthoringRunStatus
} from "../workbench/authoring/authoringService.ts";
import type { SessionTranscriptKindFilter } from "./db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import type { GuidedAuthoringExpectedIdentity } from "../shared/instanceIdentity.ts";
import {
  getGuidedAuthoringBodyLimit,
  isGuidedAuthoringPath,
  routeGuidedAuthoringRequest,
  type GuidedAuthoringHttpHeaders
} from "./guidedAuthoringApi.ts";
import {
  getWorkbenchAuthoringV5BodyLimit,
  isWorkbenchAuthoringV5Path,
  routeWorkbenchAuthoringV5Request,
  workbenchAuthoringV5Capabilities
} from "./workbenchAuthoringV5Api.ts";

const SUBMIT_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const evidenceKinds = new Set<SessionTranscriptKindFilter>([
  "all",
  "user",
  "assistant",
  "tools",
  "checkpoints",
  "files",
  "signals"
]);

export type WorkbenchAuthoringHttpResult = {
  status: number;
  body: unknown;
};

export async function routeWorkbenchAuthoringRequest(
  context: { authoringCommand: string; db: MastheadDatabase; identity?: GuidedAuthoringExpectedIdentity },
  request: { method: string; url: URL; body?: unknown; headers?: GuidedAuthoringHttpHeaders }
): Promise<WorkbenchAuthoringHttpResult | undefined> {
  const { pathname } = request.url;
  if (!isWorkbenchAuthoringPath(pathname)) return undefined;

  try {
    if (pathname === "/workbench/authoring/capabilities") {
      if (request.method !== "GET") return methodNotAllowed();
      if (!context.identity) throw new Error("authoring_identity_unavailable");
      return { body: workbenchAuthoringV5Capabilities({ ...context, identity: context.identity }), status: 200 };
    }

    if (isWorkbenchAuthoringV5Path(pathname)) {
      if (!context.identity) throw new Error("authoring_identity_unavailable");
      return routeWorkbenchAuthoringV5Request({ ...context, identity: context.identity }, request);
    }

    if (isGuidedAuthoringPath(pathname)) {
      if (!context.identity) throw new Error("authoring_identity_unavailable");
      if (isRetiredGuidedMutation(request.method, pathname)) return retiredContract();
      return routeGuidedAuthoringRequest({ ...context, identity: context.identity }, request);
    }

    if (pathname === "/workbench/authoring/suggestions") {
      if (request.method !== "POST") return methodNotAllowed();
      return retiredContract();
    }

    if (pathname === "/workbench/authoring/runs") {
      if (request.method !== "POST") return methodNotAllowed();
      return retiredContract();
    }

    const match = pathname.match(/^\/workbench\/authoring\/runs\/([^/]+)(?:\/(context|evidence|submit|finish))?$/);
    if (!match?.[1]) return undefined;
    const runId = decodePathSegment(match[1]);
    const operation = match[2];

    if (!operation) {
      if (request.method !== "GET") return methodNotAllowed();
      return { body: getAuthoringRunStatus(context.db, runId), status: 200 };
    }

    if (operation === "evidence") {
      if (request.method !== "GET") return methodNotAllowed();
      const kind = optionalEvidenceKind(request.url.searchParams.get("kind"));
      const order = optionalOrder(request.url.searchParams.get("order"));
      const limit = optionalLimit(request.url.searchParams.get("limit"));
      return {
        body: getAuthoringRunEvidence(context.db, {
          cursor: optionalNonBlank(request.url.searchParams.get("cursor")),
          kind,
          limit,
          order,
          query: optionalNonBlank(
            request.url.searchParams.get("query") ?? request.url.searchParams.get("q")
          ),
          runId,
          sessionId: requireNonBlankString(request.url.searchParams.get("sessionId"), "sessionId")
        }),
        status: 200
      };
    }

    if (operation === "context") {
      if (request.method !== "GET") return methodNotAllowed();
      return { body: getAuthoringRunContext(context.db, runId), status: 200 };
    }

    if (operation === "submit") {
      if (request.method !== "POST") return methodNotAllowed();
      return retiredContract();
    }

    if (request.method !== "POST") return methodNotAllowed();
    return retiredContract();
  } catch (error) {
    return authoringErrorResult(error);
  }
}

export function isWorkbenchAuthoringPath(pathname: string): boolean {
  return (
    pathname === "/workbench/authoring/capabilities" ||
    isWorkbenchAuthoringV5Path(pathname) ||
    isGuidedAuthoringPath(pathname) ||
    pathname === "/workbench/authoring/suggestions" ||
    pathname === "/workbench/authoring/runs" ||
    /^\/workbench\/authoring\/runs\/[^/]+(?:\/(?:context|evidence|submit|finish))?$/.test(pathname)
  );
}

export function getWorkbenchAuthoringBodyLimit(pathname: string, defaultLimitBytes: number): number {
  if (isWorkbenchAuthoringV5Path(pathname)) return getWorkbenchAuthoringV5BodyLimit(pathname, defaultLimitBytes);
  if (isGuidedAuthoringPath(pathname)) return getGuidedAuthoringBodyLimit(pathname, defaultLimitBytes);
  return /^\/workbench\/authoring\/runs\/[^/]+\/submit$/.test(pathname)
    ? SUBMIT_BODY_LIMIT_BYTES
    : defaultLimitBytes;
}

export function authoringInvalidJsonResult(error: unknown): WorkbenchAuthoringHttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.startsWith("Request body exceeds") ? "request_body_too_large" : "invalid_json";
  return { body: { error: { code, message }, ok: false }, status: 400 };
}

function authoringErrorResult(error: unknown): WorkbenchAuthoringHttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(message);
  if (
    code === "invalid_request" ||
    authoringBadRequestCodes.has(code) ||
    code.startsWith("invalid_authoring_bundle") ||
    code.startsWith("unexpected_authoring_bundle_property")
  ) {
    return { body: { error: { code, message }, ok: false }, status: 400 };
  }
  if (code === "authoring_run_not_found" || code === "authoring_session_not_found" || code === "session_not_found") {
    return { body: { error: { code, message }, ok: false }, status: 404 };
  }
  if (authoringConflictCodes.has(code)) {
    return { body: { error: { code, message }, ok: false }, status: 409 };
  }
  return {
    body: {
      error: { code: "authoring_internal_error", message: "Workbench authoring request failed" },
      ok: false
    },
    status: 500
  };
}

const authoringBadRequestCodes = new Set([
  "authoring_session_count_invalid",
  "candidate_id_not_allowed"
]);

const authoringConflictCodes = new Set([
  "authoring_contract_retired",
  "authoring_actor_mismatch",
  "authoring_claim_conflict",
  "authoring_claim_missing",
  "authoring_contract_audit_only",
  // A contribution can become non-current after submit; refreshing evidence and
  // resubmitting against a current published artifact resolves this conflict.
  "authoring_finish_invalid_contribution",
  "authoring_run_completed",
  "authoring_run_mismatch",
  "authoring_run_needs_revision",
  "authoring_run_not_ready",
  "authoring_session_not_in_run",
  "authoring_session_not_on_publish_path",
  "database_identity_mismatch",
  "evidence_revision_changed",
  "evidence_revision_mismatch",
  "missing_canonical_evidence",
  "session_enrichment_required",
  "unsupported_authoring_bundle_version"
]);

function retiredContract(): WorkbenchAuthoringHttpResult {
  return {
    body: {
      error: {
        code: "authoring_contract_retired",
        message: "Legacy Workbench authoring mutations are retired; use workbench-authoring-v5."
      },
      ok: false
    },
    status: 409
  };
}

function isRetiredGuidedMutation(method: string, pathname: string): boolean {
  return (method === "POST" && pathname === "/workbench/authoring/requests") ||
    /\/start$/u.test(pathname) ||
    /\/inspect$/u.test(pathname) ||
    /\/draft$/u.test(pathname) ||
    /\/canary-decision$/u.test(pathname) ||
    /\/finish$/u.test(pathname);
}

function methodNotAllowed(): WorkbenchAuthoringHttpResult {
  return {
    body: { error: { code: "method_not_allowed", message: "Method not allowed for Workbench authoring route" }, ok: false },
    status: 405
  };
}

function requireNonBlankString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalidRequest(`${name} is required`);
  return value.trim();
}

function optionalNonBlank(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function optionalEvidenceKind(value: string | null): SessionTranscriptKindFilter | undefined {
  if (value === null) return undefined;
  if (!evidenceKinds.has(value as SessionTranscriptKindFilter)) throw invalidRequest("kind is invalid");
  return value as SessionTranscriptKindFilter;
}

function optionalOrder(value: string | null): SessionTranscriptOrder | undefined {
  if (value === null) return undefined;
  if (value !== "asc" && value !== "desc") throw invalidRequest("order must be asc or desc");
  return value;
}

function optionalLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 250) throw invalidRequest("limit must be between 1 and 250");
  return parsed;
}

function decodePathSegment(value: string): string {
  try {
    return requireNonBlankString(decodeURIComponent(value), "runId");
  } catch (error) {
    if (error instanceof URIError) throw invalidRequest("runId is invalid");
    throw error;
  }
}

function invalidRequest(message: string): Error {
  return new Error(`invalid_request:${message}`);
}

function errorCode(message: string): string {
  const separator = message.indexOf(":");
  return (separator === -1 ? message : message.slice(0, separator)) || "authoring_request_failed";
}
