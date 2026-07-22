import { isAbsolute, resolve } from "node:path";
import {
  GUIDED_AUTHORING_IDENTITY_HEADERS,
  type GuidedAuthoringExpectedIdentity
} from "../shared/guidedAuthoring.ts";
import {
  WORKBENCH_AUTHORING_V5_OPERATIONS,
  type WorkbenchAuthoringV5CapabilitiesDto,
  type WorkbenchAuthoringV5Draft
} from "../shared/workbenchAuthoringV5.ts";
import { normalizeMastheadBaseUrl } from "../shared/instanceIdentity.ts";
import { isAbsoluteAuthoringCommand } from "../shared/workbenchAuthoring.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import {
  bootstrapWorkbenchAuthoringV5Request,
  buildWorkbenchAuthoringV5Scaffold,
  createWorkbenchAuthoringV5Request,
  finishWorkbenchAuthoringV5Pack,
  getWorkbenchAuthoringV5RequestReceiptStatus,
  getWorkbenchAuthoringV5RequestStatus,
  inspectWorkbenchAuthoringV5Pack,
  saveWorkbenchAuthoringV5Draft,
  startWorkbenchAuthoringV5Pack
} from "../workbench/authoring/workbenchAuthoringV5Service.ts";

export type WorkbenchAuthoringV5HttpContext = {
  authoringCommand: string;
  db: MastheadDatabase;
  identity: GuidedAuthoringExpectedIdentity;
};
export type WorkbenchAuthoringV5HttpHeaders = Record<string, string | string[] | undefined>;
export type WorkbenchAuthoringV5HttpResult = { status: number; body: unknown };
const WORKBENCH_AUTHORING_V5_DRAFT_LIMIT_BYTES = 5 * 1024 * 1024;

export function workbenchAuthoringV5Capabilities(
  context: WorkbenchAuthoringV5HttpContext
): WorkbenchAuthoringV5CapabilitiesDto {
  if (!isAbsoluteAuthoringCommand(context.authoringCommand)) throw new Error("authoring_command_unavailable");
  return {
    ...context.identity,
    bundleVersion: "workbench-authoring-v5",
    capability: "artifact_authoring",
    command: context.authoringCommand,
    maximumSessionsPerPack: 12,
    minimumSessionsPerPack: 5,
    operations: [...WORKBENCH_AUTHORING_V5_OPERATIONS],
    policyVersion: "workbench-authoring-v5",
    protocol: "masthead.workbench.authoring/v1"
  };
}

export function routeWorkbenchAuthoringV5Request(
  context: WorkbenchAuthoringV5HttpContext,
  request: { method: string; url: URL; body?: unknown; headers?: WorkbenchAuthoringV5HttpHeaders }
): WorkbenchAuthoringV5HttpResult | undefined {
  const { pathname } = request.url;
  if (!isWorkbenchAuthoringV5Path(pathname)) return undefined;
  try {
    if (pathname === "/workbench/authoring/v5/requests") {
      if (request.method !== "POST") return methodNotAllowed();
      const body = record(request.body);
      return {
        body: createWorkbenchAuthoringV5Request(context.db, {
          actorId: optionalString(body.actorId) ?? "workbench",
          command: context.authoringCommand,
          currentIdentity: context.identity,
          expectedIdentity: expectedIdentityFromBody(body),
          sessionIds: stringArray(body.sessionIds, "sessionIds")
        }),
        status: 201
      };
    }

    const requestMatch = pathname.match(/^\/workbench\/authoring\/v5\/requests\/([^/]+)(?:\/(bootstrap|start|receipt))?$/u);
    if (requestMatch?.[1]) {
      const requestId = decodeSegment(requestMatch[1], "requestId");
      const operation = requestMatch[2];
      if (!operation) {
        if (request.method !== "GET") return methodNotAllowed();
        return { body: getWorkbenchAuthoringV5RequestStatus(context.db, { command: context.authoringCommand, requestId }), status: 200 };
      }
      if (operation === "bootstrap") {
        if (request.method !== "GET") return methodNotAllowed();
        return { body: bootstrapWorkbenchAuthoringV5Request(context.db, { command: context.authoringCommand, requestId }), status: 200 };
      }
      if (operation === "receipt") {
        if (request.method !== "GET") return methodNotAllowed();
        return { body: getWorkbenchAuthoringV5RequestReceiptStatus(context.db, requestId), status: 200 };
      }
      if (request.method !== "POST") return methodNotAllowed();
      return {
        body: startWorkbenchAuthoringV5Pack(context.db, {
          command: context.authoringCommand,
          currentIdentity: context.identity,
          expectedIdentity: expectedIdentityFromBody(record(request.body)),
          requestId
        }),
        status: 200
      };
    }

    const packMatch = pathname.match(/^\/workbench\/authoring\/v5\/packs\/([^/]+)\/(inspect|scaffold|draft|finish)$/u);
    if (!packMatch?.[1] || !packMatch[2]) return undefined;
    const packId = decodeSegment(packMatch[1], "packId");
    const operation = packMatch[2];
    if (operation === "inspect") {
      if (request.method !== "GET") return methodNotAllowed();
      return {
        body: inspectWorkbenchAuthoringV5Pack(context.db, {
          command: context.authoringCommand,
          currentIdentity: context.identity,
          expectedIdentity: expectedIdentityFromHeaders(request.headers),
          packId,
          ...(optionalQuery(request.url, "sessionId") ? { sessionId: optionalQuery(request.url, "sessionId") } : {}),
          ...(optionalQuery(request.url, "cursor") ? { cursor: optionalQuery(request.url, "cursor") } : {})
        }),
        status: 200
      };
    }
    if (operation === "scaffold") {
      if (request.method !== "GET") return methodNotAllowed();
      return { body: buildWorkbenchAuthoringV5Scaffold(context.db, { command: context.authoringCommand, packId }), status: 200 };
    }
    if (request.method !== "POST") return methodNotAllowed();
    const body = record(request.body);
    const identity = expectedIdentityFromBody(body);
    if (operation === "draft") {
      return {
        body: saveWorkbenchAuthoringV5Draft(context.db, {
          command: context.authoringCommand,
          currentIdentity: context.identity,
          draft: body.draft as WorkbenchAuthoringV5Draft,
          expectedIdentity: identity,
          packId
        }),
        status: 200
      };
    }
    return {
      body: finishWorkbenchAuthoringV5Pack(context.db, {
        command: context.authoringCommand,
        currentIdentity: context.identity,
        expectedIdentity: identity,
        packId
      }),
      status: 200
    };
  } catch (error) {
    return workbenchAuthoringV5ErrorResult(error);
  }
}

