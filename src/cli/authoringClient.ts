import type {
  WorkbenchAuthoringEvidencePage,
  WorkbenchArtifactSuggestionDto,
  WorkbenchAuthoringRunDto
} from "../shared/workbenchAuthoring.ts";
import {
  GUIDED_AUTHORING_IDENTITY_HEADERS
} from "../shared/guidedAuthoring.ts";
import type { SessionDossierDto } from "../shared/sessionDossier.ts";
import type {
  WorkbenchAuthoringV5CapabilitiesDto,
  WorkbenchAuthoringV5Draft,
  WorkbenchAuthoringV5NextAction,
  WorkbenchAuthoringV5PackReceipt,
  WorkbenchAuthoringV5RequestDto,
  WorkbenchAuthoringV5RequestReceipt,
  WorkbenchAuthoringV5SessionOutcome
} from "../shared/workbenchAuthoringV5.ts";
import {
  isWorkbenchAuthoringV5CapabilitiesDto,
  toWorkbenchAuthoringV5AuthoredDraft
} from "../shared/workbenchAuthoringV5.ts";
import {
  assertGuidedAuthoringExpectedIdentity,
  GuidedAuthoringIdentityError,
  identityFromCapabilities,
  identityFromManifest,
  readMastheadInstanceManifest,
  type GuidedAuthoringExpectedIdentity
} from "../shared/instanceIdentity.ts";

export const DEFAULT_MASTHEAD_DAEMON_URL = "http://127.0.0.1:17373";

export class MastheadAuthoringClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly body?: unknown;

  constructor(input: { body?: unknown; code: string; message: string; status?: number }) {
    super(input.message);
    this.name = "MastheadAuthoringClientError";
    this.body = input.body;
    this.code = input.code;
    this.status = input.status;
  }
}

export class MastheadAuthoringClient {
  private readonly configuredBaseUrl: string;
  private readonly instanceManifest?: string;

  constructor(input: string | { baseUrl?: string; instanceManifest?: string } = DEFAULT_MASTHEAD_DAEMON_URL) {
    const options = typeof input === "string" ? { baseUrl: input } : input;
    this.configuredBaseUrl = (options.baseUrl?.trim() || DEFAULT_MASTHEAD_DAEMON_URL).replace(/\/+$/, "");
    this.instanceManifest = options.instanceManifest?.trim() || undefined;
  }

  async capabilities(): Promise<WorkbenchAuthoringV5CapabilitiesDto> {
    const binding = await this.currentBinding();
    const capabilities = await this.requestAt<WorkbenchAuthoringV5CapabilitiesDto>(
      binding.baseUrl,
      "GET",
      "/workbench/authoring/capabilities"
    );
    if (!isWorkbenchAuthoringV5CapabilitiesDto(capabilities)) {
      throw new MastheadAuthoringClientError({ code: "invalid_daemon_response", message: "Masthead daemon returned incompatible authoring capabilities" });
    }
    if (binding.expected) this.assertIdentity(identityFromCapabilities(capabilities), binding.expected);
    return capabilities;
  }

  async assertAuthoringIdentity(expected: GuidedAuthoringExpectedIdentity): Promise<WorkbenchAuthoringV5CapabilitiesDto> {
    const actual = await this.capabilities();
    this.assertIdentity(identityFromCapabilities(actual), expected);
    return actual;
  }

  async authoringV5Bootstrap(requestId: string): Promise<V5CommandDto> {
    const binding = await this.currentBinding();
    return this.requestAt(binding.baseUrl, "GET", `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/bootstrap`);
  }

  async authoringV5Start(requestId: string): Promise<V5CommandDto> {
    const binding = await this.verifiedGuidedMutationBinding();
    return this.requestAt(
      binding.baseUrl,
      "POST",
      `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/start`,
      { expectedIdentity: binding.expected }
    );
  }

  async authoringV5Inspect(
    packId: string,
    options: { cursor?: string; sessionId?: string } = {}
  ): Promise<V5CommandDto> {
    const binding = await this.verifiedGuidedMutationBinding();
    const query = new URLSearchParams();
    if (options.sessionId) query.set("sessionId", options.sessionId);
    if (options.cursor) query.set("cursor", options.cursor);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.requestAt(
      binding.baseUrl,
      "GET",
      `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/inspect${suffix}`,
      undefined,
      identityHeaders(binding.expected)
    );
  }

  async authoringV5Scaffold(packId: string): Promise<{ draft: WorkbenchAuthoringV5Draft; nextAction: WorkbenchAuthoringV5NextAction; packId: string }> {
    const binding = await this.currentBinding();
    return this.requestAt(binding.baseUrl, "GET", `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/scaffold`);
  }

  async authoringV5Save(packId: string, draft: WorkbenchAuthoringV5Draft): Promise<V5CommandDto & { outcomes: WorkbenchAuthoringV5SessionOutcome[] }> {
    const binding = await this.verifiedGuidedMutationBinding();
    return this.requestAt(
      binding.baseUrl,
      "POST",
      `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/draft`,
      { draft: toWorkbenchAuthoringV5AuthoredDraft(draft), expectedIdentity: binding.expected }
    );
  }

  async authoringV5Finish(packId: string): Promise<V5CommandDto & { receipt: WorkbenchAuthoringV5PackReceipt; requestReceipt?: WorkbenchAuthoringV5RequestReceipt }> {
    const binding = await this.verifiedGuidedMutationBinding();
    return this.requestAt(
      binding.baseUrl,
      "POST",
      `/workbench/authoring/v5/packs/${encodeURIComponent(packId)}/finish`,
      { expectedIdentity: binding.expected }
    );
  }

