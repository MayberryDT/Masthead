import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringBundleV3,
  WorkbenchArtifactSuggestionDto,
  WorkbenchAuthoringCapabilitiesDto,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringRunDto
} from "../shared/workbenchAuthoring.ts";
import type { SessionDossierDto } from "../shared/sessionDossier.ts";
import {
  assertGuidedAuthoringExpectedIdentity,
  GuidedAuthoringIdentityError,
  identityFromCapabilities,
  identityFromManifest,
  readMastheadInstanceManifest,
  type GuidedAuthoringExpectedIdentity
} from "../shared/instanceIdentity.ts";
import { isWorkbenchAuthoringCapabilitiesDto } from "../shared/workbenchAuthoring.ts";

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

  async capabilities(): Promise<WorkbenchAuthoringCapabilitiesDto> {
    const binding = await this.currentBinding();
    const capabilities = await this.requestAt<WorkbenchAuthoringCapabilitiesDto>(binding.baseUrl, "GET", "/workbench/authoring/capabilities");
    if (!isWorkbenchAuthoringCapabilitiesDto(capabilities)) {
      throw new MastheadAuthoringClientError({ code: "invalid_daemon_response", message: "Masthead daemon returned incompatible authoring capabilities" });
    }
    if (binding.expected) this.assertIdentity(identityFromCapabilities(capabilities), binding.expected);
    return capabilities;
  }

  async assertAuthoringIdentity(expected: GuidedAuthoringExpectedIdentity): Promise<WorkbenchAuthoringCapabilitiesDto> {
    const actual = await this.capabilities();
    this.assertIdentity(identityFromCapabilities(actual), expected);
    return actual;
  }

  suggestions(sessionIds: string[]): Promise<WorkbenchArtifactSuggestionDto[]> {
    return this.request("POST", "/workbench/authoring/suggestions", { sessionIds });
  }

  open(input: { actorId: string; databaseId: string; sessionIds: string[] }): Promise<{
    ok: true;
    run: WorkbenchAuthoringRunDto;
    [key: string]: unknown;
  }> {
    return this.request("POST", "/workbench/authoring/runs", input);
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

  submit(runId: string, bundle: WorkbenchAuthoringBundle | WorkbenchAuthoringBundleV2 | WorkbenchAuthoringBundleV3): Promise<{
    accepted: boolean;
    findings: unknown[];
    ok: true;
    run: WorkbenchAuthoringRunDto;
  }> {
    return this.request("POST", `/workbench/authoring/runs/${encodeURIComponent(runId)}/submit`, bundle);
  }

  finish(runId: string): Promise<{ ok: true; receipt: WorkbenchAuthoringReceipt }> {
    return this.request("POST", `/workbench/authoring/runs/${encodeURIComponent(runId)}/finish`, {});
  }

  private async request<T>(method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
    const binding = await this.currentBinding();
    if (method === "POST" && binding.expected) {
      const capabilities = await this.requestAt<WorkbenchAuthoringCapabilitiesDto>(binding.baseUrl, "GET", "/workbench/authoring/capabilities");
      if (!isWorkbenchAuthoringCapabilitiesDto(capabilities)) {
        throw new MastheadAuthoringClientError({ code: "invalid_daemon_response", message: "Masthead daemon returned incompatible authoring capabilities" });
      }
      this.assertIdentity(identityFromCapabilities(capabilities), binding.expected);
    }
    return this.requestAt(method === "GET" ? binding.baseUrl : binding.baseUrl, method, pathname, body);
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

  private async requestAt<T>(baseUrl: string, method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" })
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