export function isWorkbenchAuthoringV5Path(pathname: string): boolean {
  return pathname === "/workbench/authoring/v5/requests" ||
    /^\/workbench\/authoring\/v5\/requests\/[^/]+(?:\/(?:bootstrap|start|receipt))?$/u.test(pathname) ||
    /^\/workbench\/authoring\/v5\/packs\/[^/]+\/(?:inspect|scaffold|draft|finish)$/u.test(pathname);
}

export function getWorkbenchAuthoringV5BodyLimit(pathname: string, defaultLimitBytes: number): number {
  return /^\/workbench\/authoring\/v5\/packs\/[^/]+\/draft$/u.test(pathname)
    ? WORKBENCH_AUTHORING_V5_DRAFT_LIMIT_BYTES
    : defaultLimitBytes;
}

export function workbenchAuthoringV5ErrorResult(error: unknown): WorkbenchAuthoringV5HttpResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0] || "authoring_v5_request_failed";
  if (code.endsWith("_not_found")) return failure(404, code, message);
  if (code.startsWith("invalid_") || code.endsWith("_invalid") || code.endsWith("_too_small") || code.endsWith("_blank")) {
    return failure(400, code, message);
  }
  if (code.includes("identity_mismatch") || code.startsWith("authoring_v5_") || code === "evidence_revision_changed") {
    return failure(409, code, message);
  }
  return failure(500, "authoring_v5_internal_error", "Workbench authoring V5 request failed");
}

function expectedIdentityFromBody(body: Record<string, unknown>): GuidedAuthoringExpectedIdentity {
  return parseExpectedIdentity(body.expectedIdentity);
}

function expectedIdentityFromHeaders(headers: WorkbenchAuthoringV5HttpHeaders | undefined): GuidedAuthoringExpectedIdentity {
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
  const instanceManifest = requiredString(identity.instanceManifest, "expectedIdentity.instanceManifest");
  if (!isAbsolute(instanceManifest) || resolve(instanceManifest) !== instanceManifest) throw new Error("invalid_expected_identity");
  return {
    baseUrl: normalizeMastheadBaseUrl(requiredString(identity.baseUrl, "expectedIdentity.baseUrl")),
    buildSha: requiredString(identity.buildSha, "expectedIdentity.buildSha"),
    databaseId: requiredString(identity.databaseId, "expectedIdentity.databaseId"),
    instanceId: requiredString(identity.instanceId, "expectedIdentity.instanceId"),
    instanceManifest
  };
}

function record(value: unknown, message = "request body must be a JSON object"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid_request:${message}`);
  return value as Record<string, unknown>;
}
function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`invalid_request:${name}`);
  return value as string[];
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid_request:${name}`);
  return value.trim();
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function optionalQuery(url: URL, name: string): string | undefined {
  return optionalString(url.searchParams.get(name));
}
function decodeSegment(value: string, name: string): string {
  try { return requiredString(decodeURIComponent(value), name); } catch { throw new Error(`invalid_request:${name}`); }
}
function methodNotAllowed(): WorkbenchAuthoringV5HttpResult {
  return failure(405, "method_not_allowed", "Method not allowed for Workbench authoring V5 route");
}
function failure(status: number, code: string, message: string): WorkbenchAuthoringV5HttpResult {
  return { body: { error: { code, message }, ok: false }, status };
}
