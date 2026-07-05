import { createDeterministicEnrichmentProvider } from "../enrichment/deterministicProvider.ts";
import { isIP } from "node:net";
import { createAnthropicEnrichmentProvider } from "../enrichment/anthropicProvider.ts";
import { createGeminiEnrichmentProvider } from "../enrichment/geminiProvider.ts";
import { createOpenAIEnrichmentProvider } from "../enrichment/openAIProvider.ts";
import type { SessionEnrichmentProvider } from "../enrichment/provider.ts";
import type { DaemonConfig } from "./config.ts";
import { sourcePolicyEnabled } from "./db/sourcePolicyRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

export type LlmProviderId =
  | "openai"
  | "openai_compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "lm_studio"
  | "vllm"
  | "llama_cpp"
  | "localai";
export type LlmApiStyle = "responses" | "chat_completions" | "anthropic_messages" | "gemini_generate_content";

export type LlmProviderSettingsDto = {
  activeProvider: LlmProviderId;
  remoteEnrichmentEnabled: boolean;
  providers: LlmProviderDto[];
  secretStorage: {
    kind: "local_database";
    description: string;
  };
};

export type LlmProviderDto = {
  id: LlmProviderId;
  label: string;
  apiStyle: LlmApiStyle;
  apiKeyRequired: boolean;
  configured: boolean;
  model: string;
  baseUrl?: string;
  keyPreview?: string;
  keySource?: "environment" | "settings";
  customBaseUrl: boolean;
  local: boolean;
};

export type LlmProviderUpdateInput = {
  activeProvider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  clearApiKey?: unknown;
  model?: unknown;
  remoteEnrichmentEnabled?: unknown;
};

export type LlmProviderModelListInput = {
  activeProvider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
};

export type LlmProviderModelOptionDto = {
  id: string;
  label: string;
};

type StoredLlmProviderSettings = {
  version: 1;
  activeProvider: LlmProviderId;
  remoteEnrichmentEnabled: boolean;
  providers: Record<LlmProviderId, StoredProviderSettings>;
};

type StoredProviderSettings = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

type EffectiveProviderConfig = {
  apiKey?: string;
  apiStyle: LlmApiStyle;
  apiKeyRequired: boolean;
  baseUrl?: string;
  configured: boolean;
  id: LlmProviderId;
  label: string;
  local: boolean;
  model: string;
  remoteEnrichmentEnabled: boolean;
};

type ProviderDefinition = {
  apiStyle: LlmApiStyle;
  apiKeyRequired: boolean;
  baseUrl?: string;
  customBaseUrl: boolean;
  defaultModel: string;
  label: string;
  local: boolean;
};

const settingKey = "llm_provider";
const providerDefinitions: Record<LlmProviderId, ProviderDefinition> = {
  openai: {
    apiStyle: "responses",
    apiKeyRequired: true,
    baseUrl: "https://api.openai.com/v1",
    customBaseUrl: false,
    defaultModel: "gpt-5-nano-2025-08-07",
    label: "OpenAI",
    local: false
  },
  openai_compatible: {
    apiStyle: "chat_completions",
    apiKeyRequired: true,
    customBaseUrl: true,
    defaultModel: "",
    label: "OpenAI-compatible",
    local: false
  },
  anthropic: {
    apiStyle: "anthropic_messages",
    apiKeyRequired: true,
    customBaseUrl: false,
    defaultModel: "claude-sonnet-4-6",
    label: "Anthropic",
    local: false
  },
  gemini: {
    apiStyle: "gemini_generate_content",
    apiKeyRequired: true,
    customBaseUrl: false,
    defaultModel: "gemini-3.5-flash",
    label: "Gemini",
    local: false
  },
  ollama: {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:11434/v1",
    customBaseUrl: true,
    defaultModel: "llama3.1",
    label: "Ollama",
    local: true
  },
  lm_studio: {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:1234/v1",
    customBaseUrl: true,
    defaultModel: "local-model",
    label: "LM Studio",
    local: true
  },
  vllm: {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8000/v1",
    customBaseUrl: true,
    defaultModel: "meta-llama/Llama-3.1-8B-Instruct",
    label: "vLLM",
    local: true
  },
  llama_cpp: {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8080/v1",
    customBaseUrl: true,
    defaultModel: "local-model",
    label: "llama.cpp",
    local: true
  },
  localai: {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8080/v1",
    customBaseUrl: true,
    defaultModel: "local-model",
    label: "LocalAI",
    local: true
  }
};
const providerIds = Object.keys(providerDefinitions) as LlmProviderId[];

