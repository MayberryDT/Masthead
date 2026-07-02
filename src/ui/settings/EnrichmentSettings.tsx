import { useEffect, useMemo, useState } from "react";
import {
  listLlmProviderModels,
  type LlmProviderDto,
  type LlmProviderId,
  type LlmProviderModelOptionDto,
  type SettingsStateDto,
  type UpdateLlmProviderSettingsInput
} from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { FilterableSelect } from "../primitives/FilterableSelect";
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsToggle } from "./SettingsToggle";

type EnrichmentSettingsProps = {
  enrichment?: SettingsStateDto["enrichment"];
  llm?: SettingsStateDto["llm"];
  readOnly?: boolean;
  settingsBaseUrl?: string;
  onSaveProvider?: (input: UpdateLlmProviderSettingsInput) => Promise<void> | void;
};

type InlineStatus = {
  tone: "error" | "success";
  message: string;
};

export function EnrichmentSettings({
  enrichment,
  llm,
  onSaveProvider,
  readOnly = false,
  settingsBaseUrl
}: EnrichmentSettingsProps) {
  const providers = useMemo(() => llm?.providers ?? fallbackProviders, [llm?.providers]);
  const [activeProvider, setActiveProvider] = useState<LlmProviderId>(llm?.activeProvider ?? "openai");
  const [remoteEnabled, setRemoteEnabled] = useState(Boolean(llm?.remoteEnrichmentEnabled));
  const [model, setModel] = useState(activeProviderModel(providers, llm?.activeProvider ?? "openai"));
  const [providerBaseUrl, setProviderBaseUrl] = useState(activeProviderBaseUrl(providers, llm?.activeProvider ?? "openai"));
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<InlineStatus>();
  const [modelRefreshStatus, setModelRefreshStatus] = useState<InlineStatus>();
  const [modelOptions, setModelOptions] = useState<LlmProviderModelOptionDto[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedProvider = providers.find((provider) => provider.id === activeProvider) ?? providers[0];
  const health = enrichment?.health;
  const disabled = readOnly || !llm || !onSaveProvider || saving;
  const canRefreshModels = Boolean(selectedProvider?.customBaseUrl) && !readOnly && Boolean(llm);
  const apiKeyRequired = selectedProvider?.apiKeyRequired !== false;
  const canClearSavedKey = Boolean(selectedProvider?.keyPreview && selectedProvider.keySource === "settings" && onSaveProvider && !readOnly);
  const coverage =
    enrichment && health
      ? `${formatCount(health.complete)} of ${formatCount(enrichment.sessionCount)} sessions current`
      : "Loading";

  useEffect(() => {
    if (!llm) return;
    setActiveProvider(llm.activeProvider);
    setRemoteEnabled(llm.remoteEnrichmentEnabled);
    setModel(activeProviderModel(llm.providers, llm.activeProvider));
    setProviderBaseUrl(activeProviderBaseUrl(llm.providers, llm.activeProvider));
    setApiKey("");
    setModelOptions([]);
    setModelRefreshStatus(undefined);
  }, [llm]);

  const changeProvider = (value: string | undefined) => {
    const nextProvider = providerIdFromValue(providers, value);
    setActiveProvider(nextProvider);
    setModel(activeProviderModel(providers, nextProvider));
    setProviderBaseUrl(activeProviderBaseUrl(providers, nextProvider));
    setApiKey("");
    setModelOptions([]);
    setModelRefreshStatus(undefined);
    setStatus(undefined);
  };

  const refreshModels = async () => {
    if (!selectedProvider?.customBaseUrl || !llm) return;
    const trimmedBaseUrl = providerBaseUrl.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedBaseUrl) {
      setModelRefreshStatus({ tone: "error", message: `Add a base URL before refreshing ${selectedProvider.label} models.` });
      return;
    }

    setRefreshingModels(true);
    setModelRefreshStatus(undefined);
    try {
      const models = await listLlmProviderModels(
        {
          activeProvider,
          baseUrl: trimmedBaseUrl,
          ...(trimmedKey ? { apiKey: trimmedKey } : {})
        },
        settingsBaseUrl
      );
      setModelOptions(models);
      if (!model.trim() && models[0]) setModel(models[0].id);
      const sample = models.find((option) => option.id !== model.trim()) ?? models[0];
      const sampleMessage = sample ? ` ${sample.label} available.` : "";
      setModelRefreshStatus({
        tone: "success",
        message: `${formatCount(models.length)} ${models.length === 1 ? "model" : "models"} found.${sampleMessage}`
      });
    } catch (error) {
      setModelOptions([]);
      setModelRefreshStatus({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRefreshingModels(false);
    }
  };

  const save = async (clearApiKey = false) => {
    if (!onSaveProvider || !llm) return;
    const trimmedModel = model.trim();
    const trimmedBaseUrl = providerBaseUrl.trim();
    const trimmedKey = apiKey.trim();
    if (remoteEnabled && selectedProvider?.customBaseUrl && !trimmedBaseUrl) {
      setStatus({ tone: "error", message: `Add a base URL before enabling ${selectedProvider.label}.` });
      return;
    }
    if (remoteEnabled && !trimmedModel) {
      setStatus({ tone: "error", message: "Add a model before enabling remote enrichment." });
      return;
    }
    if (remoteEnabled && apiKeyRequired && !trimmedKey && !selectedProvider?.configured && !clearApiKey) {
      setStatus({ tone: "error", message: "Add an API key before enabling remote enrichment." });
      return;
    }

    const input: UpdateLlmProviderSettingsInput = {
      activeProvider,
      clearApiKey,
      model: trimmedModel,
      remoteEnrichmentEnabled: remoteEnabled
    };
    if (selectedProvider?.customBaseUrl) input.baseUrl = trimmedBaseUrl;
    if (trimmedKey && !clearApiKey) input.apiKey = trimmedKey;

    setSaving(true);
    setStatus(undefined);
    try {
      await onSaveProvider(input);
      setApiKey("");
      setStatus({ tone: "success", message: clearApiKey ? "Saved key cleared." : "LLM provider saved." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      eyebrow="Enrichment"
      title="LLM provider"
      description="Connect optional LLM enrichment. Masthead still works locally when this is off."
    >
      <SettingsRow
        description="When enabled, Masthead sends redacted session facts to the selected provider for titles and summaries."
        label="Remote enrichment"
        value={
          <SettingsToggle
            checked={remoteEnabled}
            disabled={disabled}
            label="Use remote LLM enrichment"
            offLabel="Remote off"
            onChange={setRemoteEnabled}
            onLabel="Remote on"
          />
        }
      />
      <SettingsRow
        description={selectedProvider ? apiStyleLabel(selectedProvider) : "Loading provider configuration."}
        label="Provider"
        control={
          <FilterableSelect
            allowCustomValue={false}
            clearable={false}
            disabled={disabled}
            emptyLabel="No providers"
            icon="model"
            label="LLM provider"
            onChange={changeProvider}
            options={providers.map((provider) => ({ label: provider.label, value: provider.id }))}
            placeholder="Choose provider"
            searchPlaceholder="Search providers"
            value={activeProvider}
          />
        }
      />
      <SettingsRow
        description={selectedProvider ? connectionDescription(selectedProvider) : "Loading provider configuration."}
        label="Connection"
        control={
          <div className="settings-provider-form">
            {selectedProvider?.customBaseUrl ? (
              <label className="settings-provider-field">
                <span>Base URL</span>
                <input
                  type="url"
                  value={providerBaseUrl}
                  disabled={disabled}
                  placeholder="http://127.0.0.1:11434/v1"
                  onChange={(event) => {
                    setProviderBaseUrl(event.currentTarget.value);
                    setModelOptions([]);
                    setModelRefreshStatus(undefined);
                  }}
                />
              </label>
            ) : null}
            <label className="settings-provider-field">
              <span>Model</span>
              {modelOptions.length > 0 ? (
                <FilterableSelect
                  allowCustomValue
                  clearable={false}
                  disabled={disabled}
                  emptyLabel="No models"
                  icon="model"
                  label="Model"
                  onChange={(value) => setModel(value ?? "")}
                  options={modelOptions.map((option) => ({ label: option.label, value: option.id }))}
                  placeholder={modelPlaceholder(activeProvider)}
                  searchPlaceholder="Search models"
                  value={model || undefined}
                />
              ) : (
                <input
                  type="text"
                  value={model}
                  disabled={disabled}
                  placeholder={modelPlaceholder(activeProvider)}
                  onChange={(event) => setModel(event.currentTarget.value)}
                />
              )}
            </label>
            {canRefreshModels ? (
              <div className="settings-provider-inline-actions">
                <AppButton disabled={disabled || refreshingModels} onClick={() => void refreshModels()}>
                  {refreshingModels ? "Refreshing..." : "Refresh models"}
                </AppButton>
                {modelRefreshStatus ? (
                  <p className={`settings-provider-status ${modelRefreshStatus.tone}`}>{modelRefreshStatus.message}</p>
                ) : null}
              </div>
            ) : null}
            <label className="settings-provider-field">
              <span>{apiKeyRequired ? "API key" : "API key (optional)"}</span>
              <input
                type="password"
                value={apiKey}
                disabled={disabled}
                placeholder={apiKeyPlaceholder(selectedProvider)}
                autoComplete="off"
                onChange={(event) => setApiKey(event.currentTarget.value)}
              />
            </label>
          </div>
        }
      />
      <SettingsRow
        description={llm?.secretStorage.description ?? "API keys are stored locally and never shown after saving."}
        label="Saved key"
        value={<StatusBadge tone={selectedProvider?.configured ? "active" : "neutral"}>{keyStatus(selectedProvider)}</StatusBadge>}
      />
      <SettingsRow
        description={health ? `Queued ${formatCount(health.queued)}, failed ${formatCount(health.failed)}, disabled ${formatCount(health.disabled)}.` : undefined}
        label="Coverage"
        value={coverage}
      />
      <div className="settings-provider-actions">
        <AppButton variant="primary" disabled={disabled} onClick={() => void save(false)}>
          {saving ? "Saving..." : "Save provider"}
        </AppButton>
        <AppButton disabled={!canClearSavedKey || saving} onClick={() => void save(true)}>
          Clear saved key
        </AppButton>
        {status ? <p className={`settings-provider-status ${status.tone}`}>{status.message}</p> : null}
      </div>
    </SettingsSection>
  );
}

const fallbackProviders: LlmProviderDto[] = [
  {
    apiKeyRequired: true,
    apiStyle: "responses",
    baseUrl: "https://api.openai.com/v1",
    configured: false,
    customBaseUrl: false,
    id: "openai",
    label: "OpenAI",
    local: false,
    model: "gpt-5-nano-2025-08-07"
  },
  {
    apiKeyRequired: true,
    apiStyle: "chat_completions",
    configured: false,
    customBaseUrl: true,
    id: "openai_compatible",
    label: "OpenAI-compatible",
    local: false,
    model: ""
  },
  {
    apiKeyRequired: true,
    apiStyle: "anthropic_messages",
    configured: false,
    customBaseUrl: false,
    id: "anthropic",
    label: "Anthropic",
    local: false,
    model: "claude-sonnet-4-6"
  },
  {
    apiKeyRequired: true,
    apiStyle: "gemini_generate_content",
    configured: false,
    customBaseUrl: false,
    id: "gemini",
    label: "Gemini",
    local: false,
    model: "gemini-3.5-flash"
  },
  {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:11434/v1",
    configured: false,
    customBaseUrl: true,
    id: "ollama",
    label: "Ollama",
    local: true,
    model: "llama3.1"
  },
  {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:1234/v1",
    configured: false,
    customBaseUrl: true,
    id: "lm_studio",
    label: "LM Studio",
    local: true,
    model: "local-model"
  },
  {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8000/v1",
    configured: false,
    customBaseUrl: true,
    id: "vllm",
    label: "vLLM",
    local: true,
    model: "meta-llama/Llama-3.1-8B-Instruct"
  },
  {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8080/v1",
    configured: false,
    customBaseUrl: true,
    id: "llama_cpp",
    label: "llama.cpp",
    local: true,
    model: "local-model"
  },
  {
    apiKeyRequired: false,
    apiStyle: "chat_completions",
    baseUrl: "http://127.0.0.1:8080/v1",
    configured: false,
    customBaseUrl: true,
    id: "localai",
    label: "LocalAI",
    local: true,
    model: "local-model"
  }
];

function providerIdFromValue(providers: LlmProviderDto[], value: string | undefined): LlmProviderId {
  const match = providers.find((provider) => provider.id === value);
  return match?.id ?? "openai";
}

function activeProviderModel(providers: LlmProviderDto[], id: LlmProviderId): string {
  return providers.find((provider) => provider.id === id)?.model ?? "";
}

function activeProviderBaseUrl(providers: LlmProviderDto[], id: LlmProviderId): string {
  return providers.find((provider) => provider.id === id)?.baseUrl ?? "";
}

function apiStyleLabel(provider: LlmProviderDto): string {
  if (provider.local) return "Uses OpenAI-compatible chat completions through a local model server.";
  switch (provider.apiStyle) {
    case "anthropic_messages":
      return "Uses Anthropic Messages with structured outputs.";
    case "chat_completions":
      return "Uses OpenAI-compatible chat completions.";
    case "gemini_generate_content":
      return "Uses Gemini generateContent with structured output.";
    case "responses":
    default:
      return "Uses the OpenAI Responses API.";
  }
}

function connectionDescription(provider: LlmProviderDto): string {
  if (provider.id === "ollama") return "Ollama's local OpenAI-compatible server, usually http://127.0.0.1:11434/v1.";
  if (provider.id === "lm_studio") return "LM Studio's local OpenAI-compatible server, usually http://127.0.0.1:1234/v1.";
  if (provider.id === "vllm") return "vLLM's OpenAI-compatible server, usually http://127.0.0.1:8000/v1.";
  if (provider.id === "llama_cpp") return "llama.cpp server's OpenAI-compatible /v1 endpoint.";
  if (provider.id === "localai") return "LocalAI's OpenAI-compatible /v1 endpoint.";
  if (provider.customBaseUrl) return "Use an OpenAI-compatible /v1 endpoint such as a local model server.";
  if (provider.id === "anthropic") return "Anthropic uses the hosted Messages API endpoint.";
  if (provider.id === "gemini") return "Gemini uses the hosted Google AI generateContent endpoint.";
  return "OpenAI uses the hosted /v1 endpoint.";
}

function modelPlaceholder(provider: LlmProviderId): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-6";
    case "gemini":
      return "gemini-3.5-flash";
    case "ollama":
      return "llama3.1";
    case "lm_studio":
      return "local-model";
    case "vllm":
      return "meta-llama/Llama-3.1-8B-Instruct";
    case "llama_cpp":
    case "localai":
    case "openai_compatible":
      return "llama-3.1";
    case "openai":
    default:
      return "gpt-5-nano-2025-08-07";
  }
}

function apiKeyPlaceholder(provider: LlmProviderDto | undefined): string {
  if (provider?.keyPreview) return "Leave blank to keep saved key";
  if (provider?.apiKeyRequired === false) return "Optional API key";
  return "Paste API key";
}

function keyStatus(provider: LlmProviderDto | undefined): string {
  if (!provider) return "No key saved";
  if (provider.apiKeyRequired === false && !provider.keyPreview) return "No key required";
  if (!provider.configured) return "No key saved";
  const source = provider.keySource === "environment" ? "environment" : "settings";
  return `${provider.keyPreview ?? "Saved key"} from ${source}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
