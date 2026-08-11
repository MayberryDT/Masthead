import {
  validateCreatePublicLogbookRequestV1,
  validateDeviceAuthorizationV1,
  validateDeviceTokenResultV1,
  validateDeviceRevokeResultV1,
  validatePublicLogbookListResultV1,
  validatePublicLogbookResultV1,
  validatePublishPageBatchResultV1,
  validateRemovePageResultV1,
  validatePublisherAccountV1
} from "../mastheadPages/contract.ts";
import type {
  CreatePublicLogbookRequestV1,
  DeviceTokenAuthorizedV1,
  PublishPageBatchResultV1,
  PublisherAccountV1,
  PublicLogbookSummaryV1,
  RemovePageResultV1
} from "../mastheadPages/types.ts";
import type { MastheadPagesCredentialStore, PagesConnectionState, SafeStorageLike } from "./mastheadPagesCredentials.ts";
import {
  assertSecureStorageAvailable,
  SECURE_STORAGE_UNAVAILABLE
} from "./mastheadPagesCredentials.ts";
import type { CoverImageType, CoverSelectionStore, CoverSourceBytes } from "./mastheadPagesCover.ts";
import {
  assertStagedRefsOnly,
  chunkPublishBatch,
  fetchDaemonPendingOperation,
  loadStagedPublishBatch,
  loadStagedRemoval,
  type DaemonPendingFetcher
} from "./mastheadPagesStagedOperations.ts";
import {
  mastheadPagesOriginConfigFromEnv,
  parseMastheadPagesAuthorizationUrl,
  resolveMastheadPagesApiOrigin
} from "./mastheadPagesUrlPolicy.ts";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type OpenExternalLike = (url: string) => Promise<string | void> | string | void;

export type CoverUploadInput = {
  publicLogbookId: string;
  selectionId: string;
};

export type CoverUploadResult = {
  protocolVersion: "masthead-pages-cover-result-v1";
  coverVersion: string;
};

export type MastheadPagesRemoteClientOptions = {
  apiOrigin?: string;
  credentialStore: MastheadPagesCredentialStore;
  safeStorage: SafeStorageLike;
  fetchImpl?: FetchLike;
  openExternal?: OpenExternalLike;
  daemonBaseUrl: () => string;
  daemonFetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  requestTimeoutMs?: number;
  maxPollAttempts?: number;
  coverSelectionStore?: CoverSelectionStore;
};