export function getLlmProviderSettings(db: MastheadDatabase, config: DaemonConfig): LlmProviderSettingsDto {
  const stored = readStoredSettings(db, config);
  return {
    activeProvider: stored.activeProvider,
    providers: providerIds.map((id) => providerConfig(stored, config, id)),
    remoteEnrichmentEnabled: stored.remoteEnrichmentEnabled,
    secretStorage: {
      kind: "local_database",
      description: "API keys are stored only in the local Masthead settings database and are never returned by the settings API."
    }
  };
}

export function updateLlmProviderSettings(
  db: MastheadDatabase,
  config: DaemonConfig,
  input: LlmProviderUpdateInput
): LlmProviderSettingsDto {
  const current = readStoredSettings(db, config);
  const activeProvider = providerId(input.activeProvider ?? current.activeProvider);
  const remoteEnrichmentEnabled = typeof input.remoteEnrichmentEnabled === "boolean" ? input.remoteEnrichmentEnabled : current.remoteEnrichmentEnabled;
  const next: StoredLlmProviderSettings = {
    ...current,
    activeProvider,
    providers: {
      ...providerIds.reduce<Record<LlmProviderId, StoredProviderSettings>>(
        (providers, id) => {
          providers[id] = { ...current.providers[id] };
          return providers;
        },
        {} as Record<LlmProviderId, StoredProviderSettings>
      )
    },
    remoteEnrichmentEnabled
  };
  const provider = next.providers[activeProvider];

  if (typeof input.model === "string") provider.model = normalizeModel(input.model, activeProvider);
  if (input.baseUrl !== undefined) {
    const previousBaseUrl = provider.baseUrl ?? providerDefinitions[activeProvider].baseUrl;
    provider.baseUrl = normalizeBaseUrl(input.baseUrl, activeProvider);
    if (provider.baseUrl !== previousBaseUrl && typeof input.apiKey !== "string") delete provider.apiKey;
  }
  if (input.clearApiKey === true) delete provider.apiKey;
  if (typeof input.apiKey === "string" && input.apiKey.trim()) provider.apiKey = input.apiKey.trim();

  const definition = providerDefinitions[activeProvider];
  const effectiveBaseUrl = provider.baseUrl ?? definition.baseUrl;
  const effectiveModel = provider.model || definition.defaultModel;
  const effectiveApiKey = provider.apiKey ?? (activeProvider === "openai" ? config.openaiApiKey?.trim() : undefined);
  if (remoteEnrichmentEnabled && definition.customBaseUrl && !effectiveBaseUrl) {
    throw new Error(providerRequirementMessage(activeProvider, definition, "an HTTP base URL"));
  }
  if (remoteEnrichmentEnabled && !effectiveModel) {
    throw new Error(`${definition.label} requires a model.`);
  }
  if (remoteEnrichmentEnabled && definition.apiKeyRequired && !effectiveApiKey) {
    throw new Error(providerRequirementMessage(activeProvider, definition, "an API key"));
  }

  writeStoredSettings(db, next);
  return getLlmProviderSettings(db, config);
}

export function effectiveLlmProvider(db: MastheadDatabase, config: DaemonConfig): EffectiveProviderConfig {
  const stored = readStoredSettings(db, config);
  const definition = providerDefinitions[stored.activeProvider];
  const provider = stored.providers[stored.activeProvider];
  const apiKey = stored.activeProvider === "openai" ? provider.apiKey ?? config.openaiApiKey?.trim() : provider.apiKey;
  const model = provider.model || (stored.activeProvider === "openai" ? config.openaiModel || definition.defaultModel : definition.defaultModel);
  const baseUrl = provider.baseUrl ?? definition.baseUrl;
  return {
    apiKey,
    apiStyle: definition.apiStyle,
    apiKeyRequired: definition.apiKeyRequired,
    baseUrl,
    configured: Boolean(model) && (!definition.customBaseUrl || Boolean(baseUrl)) && (!definition.apiKeyRequired || Boolean(apiKey)),
    id: stored.activeProvider,
    label: definition.label,
    local: definition.local,
    model,
    remoteEnrichmentEnabled: stored.remoteEnrichmentEnabled
  };
}

