import type { SessionTranscriptOrder } from "../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchArtifactCandidateStatus,
  WorkbenchAutomaticArtifactKind,
  WorkbenchAuthoringCapabilitiesDto
} from "../shared/workbenchAuthoring.ts";
import {
  finishAuthoringRun,
  getAuthoringRunEvidence,
  getAuthoringRunStatus,
  openCandidateAuthoringRun,
  submitAuthoringBundle
} from "../workbench/authoring/authoringService.ts";
import {
  dismissArtifactCandidate,
  discoverNextArtifactCandidatePage,
  proposeArtifactCandidate
} from "../workbench/authoring/artifactCandidates.ts";
import { listWorkbenchArtifactCandidatePage } from "./db/workbenchArtifactCandidateRepository.ts";
import { parseAuthoringBundleV2 } from "../workbench/authoring/authoringSchemas.ts";
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
const candidateKinds = new Set<WorkbenchAutomaticArtifactKind>(["runbook", "adr", "incident_timeline"]);
const candidateStatuses = new Set<WorkbenchArtifactCandidateStatus>([
  "pending",
  "claimed",
  "published",
  "dismissed",
  "superseded"
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
        bundleVersion: "workbench-authoring-v2",
        capability: "artifact_authoring",
        command: context.authoringCommand.trim() || "mastheadctl",
        databaseId: getOrCreateDatabaseIdentity(context.db),
        evidencePolicy: "candidate_scoped_canonical_evidence",
        evidenceRequirements: {
          adr: ["context", "decision", "alternatives"],
          incident_timeline: ["symptom", "ordered_events", "remediation"],
          runbook: ["problem", "change", "verification"]
        },
        operations: ["candidates", "open", "status", "evidence", "submit", "finish"],
        protocol: "masthead.workbench.authoring/v1",
        transport: "daemon_http"
      };
      return { body, status: 200 };
    }

    if (pathname === "/workbench/authoring/candidates") {
      if (request.method === "GET") {
        discoverNextArtifactCandidatePage(context.db, { limit: 100 });
        const status = optionalCandidateStatus(request.url.searchParams.get("status"));
        const kind = optionalCandidateKind(request.url.searchParams.get("kind"));
        const limit = optionalCandidateLimit(request.url.searchParams.get("limit"));
        const cursor = decodeCandidateCursor(request.url.searchParams.get("cursor"));
        const page = listWorkbenchArtifactCandidatePage(context.db, { cursor, kind, limit, status });
        return {
          body: {
            candidates: page.candidates,
            ...(page.nextCursor ? { nextCursor: encodeCandidateCursor(page.nextCursor) } : {})
          },
          status: 200
        };
      }
      if (request.method === "POST") {
        const body = requireRecord(request.body);
        const candidate = proposeArtifactCandidate(context.db, {
          kind: requireCandidateKind(body.kind),
          provenanceSessionIds: requireStringArray(body.provenanceSessionIds, "provenanceSessionIds"),
          seedSessionId: requireNonBlankString(body.seedSessionId, "seedSessionId"),
          signalEvidenceRefs: requireStringArray(body.signalEvidenceRefs, "signalEvidenceRefs"),
          signalSummary: requireNonBlankString(body.signalSummary, "signalSummary"),
          ...(body.signatureKey === undefined
            ? {}
            : { signatureKey: requireNonBlankString(body.signatureKey, "signatureKey") })
        });
        return { body: { candidate, ok: true }, status: 201 };
      }
      return methodNotAllowed();
    }

    const dismissMatch = pathname.match(/^\/workbench\/authoring\/candidates\/([^/]+)\/dismiss$/);
    if (dismissMatch?.[1]) {
      if (request.method !== "POST") return methodNotAllowed();
      const body = requireRecord(request.body);
      const candidate = dismissArtifactCandidate(context.db, {
        candidateId: decodePathSegment(dismissMatch[1]),
        reason: requireNonBlankString(body.reason, "reason"),
        signalEvidenceRefs: requireStringArray(body.signalEvidenceRefs, "signalEvidenceRefs")
      });
      return { body: { candidate, ok: true }, status: 200 };
    }

    if (pathname === "/workbench/authoring/runs") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = requireRecord(request.body);
      const actorId = requireNonBlankString(body.actorId, "actorId");
      const databaseId = requireNonBlankString(body.databaseId, "databaseId");
      if (body.candidateId === undefined) throw new Error("candidate_id_required");
      if (body.sessionIds !== undefined) throw new Error("arbitrary_session_list_not_allowed");
      const candidateId = requireNonBlankString(body.candidateId, "candidateId");
      return {
        body: openCandidateAuthoringRun(context.db, { actorId, candidateId, databaseId }),
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
    pathname === "/workbench/authoring/candidates" ||
    /^\/workbench\/authoring\/candidates\/[^/]+\/dismiss$/.test(pathname) ||
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
  if (
    code === "invalid_request" ||
    authoringBadRequestCodes.has(code) ||
    code.startsWith("candidate_proposal_") ||
    code.startsWith("invalid_authoring_bundle") ||
    code.startsWith("unexpected_authoring_bundle_property")
  ) {
    return { body: { error: { code, message }, ok: false }, status: 400 };
  }
  if (code === "authoring_run_not_found" || code === "authoring_session_not_found" || code === "session_not_found" || code === "artifact_candidate_not_found") {
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
  "arbitrary_session_list_not_allowed",
  "candidate_id_required",
  "candidate_dismissal_evidence_invalid",
  "candidate_dismissal_reason_too_short"
]);

