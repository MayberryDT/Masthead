import type { RuntimeKind, SourceKind } from "./types.ts";

export type AdapterMaturity = "planned" | "detector" | "metadata" | "transcript" | "full";
export type AdapterLifecycle = "active" | "planned" | "legacy_planned";

export type AdapterCapability = {
  runtime: RuntimeKind;
  label: string;
  description: string;
  maturity: AdapterMaturity;
  sourceKinds: SourceKind[];
  supportsMetadataImport: boolean;
  supportsTranscriptImport: boolean;
  supportsLiveWatch: boolean;
  supportsTokenUsage: boolean;
  supportsFileEffects: boolean;
  supportsMcpExposure: boolean;
};

export type AdapterCapabilityProfile = AdapterCapability & {
  lifecycle: AdapterLifecycle;
};

export const ADAPTER_CAPABILITY_PROFILES = [
  {
    description: "Codex local hook, metadata, and transcript stores.",
    label: "Codex",
    lifecycle: "active",
    maturity: "full",
    runtime: "codex",
    sourceKinds: ["hook", "jsonl"],
    supportsFileEffects: true,
    supportsLiveWatch: true,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "Cursor local SQLite conversation and workspace history.",
    label: "Cursor",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "cursor",
    sourceKinds: ["sqlite"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: false,
    supportsTranscriptImport: true
  },
  {
    description: "Claude Code local project conversation history.",
    label: "Claude Code",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "claude_code",
    sourceKinds: ["jsonl"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "Google Antigravity local agent history and artifacts when schema is recognized.",
    label: "Antigravity",
    lifecycle: "active",
    maturity: "metadata",
    runtime: "antigravity",
    sourceKinds: ["sqlite", "jsonl"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: false,
    supportsTranscriptImport: true
  },
  {
    description: "OpenCode local session history.",
    label: "OpenCode",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "opencode",
    sourceKinds: ["jsonl", "sqlite"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "Aider markdown and chat history files.",
    label: "Aider",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "aider",
    sourceKinds: ["jsonl", "ui_signal"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "OpenClaw local session and agent history.",
    label: "OpenClaw",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "openclaw",
    sourceKinds: ["jsonl", "sqlite"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "Hermes local agent/session state.",
    label: "Hermes",
    lifecycle: "active",
    maturity: "transcript",
    runtime: "hermes",
    sourceKinds: ["sqlite", "jsonl"],
    supportsFileEffects: true,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: true,
    supportsTranscriptImport: true
  },
  {
    description: "Pi local session history when schema is recognized.",
    label: "Pi",
    lifecycle: "active",
    maturity: "metadata",
    runtime: "pi",
    sourceKinds: ["sqlite", "jsonl"],
    supportsFileEffects: false,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: false,
    supportsTranscriptImport: true
  },
  {
    description: "Legacy Gemini CLI compatibility for existing imported records.",
    label: "Gemini CLI",
    lifecycle: "legacy_planned",
    maturity: "planned",
    runtime: "gemini_cli",
    sourceKinds: ["jsonl"],
    supportsFileEffects: false,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: false,
    supportsTokenUsage: false,
    supportsTranscriptImport: false
  }
] as const satisfies AdapterCapabilityProfile[];

export function adapterCapabilityProfile(runtime: RuntimeKind): AdapterCapabilityProfile {
  return ADAPTER_CAPABILITY_PROFILES.find((profile) => profile.runtime === runtime)!;
}

export function canImportMetadata(capability: AdapterCapability): boolean {
  return capability.supportsMetadataImport && capability.maturity !== "planned" && capability.maturity !== "detector";
}

export function canImportTranscripts(capability: AdapterCapability): boolean {
  return capability.supportsTranscriptImport && (capability.maturity === "transcript" || capability.maturity === "full");
}