export async function listLlmProviderModels(
  db: MastheadDatabase,
  config: DaemonConfig,
  input: LlmProviderModelListInput,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<LlmProviderModelOptionDto[]> {
  const stored = readStoredSettings(db, config);
  const activeProvider = providerId(input.activeProvider ?? stored.activeProvider);
  const definition = providerDefinitions[activeProvider];
  if (!definition.customBaseUrl) {
    throw new Error(`${definition.label} does not expose a configurable model list endpoint.`);
  }

  const provider = stored.providers[activeProvider];
  const baseUrl = normalizeBaseUrl(typeof input.baseUrl === "string" ? input.baseUrl : provider.baseUrl ?? definition.baseUrl, activeProvider);
  if (!baseUrl) throw new Error(providerRequirementMessage(activeProvider, definition, "an HTTP base URL"));
  const inputApiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
  const persistedBaseUrl = provider.baseUrl ?? definition.baseUrl;
  const apiKey = inputApiKey ?? (sameBaseUrl(baseUrl, persistedBaseUrl) ? provider.apiKey : undefined);
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const response = await fetchImpl(`${baseUrl}/models`, { headers });
  if (!response.ok) throw new Error(`${definition.label} model discovery failed with HTTP ${response.status}.`);
  const body = (await response.json()) as unknown;
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  return data
    .map((item): LlmProviderModelOptionDto | undefined => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return undefined;
      const id = item.id.trim();
      return { id, label: id };
    })
    .filter((item): item is LlmProviderModelOptionDto => Boolean(item));
}

export function createSettingsBackedEnrichmentProvider(db: MastheadDatabase, config: DaemonConfig): SessionEnrichmentProvider {
  const deterministic = createDeterministicEnrichmentProvider();
  const currentRemote = () => {
    const effective = effectiveLlmProvider(db, config);
    if (!effective.remoteEnrichmentEnabled || !effective.configured) return undefined;
    if (effective.id === "anthropic") {
      return createAnthropicEnrichmentProvider({
        apiKey: effective.apiKey,
        enabled: true,
        model: effective.model || undefined,
        timeoutMs: config.remoteEnrichmentTimeoutMs
      });
    }
    if (effective.id === "gemini") {
      return createGeminiEnrichmentProvider({
        apiKey: effective.apiKey,
        enabled: true,
        model: effective.model || undefined,
        timeoutMs: config.remoteEnrichmentTimeoutMs
      });
    }
    return createOpenAIEnrichmentProvider({
      apiKey: effective.apiKey,
      apiStyle: effective.id === "openai" ? "responses" : "chat_completions",
      baseUrl: effective.baseUrl,
      enabled: true,
      model: effective.model || undefined,
      apiKeyRequired: effective.apiKeyRequired,
      providerId: effective.id,
      timeoutMs: config.remoteEnrichmentTimeoutMs
    });
  };
  return {
    get id() {
      return currentRemote()?.id ?? deterministic.id;
    },
    get model() {
      return currentRemote()?.model ?? deterministic.model;
    },
    enrich(input) {
      const remote = currentRemote();
      const effective = effectiveLlmProvider(db, config);
      if (!remote || (!effective.local && !remoteEnrichmentAllowedForSession(db, input.facts.sessionId))) return deterministic.enrich(input);
      return remote.enrich(input);
    }
  };
}

function remoteEnrichmentAllowedForSession(db: MastheadDatabase, sessionId: string): boolean {
  const rows = db
    .prepare("SELECT source_id AS sourceId FROM session_sources WHERE session_id = ?")
    .all(sessionId) as Array<{ sourceId: string }>;
  if (rows.length === 0) return sourcePolicyEnabled(db, "enrichment");
  return rows.some((row) => sourcePolicyEnabled(db, "enrichment", row.sourceId));
}

function providerConfig(stored: StoredLlmProviderSettings, config: DaemonConfig, id: LlmProviderId): LlmProviderDto {
  const definition = providerDefinitions[id];
  const provider = stored.providers[id];
  const envKey = id === "openai" ? config.openaiApiKey?.trim() : undefined;
  const apiKey = provider.apiKey ?? envKey;
  const model = provider.model || (id === "openai" ? config.openaiModel || definition.defaultModel : definition.defaultModel);
  const baseUrl = provider.baseUrl ?? definition.baseUrl;
  return {
    apiStyle: definition.apiStyle,
    apiKeyRequired: definition.apiKeyRequired,
    baseUrl,
    configured: Boolean(model) && (!definition.customBaseUrl || Boolean(baseUrl)) && (!definition.apiKeyRequired || Boolean(apiKey)),
    customBaseUrl: definition.customBaseUrl,
    id,
    keyPreview: apiKey ? keyPreview(apiKey) : undefined,
    keySource: provider.apiKey ? "settings" : envKey ? "environment" : undefined,
    label: definition.label,
    local: definition.local,
    model
  };
}