  async authoringV5Status(requestId: string): Promise<V5CommandDto & { request: WorkbenchAuthoringV5RequestDto; receipt?: WorkbenchAuthoringV5RequestReceipt }> {
    const binding = await this.currentBinding();
    return this.requestAt(binding.baseUrl, "GET", `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}`);
  }

  async authoringV5Receipt(requestId: string): Promise<{ requestId: string; status: WorkbenchAuthoringV5RequestDto["status"]; receipt?: WorkbenchAuthoringV5RequestReceipt }> {
    const binding = await this.currentBinding();
    return this.requestAt(binding.baseUrl, "GET", `/workbench/authoring/v5/requests/${encodeURIComponent(requestId)}/receipt`);
  }

  status(runId: string): Promise<{ ok: true; run: WorkbenchAuthoringRunDto; evidenceStatus: "current" | "changed" }> {
    return this.request("GET", `/workbench/authoring/runs/${encodeURIComponent(runId)}`);
  }

  context(runId: string): Promise<{
    evidenceRevision: string;
    ok: true;
    runId: string;
    sessions: Array<{ dossier: SessionDossierDto; sessionId: string }>;
    suggestions: WorkbenchArtifactSuggestionDto[];
  }> {
    return this.request("GET", `/workbench/authoring/runs/${encodeURIComponent(runId)}/context`);
  }

  evidence(runId: string, query: URLSearchParams): Promise<WorkbenchAuthoringEvidencePage> {
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request("GET", `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence${suffix}`);
  }

  private async request<T>(method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
    const binding = await this.currentBinding();
    return this.requestAt(binding.baseUrl, method, pathname, body);
  }

  private async currentBinding(): Promise<{ baseUrl: string; expected?: GuidedAuthoringExpectedIdentity }> {
    if (!this.instanceManifest) return { baseUrl: this.configuredBaseUrl };
    try {
      const manifest = await readMastheadInstanceManifest(this.instanceManifest);
      return { baseUrl: manifest.baseUrl, expected: identityFromManifest(manifest, this.instanceManifest) };
    } catch (error) {
      throw new MastheadAuthoringClientError({
        code: "instance_manifest_unavailable",
        message: `Masthead instance manifest is unavailable at ${this.instanceManifest}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private async verifiedGuidedMutationBinding(): Promise<{
    baseUrl: string;
    expected: GuidedAuthoringExpectedIdentity;
  }> {
    const binding = await this.currentBinding();
    if (!binding.expected) {
      throw new MastheadAuthoringClientError({
        code: "instance_manifest_required",
        message: "Guided authoring mutations require MASTHEAD_INSTANCE_MANIFEST"
      });
    }
    const capabilities = await this.requestAt<WorkbenchAuthoringV5CapabilitiesDto>(
      binding.baseUrl,
      "GET",
      "/workbench/authoring/capabilities"
    );
    if (!isWorkbenchAuthoringV5CapabilitiesDto(capabilities)) {
      throw new MastheadAuthoringClientError({
        code: "invalid_daemon_response",
        message: "Masthead daemon returned incompatible guided authoring capabilities"
      });
    }
    this.assertIdentity(identityFromCapabilities(capabilities), binding.expected);
    return { baseUrl: binding.baseUrl, expected: binding.expected };
  }

  private assertIdentity(actual: GuidedAuthoringExpectedIdentity, expected: GuidedAuthoringExpectedIdentity): void {
    try {
      assertGuidedAuthoringExpectedIdentity(actual, expected);
    } catch (error) {
      if (error instanceof GuidedAuthoringIdentityError) {
        throw new MastheadAuthoringClientError({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private async requestAt<T>(
    baseUrl: string,
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extraHeaders
        },
        method
      });
    } catch (error) {
      throw new MastheadAuthoringClientError({
        code: "daemon_unavailable",
        message: `Masthead daemon is unavailable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const daemonError = daemonErrorDetails(responseBody);
      throw new MastheadAuthoringClientError({
        body: responseBody,
        code: daemonError.code,
        message: daemonError.message ?? `Masthead authoring request failed with HTTP ${response.status}`,
        status: response.status
      });
    }
    return responseBody as T;
  }
}

export type V5CommandDto = {
  nextAction: WorkbenchAuthoringV5NextAction;
  [key: string]: unknown;
};

function identityHeaders(identity: GuidedAuthoringExpectedIdentity): Record<string, string> {
  return {
    [GUIDED_AUTHORING_IDENTITY_HEADERS.baseUrl]: identity.baseUrl,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.databaseId]: identity.databaseId,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.buildSha]: identity.buildSha,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.instanceManifest]: identity.instanceManifest,
    [GUIDED_AUTHORING_IDENTITY_HEADERS.instanceId]: identity.instanceId
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return { raw: text };
    throw new MastheadAuthoringClientError({
      body: text,
      code: "invalid_daemon_response",
      message: "Masthead daemon returned a non-JSON authoring response",
      status: response.status
    });
  }
}

function daemonErrorDetails(value: unknown): { code: string; message?: string } {
  if (typeof value !== "object" || value === null) return { code: "daemon_request_failed" };
  const error = "error" in value ? value.error : undefined;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      code: typeof record.code === "string" && record.code ? record.code : "daemon_request_failed",
      message: typeof record.message === "string" && record.message ? record.message : undefined
    };
  }
  return { code: "daemon_request_failed" };
}
