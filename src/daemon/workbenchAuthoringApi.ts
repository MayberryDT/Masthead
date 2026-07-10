import type { SessionTranscriptOrder } from "../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringCapabilitiesDto
} from "../shared/workbenchAuthoring.ts";
import {
  finishAuthoringRun,
  getAuthoringRunEvidence,
  getAuthoringRunStatus,
  openAuthoringRun,
  submitAuthoringBundle
} from "../workbench/authoring/authoringService.ts";
import type { SessionTranscriptKindFilter } from "./db/sessionTranscriptRepository.ts";
import { getOrCreateDatabaseIdentity } from "./db/schema.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

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
  context: { authoringCommand: string; db: MastheadDatabase },
  request: { method: string; url: URL; body?: unknown }
): Promise<WorkbenchAuthoringHttpResult | undefined> {
  const { pathname } = request.url;
  if (!isWorkbenchAuthoringPath(pathname)) return undefined;

  try {
    if (pathname === "/workbench/authoring/capabilities") {
      if (request.method !== "GET") return methodNotAllowed();
      const body: WorkbenchAuthoringCapabilitiesDto = {
        bundleVersion: "workbench-authoring-v1",
        capability: "artifact_authoring",
        command: context.authoringCommand,
        databaseId: getOrCreateDatabaseIdentity(context.db),
        evidencePolicy: "all_canonical_redacted_evidence",
        operations: ["open", "status", "evidence", "submit", "finish"],
        protocol: "masthead.workbench.authoring/v1",
        transport: "daemon_http"
      };
      return { body, status: 200 };
    }

    if (pathname === "/workbench/authoring/runs") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = requireRecord(request.body);
      const actorId = requireNonBlankString(body.actorId, "actorId");
      const databaseId = requireNonBlankString(body.databaseId, "databaseId");
      const sessionIds = requireStringArray(body.sessionIds, "sessionIds");
      return {
        body: openAuthoringRun(context.db, { actorId, databaseId, sessionIds }),
        status: 201
      };
    }

    const match = pathname.match(/^\/workbench\/authoring\/runs\/([^/]+)(?:\/(evidence|submit|finish))?$/);
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

    if (operation === "submit") {
      if (request.method !== "POST") return methodNotAllowed();
      const bundle = requireBundleEnvelope(request.body);
      return {
        body: submitAuthoringBundle(context.db, { bundle, runId }),
        status: 200
      };
    }

    if (request.method !== "POST") return methodNotAllowed();
    if (request.body !== undefined && !isRecord(request.body)) {
      throw invalidRequest("finish body must be a JSON object");
    }
    return {
      body: { ok: true, receipt: finishAuthoringRun(context.db, { runId }) },
      status: 200
    };
  } catch (error) {
    return authoringErrorResult(error);
  }
}

export function isWorkbenchAuthoringPath(pathname: string): boolean {
  return (
    pathname === "/workbench/authoring/capabilities" ||
    pathname === "/workbench/authoring/runs" ||
    /^\/workbench\/authoring\/runs\/[^/]+(?:\/(?:evidence|submit|finish))?$/.test(pathname)
  );
}

export function getWorkbenchAuthoringBodyLimit(pathname: string, defaultLimitBytes: number): number {
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
  if (code === "invalid_request") {
    return { body: { error: { code, message }, ok: false }, status: 400 };
  }
  if (code === "authoring_run_not_found" || code === "authoring_session_not_found" || code === "session_not_found") {
    return { body: { error: { code, message }, ok: false }, status: 404 };
  }
  if (
    code === "database_identity_mismatch" ||
    code === "missing_canonical_evidence" ||
    code.startsWith("authoring_run_") ||
    code.startsWith("authoring_claim_") ||
    code.startsWith("authoring_session_") ||
    code.startsWith("authoring_finish_") ||
    code.startsWith("evidence_revision_")
  ) {
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

function methodNotAllowed(): WorkbenchAuthoringHttpResult {
  return {
    body: { error: { code: "method_not_allowed", message: "Method not allowed for Workbench authoring route" }, ok: false },
    status: 405
  };
}

function requireBundleEnvelope(value: unknown): WorkbenchAuthoringBundle {
  const bundle = requireRecord(value);
  if (bundle.bundleVersion !== "workbench-authoring-v1") {
    throw invalidRequest("bundleVersion must be workbench-authoring-v1");
  }
  requireNonBlankString(bundle.runId, "runId");
  requireNonBlankString(bundle.evidenceRevision, "evidenceRevision");
  for (const key of ["sessionPackages", "artifacts", "notApplicable", "contributions"] as const) {
    if (!Array.isArray(bundle[key])) throw invalidRequest(`${key} must be an array`);
  }
  return bundle as WorkbenchAuthoringBundle;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidRequest("request body must be a JSON object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlankString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalidRequest(`${name} is required`);
  return value.trim();
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidRequest(`${name} must be a non-empty array`);
  return value.map((item) => requireNonBlankString(item, `${name}[]`));
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