function readStoredSettings(db: MastheadDatabase, config: DaemonConfig): StoredLlmProviderSettings {
  const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = ?").get(settingKey) as
    | { value: string }
    | undefined;
  const parsed = row ? parseSettings(row.value) : undefined;
  return {
    activeProvider: parsed?.activeProvider ?? "openai",
    providers: providerIds.reduce<Record<LlmProviderId, StoredProviderSettings>>(
      (providers, id) => {
        providers[id] = {
          apiKey: parsed?.providers[id]?.apiKey,
          baseUrl: parsed?.providers[id]?.baseUrl,
          model: parsed?.providers[id]?.model
        };
        return providers;
      },
      {} as Record<LlmProviderId, StoredProviderSettings>
    ),
    remoteEnrichmentEnabled: parsed?.remoteEnrichmentEnabled ?? Boolean(config.remoteEnrichmentEnabled),
    version: 1
  };
}

function parseSettings(value: string): StoredLlmProviderSettings | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    const providers = typeof record.providers === "object" && record.providers !== null ? (record.providers as Record<string, unknown>) : {};
    return {
      activeProvider: providerId(record.activeProvider),
      providers: providerIds.reduce<Record<LlmProviderId, StoredProviderSettings>>((stored, id) => {
        stored[id] = storedProvider(providers[id]);
        return stored;
      }, {} as Record<LlmProviderId, StoredProviderSettings>),
      remoteEnrichmentEnabled: record.remoteEnrichmentEnabled === true,
      version: 1
    };
  } catch {
    return undefined;
  }
}

function storedProvider(value: unknown): StoredProviderSettings {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    apiKey: typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined,
    baseUrl: typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl.trim() : undefined,
    model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined
  };
}

function writeStoredSettings(db: MastheadDatabase, settings: StoredLlmProviderSettings): void {
  db.prepare(
    `INSERT INTO app_settings (setting_key, setting_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_json = excluded.setting_json,
      updated_at = excluded.updated_at`
  ).run(settingKey, JSON.stringify(settings), new Date().toISOString());
}

function providerId(value: unknown): LlmProviderId {
  if (value === "anthropic") return "anthropic";
  if (value === "gemini") return "gemini";
  if (value === "ollama") return "ollama";
  if (value === "lm_studio" || value === "lm-studio") return "lm_studio";
  if (value === "vllm") return "vllm";
  if (value === "llama_cpp" || value === "llama-cpp") return "llama_cpp";
  if (value === "localai") return "localai";
  if (value === "openai_compatible" || value === "openai-compatible") return "openai_compatible";
  if (value === "openai") return "openai";
  throw new Error("Unsupported LLM provider.");
}

function normalizeModel(value: string, provider: LlmProviderId): string {
  const model = value.trim();
  if (model) return model;
  return providerDefinitions[provider].defaultModel;
}

function normalizeBaseUrl(value: unknown, provider: LlmProviderId): string | undefined {
  if (!providerDefinitions[provider].customBaseUrl) return providerDefinitions[provider].baseUrl;
  if (typeof value !== "string" || !value.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(providerRequirementMessage(provider, providerDefinitions[provider], "an HTTP base URL"));
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(providerRequirementMessage(provider, providerDefinitions[provider], "an HTTP base URL"));
  }
  assertAllowedProviderUrl(parsed, provider);
  return parsed.toString().replace(/\/$/, "");
}

function assertAllowedProviderUrl(url: URL, provider: LlmProviderId): void {
  const definition = providerDefinitions[provider];
  const hostname = url.hostname.toLowerCase();
  if (definition.local) {
    if (!isLoopbackHost(hostname)) throw new Error(`${definition.label} base URL must use localhost or loopback.`);
    return;
  }
  if (url.protocol !== "https:") throw new Error(`${definition.label} base URL must use HTTPS.`);
  if (isUnsafeRemoteHost(hostname)) throw new Error(`${definition.label} base URL cannot target local or private network hosts.`);
}

function isUnsafeRemoteHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "metadata.google.internal") return true;
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

function isPrivateIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map((part) => Number(part));
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function sameBaseUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

function providerRequirementMessage(provider: LlmProviderId, definition: ProviderDefinition, requirement: string): string {
  if (provider === "openai_compatible") return `OpenAI-compatible providers require ${requirement}.`;
  return `${definition.label} requires ${requirement}.`;
}

function keyPreview(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