function redactError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const cleaned = message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
  return new Error(cleaned.slice(0, 300));
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMastheadPagesRemoteClient(options: MastheadPagesRemoteClientOptions) {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const sleep = options.sleep ?? sleepDefault;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxPollAttempts = options.maxPollAttempts ?? 120;
  const originConfig = mastheadPagesOriginConfigFromEnv(env);

  function apiOrigin(): string {
    return options.apiOrigin ?? resolveMastheadPagesApiOrigin(env);
  }

  async function jsonRequest(
    path: string,
    init: {
      method: string;
      body?: unknown;
      accessToken?: string;
      timeoutMs?: number;
    }
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? requestTimeoutMs);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (init.body !== undefined) headers["content-type"] = "application/json";
      if (init.accessToken) headers.authorization = `Bearer ${init.accessToken}`;
      const response = await fetchImpl(`${apiOrigin()}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      });
      let body: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = { error: "invalid-json-body" };
        }
      }
      return { status: response.status, body };
    } catch (error) {
      throw redactError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureAccessToken(): Promise<{ accessToken: string; account: PublisherAccountV1 }> {
    await assertSecureStorageAvailable(options.safeStorage, platform);
    const refreshToken = await options.credentialStore.loadRefreshToken(options.safeStorage);
    if (!refreshToken) throw new Error("not_connected");

    const { status, body } = await jsonRequest("/api/v1/device-token", {
      method: "POST",
      body: {
        protocolVersion: "masthead-pages-device-token-v1",
        grantType: "refresh_token",
        refreshToken
      }
    });
    if (status !== 200) throw new Error(`token_refresh_failed:${status}`);
    const validated = validateDeviceTokenResultV1(body);
    if (!validated.ok) throw new Error("token_refresh_invalid_response");
    if (validated.value.status !== "authorized") {
      throw new Error(`token_refresh_status:${validated.value.status}`);
    }
    const authorized = validated.value as DeviceTokenAuthorizedV1;
    await options.credentialStore.save(authorized.refreshToken, authorized.account, options.safeStorage);
    return { accessToken: authorized.accessToken, account: authorized.account };
  }

  const pendingFetcher: DaemonPendingFetcher = async (artifactId) =>
    fetchDaemonPendingOperation(options.daemonBaseUrl(), artifactId, options.daemonFetch ?? fetch);

  return {
    async getConnection(): Promise<PagesConnectionState> {
      return options.credentialStore.getConnectionState(options.safeStorage);
    },

    async connect(): Promise<PagesConnectionState> {
      try {
        await assertSecureStorageAvailable(options.safeStorage, platform);
      } catch {
        return { status: "secure_storage_unavailable", reason: SECURE_STORAGE_UNAVAILABLE };
      }

      const started = await jsonRequest("/api/v1/device-authorizations", {
        method: "POST",
        body: { protocolVersion: "masthead-pages-device-authorization-v1" }
      });
      if (started.status !== 200) throw new Error(`device_authorization_failed:${started.status}`);
      const authorization = validateDeviceAuthorizationV1(started.body);
      if (!authorization.ok) throw new Error("device_authorization_invalid_response");

      const verificationUri = parseMastheadPagesAuthorizationUrl(
        authorization.value.verificationUri,
        originConfig
      );
      if (!verificationUri) throw new Error("device_authorization_url_rejected");
      if (!options.openExternal) throw new Error("open_external_unavailable");
      await options.openExternal(verificationUri);

      const intervalMs = Math.max(1, authorization.value.pollingInterval) * 1000;
      const deadline = Date.now() + Math.max(1, authorization.value.expiresIn) * 1000;
      let attempt = 0;
      let backoff = intervalMs;

      while (attempt < maxPollAttempts && Date.now() < deadline) {
        attempt += 1;
        await sleep(backoff);
        backoff = Math.min(intervalMs * 4, Math.round(backoff * 1.25));

        const polled = await jsonRequest("/api/v1/device-token", {
          method: "POST",
          body: {
            protocolVersion: "masthead-pages-device-token-v1",
            grantType: "device_code",
            deviceCode: authorization.value.deviceCode
          }
        });
        if (polled.status !== 200) continue;
        const tokenResult = validateDeviceTokenResultV1(polled.body);
        if (!tokenResult.ok) throw new Error("device_token_invalid_response");
        if (tokenResult.value.status === "pending") continue;
        if (tokenResult.value.status === "denied" || tokenResult.value.status === "expired") {
          throw new Error(`device_authorization_${tokenResult.value.status}`);
        }
        const authorized = tokenResult.value as DeviceTokenAuthorizedV1;
        const accountCheck = validatePublisherAccountV1(authorized.account);
        if (!accountCheck.ok) throw new Error("device_token_invalid_account");
        await options.credentialStore.save(authorized.refreshToken, accountCheck.value, options.safeStorage);
        return { status: "connected", account: accountCheck.value };
      }
      throw new Error("device_authorization_timeout");
    },

    async disconnect(): Promise<void> {
      let refreshToken: string | undefined;
      try {
        refreshToken = await options.credentialStore.loadRefreshToken(options.safeStorage);
      } catch {
        refreshToken = undefined;
      }
      if (refreshToken) {
        try {
          const { status, body } = await jsonRequest("/api/v1/device-revoke", {
            method: "POST",
            body: {
              protocolVersion: "masthead-pages-device-revoke-v1",
              refreshToken
            }
          });
          if (status === 200) {
            void validateDeviceRevokeResultV1(body);
          }
        } catch {
          // Local disconnect must succeed even if hosted revoke is unreachable.
        }
      }
      await options.credentialStore.clear();
    },

    async listPublicLogbooks(): Promise<PublicLogbookSummaryV1[]> {
      const { accessToken } = await ensureAccessToken();
      const { status, body } = await jsonRequest("/api/v1/public-logbooks", {
        method: "GET",
        accessToken
      });
      if (status !== 200) throw new Error(`list_logbooks_failed:${status}`);
      const validated = validatePublicLogbookListResultV1(body);
      if (!validated.ok) throw new Error("list_logbooks_invalid_response");
      return validated.value.items;
    },

    async createPublicLogbook(input: CreatePublicLogbookRequestV1): Promise<PublicLogbookSummaryV1> {
      const request = validateCreatePublicLogbookRequestV1(input);
      if (!request.ok) throw new Error("create_logbook_invalid_request");
      const { accessToken } = await ensureAccessToken();
      const { status, body } = await jsonRequest("/api/v1/public-logbooks", {
        method: "POST",
        accessToken,
        body: request.value
      });
      if (status !== 200 && status !== 201) throw new Error(`create_logbook_failed:${status}`);
      const validated = validatePublicLogbookResultV1(body);
      if (!validated.ok) throw new Error("create_logbook_invalid_response");
      return validated.value.publicLogbook;
    },

    async uploadCover(input: CoverUploadInput): Promise<CoverUploadResult> {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("cover_upload_invalid_request");
      }
      if (typeof input.publicLogbookId !== "string" || !input.publicLogbookId) {
        throw new Error("cover_upload_invalid_logbook");
      }
      if (typeof input.selectionId !== "string" || !input.selectionId) {
        throw new Error("cover_upload_invalid_selection");
      }
      // Reject any attempt to smuggle paths or raw file objects through IPC.
      for (const key of Object.keys(input as Record<string, unknown>)) {
        if (key !== "publicLogbookId" && key !== "selectionId") {
          throw new Error(`cover_upload_forbidden_field:${key}`);
        }
      }
      if (!options.coverSelectionStore) throw new Error("cover_selection_store_unavailable");
      const source = options.coverSelectionStore.take(input.selectionId);
      if (!source) throw new Error("cover_selection_missing");

      const { accessToken } = await ensureAccessToken();
      const form = buildCoverMultipart(source);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetchImpl(
          `${apiOrigin()}/api/v1/public-logbooks/${encodeURIComponent(input.publicLogbookId)}/cover`,
          {
            method: "PUT",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${accessToken}`
            },
            body: form,
            signal: controller.signal
          }
        );
        const text = await response.text();
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = { error: "invalid-json-body" };
          }
        }
        if (response.status !== 200 && response.status !== 201) {
          throw new Error(`cover_upload_failed:${response.status}`);
        }
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new Error("cover_upload_invalid_response");
        }
        const record = body as Record<string, unknown>;
        if (record.protocolVersion !== "masthead-pages-cover-result-v1") {
          throw new Error("cover_upload_invalid_response");
        }
        if (typeof record.coverVersion !== "string" || !record.coverVersion) {
          throw new Error("cover_upload_invalid_response");
        }
        return {
          protocolVersion: "masthead-pages-cover-result-v1",
          coverVersion: record.coverVersion
        };
      } catch (error) {
        throw redactError(error);
      } finally {
        clearTimeout(timeout);
      }
    },

    async publishStaged(args: unknown): Promise<PublishPageBatchResultV1> {
      const refs = assertStagedRefsOnly(args, "publish");
      const batch = await loadStagedPublishBatch(refs, pendingFetcher);
      const { accessToken } = await ensureAccessToken();
      const chunks = chunkPublishBatch(batch);
      const results: PublishPageBatchResultV1["results"] = [];
      for (const chunk of chunks) {
        const { status, body } = await jsonRequest("/api/v1/publications/batch", {
          method: "POST",
          accessToken,
          body: chunk,
          timeoutMs: 60_000
        });
        if (status !== 200) throw new Error(`publish_batch_failed:${status}`);
        const validated = validatePublishPageBatchResultV1(body);
        if (!validated.ok) throw new Error("publish_batch_invalid_response");
        results.push(...validated.value.results);
      }
      return {
        protocolVersion: "masthead-pages-publish-batch-result-v1",
        results
      };
    },

    async withdrawStaged(args: unknown): Promise<RemovePageResultV1> {
      const normalized =
        args && typeof args === "object" && !Array.isArray(args) && ("ref" in args || "refs" in args)
          ? args
          : { ref: args };
      const refs = assertStagedRefsOnly(normalized, "remove");
      if (refs.length !== 1) throw new Error("remove_single_ref_required");
      const request = await loadStagedRemoval(refs[0]!, pendingFetcher);
      const { accessToken } = await ensureAccessToken();
      const { status, body } = await jsonRequest(`/api/v1/pages/${encodeURIComponent(request.pageId)}/withdraw`, {
        method: "POST",
        accessToken,
        body: request
      });
      if (status !== 200) throw new Error(`remove_failed:${status}`);
      const validated = validateRemovePageResultV1(body);
      if (!validated.ok) throw new Error("remove_invalid_response");
      return validated.value;
    }
  };
}

export type MastheadPagesRemoteClient = ReturnType<typeof createMastheadPagesRemoteClient>;

function coverFilename(contentType: CoverImageType): string {
  if (contentType === "image/jpeg") return "cover.jpg";
  if (contentType === "image/webp") return "cover.webp";
  return "cover.png";
}

function buildCoverMultipart(source: CoverSourceBytes): FormData {
  const form = new FormData();
  const bytes = Uint8Array.from(source.bytes);
  const blob = new Blob([bytes], { type: source.contentType });
  // Generic filename only — never the original local path.
  form.append("cover", blob, coverFilename(source.contentType));
  return form;
}