const authoringConflictCodes = new Set([
  "authoring_actor_mismatch",
  "authoring_claim_conflict",
  "authoring_claim_missing",
  // A contribution can become non-current after submit; refreshing evidence and
  // resubmitting against a current published artifact resolves this conflict.
  "authoring_finish_invalid_contribution",
  "authoring_run_completed",
  "authoring_run_mismatch",
  "authoring_run_needs_revision",
  "authoring_run_not_ready",
  "authoring_session_not_in_run",
  "authoring_session_not_on_publish_path",
  "artifact_candidate_claim_conflict",
  "artifact_candidate_not_openable",
  "artifact_candidate_transition_invalid",
  "candidate_dismissal_evidence_changed",
  "candidate_evidence_revision_changed",
  "authoring_candidate_artifact_mismatch",
  "authoring_candidate_mismatch",
  "database_identity_mismatch",
  "evidence_revision_changed",
  "evidence_revision_mismatch",
  "missing_canonical_evidence",
  "unsupported_authoring_bundle_version"
]);

function methodNotAllowed(): WorkbenchAuthoringHttpResult {
  return {
    body: { error: { code: "method_not_allowed", message: "Method not allowed for Workbench authoring route" }, ok: false },
    status: 405
  };
}

function requireBundleEnvelope(value: unknown): WorkbenchAuthoringBundle | WorkbenchAuthoringBundleV2 {
  const bundle = requireRecord(value);
  if (bundle.bundleVersion === "workbench-authoring-v2") return parseAuthoringBundleV2(bundle);
  if (bundle.bundleVersion !== "workbench-authoring-v1") {
    throw invalidRequest("bundleVersion must be workbench-authoring-v1 or workbench-authoring-v2");
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

function optionalCandidateLimit(value: string | null): number {
  if (value === null) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw invalidRequest("limit must be between 1 and 100");
  return parsed;
}

function optionalCandidateKind(value: string | null): WorkbenchAutomaticArtifactKind | undefined {
  if (value === null) return undefined;
  return requireCandidateKind(value);
}

function requireCandidateKind(value: unknown): WorkbenchAutomaticArtifactKind {
  if (!candidateKinds.has(value as WorkbenchAutomaticArtifactKind)) throw invalidRequest("kind is invalid");
  return value as WorkbenchAutomaticArtifactKind;
}

function optionalCandidateStatus(value: string | null): WorkbenchArtifactCandidateStatus | undefined {
  if (value === null) return undefined;
  if (!candidateStatuses.has(value as WorkbenchArtifactCandidateStatus)) throw invalidRequest("status is invalid");
  return value as WorkbenchArtifactCandidateStatus;
}

function encodeCandidateCursor(cursor: { candidateId: string; updatedAt: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCandidateCursor(value: string | null): { candidateId: string; updatedAt: string } | undefined {
  if (value === null) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid");
    return {
      candidateId: requireNonBlankString(parsed.candidateId, "cursor.candidateId"),
      updatedAt: requireNonBlankString(parsed.updatedAt, "cursor.updatedAt")
    };
  } catch {
    throw invalidRequest("cursor is invalid");
  }
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
