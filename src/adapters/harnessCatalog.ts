import type { RuntimeKind, SourceKind } from "./types.ts";

export type AdapterSupportLevel =
  | "active_full"
  | "active_transcript"
  | "active_metadata"
  | "detector_only"
  | "cloud_reference"
  | "legacy";

export type HarnessVisibility = "onboarding" | "advanced" | "hidden_legacy";

export type HarnessCatalogEntry = {
  runtime: RuntimeKind;
  label: string;
  aliases: string[];
  description: string;
  supportLevel: AdapterSupportLevel;
  visibility: HarnessVisibility;
  sourceKinds: SourceKind[];
  localFirst: boolean;
  cloudOnly: boolean;
  knownCandidatePaths: string[];
  envOverrides: string[];
  supportsMetadataImport: boolean;
  supportsTranscriptImport: boolean;
  supportsLiveWatch: boolean;
  supportsTokenUsage: boolean;
  supportsFileEffects: boolean;
  supportsMcpExposure: boolean;
};

export const HARNESS_CATALOG: HarnessCatalogEntry[] = [
  active("codex", "Codex", ["OpenAI Codex", "Codex CLI"], "Codex local hook, metadata, and transcript stores.", "active_full", ["hook", "jsonl"], [
    "~/.codex/session_index.jsonl",
    "~/.codex/history.jsonl",
    "~/.codex/sessions",
    "~/.codex/archived_sessions"
  ], ["MASTHEAD_CODEX_HOME", "CODEX_HOME"], { live: true, tokens: true, files: true }),
  active("cursor", "Cursor", ["Cursor Agent"], "Cursor local SQLite conversation and workspace history.", "active_transcript", ["sqlite"], [
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    "~/Library/Application Support/Cursor/User/workspaceStorage",
    "~/.config/Cursor/User/globalStorage/state.vscdb",
    "~/.config/Cursor/User/workspaceStorage",
    "%APPDATA%/Cursor/User/globalStorage/state.vscdb",
    "%APPDATA%/Cursor/User/workspaceStorage"
  ], ["MASTHEAD_CURSOR_HOME", "CURSOR_DB_PATH"]),
  active("claude_code", "Claude Code", ["Claude"], "Claude Code local project conversation history.", "active_transcript", ["jsonl"], [
    "~/.claude/projects",
    "~/.claude/conversations",
    "~/.claude/history"
  ], ["MASTHEAD_CLAUDE_CODE_HOME", "CLAUDE_HOME"], { tokens: true, files: true }),
  active("antigravity", "Antigravity", ["Google Antigravity"], "Google Antigravity local agent history and artifacts when schema is recognized.", "active_metadata", ["sqlite", "jsonl"], [
    "~/Library/Application Support/Antigravity",
    "~/.config/Antigravity",
    "%APPDATA%/Antigravity"
  ], ["MASTHEAD_ANTIGRAVITY_HOME", "ANTIGRAVITY_HOME"], { files: true }),
  active("opencode", "OpenCode", ["OpenCode AI"], "OpenCode local session history.", "active_transcript", ["jsonl", "sqlite"], [
    "~/.opencode",
    "~/.local/share/opencode",
    "~/.config/opencode"
  ], ["MASTHEAD_OPENCODE_HOME", "OPENCODE_HOME"], { tokens: true, files: true }),
  active("crush", "Crush", ["Charm Crush"], "Crush local session history, grouped with OpenCode-style sources where possible.", "detector_only", ["jsonl", "sqlite"], [
    "~/.crush",
    "~/.local/share/crush",
    "~/.config/crush"
  ], ["MASTHEAD_CRUSH_HOME", "CRUSH_HOME"]),
  active("aider", "Aider", ["Aider Chat"], "Aider markdown and chat history files.", "active_transcript", ["jsonl", "ui_signal"], [
    "~/.aider",
    "~/.aider.chat.history.md",
    "~/.aider.input.history",
    "project:.aider*"
  ], ["MASTHEAD_AIDER_HOME", "AIDER_HOME"], { tokens: true, files: true }),
  active("openclaw", "OpenClaw", ["OpenClaw Agent"], "OpenClaw local session and agent history.", "active_transcript", ["jsonl", "sqlite"], [
    "~/.openclaw",
    "~/.local/share/openclaw",
    "~/.config/openclaw"
  ], ["MASTHEAD_OPENCLAW_HOME", "OPENCLAW_HOME"], { tokens: true, files: true }),
  active("hermes", "Hermes", ["Hermes Agent"], "Hermes local agent/session state.", "active_transcript", ["sqlite", "jsonl"], [
    "~/.hermes/state.db",
    "~/.hermes",
    "~/.local/share/hermes"
  ], ["MASTHEAD_HERMES_HOME", "HERMES_HOME"], { tokens: true, files: true }),
  active("pi", "Pi", ["Pi Mono"], "Pi local session history when schema is recognized.", "active_metadata", ["sqlite", "jsonl"], [
    "~/.pi",
    "~/.local/share/pi",
    "~/.config/pi"
  ], ["MASTHEAD_PI_HOME", "PI_HOME"]),
  active("omp", "Oh My Pi", ["OMP", "oh-my-pi", "pi-coding-agent"], "Oh My Pi / OMP coding agent local state. OMP advertises on-disk sessions for --resume, so Masthead scans conservative OMP homes until the exact schema is verified.", "detector_only", ["sqlite", "jsonl"], [
    "~/.omp",
    "~/.oh-my-pi",
    "~/.local/share/omp",
    "~/.config/omp",
    "~/.local/share/oh-my-pi",
    "~/.config/oh-my-pi"
  ], ["MASTHEAD_OMP_HOME", "OMP_HOME", "OH_MY_PI_HOME"]),
  active("cline", "Cline", ["Claude Dev", "saoudrizwan.claude-dev"], "Cline VS Code extension task and chat history.", "detector_only", ["sqlite", "jsonl"], vscodeExtensionPaths(["cline", "saoudrizwan.claude-dev"]), ["MASTHEAD_CLINE_HOME", "CLINE_HOME"]),
  active("roo_code", "Roo Code", ["Roo", "Roo Cline"], "Roo Code VS Code extension task and chat history.", "detector_only", ["sqlite", "jsonl"], vscodeExtensionPaths(["roo", "roo-code", "rooveterinaryinc"]), ["MASTHEAD_ROO_CODE_HOME", "ROO_CODE_HOME"]),
  active("kilo_code", "Kilo Code", ["Kilo"], "Kilo Code VS Code extension task and chat history.", "detector_only", ["sqlite", "jsonl"], vscodeExtensionPaths(["kilo", "kilo-code"]), ["MASTHEAD_KILO_CODE_HOME", "KILO_CODE_HOME"]),
  active("continue_dev", "Continue.dev", ["Continue"], "Continue.dev IDE assistant local state and configuration.", "detector_only", ["sqlite", "jsonl"], [
    "~/.continue",
    "~/.config/continue",
    ...vscodeExtensionPaths(["continue"])
  ], ["MASTHEAD_CONTINUE_HOME", "CONTINUE_HOME"]),
  active("openhands", "OpenHands", ["OpenHands CLI"], "OpenHands local workspace/server state when available.", "detector_only", ["sqlite", "jsonl"], [
    "~/.openhands",
    "~/.local/share/openhands",
    "~/.config/openhands",
    "project:.openhands"
  ], ["MASTHEAD_OPENHANDS_HOME", "OPENHANDS_HOME"]),
  active("github_copilot", "GitHub Copilot", ["Copilot Chat", "Copilot CLI"], "GitHub Copilot local IDE chat stores where accessible.", "detector_only", ["sqlite", "jsonl"], [
    ...vscodeExtensionPaths(["github.copilot", "github.copilot-chat"]),
    "~/.config/github-copilot",
    "~/.github-copilot"
  ], ["MASTHEAD_GITHUB_COPILOT_HOME", "GITHUB_COPILOT_HOME"]),
  active("windsurf", "Windsurf", ["Cascade"], "Windsurf/Cascade Code-like workspace and assistant history.", "detector_only", ["sqlite", "jsonl"], [
    "~/Library/Application Support/Windsurf",
    "~/.config/Windsurf",
    "%APPDATA%/Windsurf"
  ], ["MASTHEAD_WINDSURF_HOME", "WINDSURF_HOME"]),
  active("zed_ai", "Zed AI", ["Zed Agent", "Zed Assistant"], "Zed assistant and agent panel local state where available.", "detector_only", ["sqlite", "jsonl"], [
    "~/Library/Application Support/Zed",
    "~/.config/zed",
    "~/.local/share/zed",
    "%APPDATA%/Zed"
  ], ["MASTHEAD_ZED_HOME", "ZED_HOME"]),
  active("amazon_q", "Amazon Q Developer", ["Amazon Q", "Q Developer"], "Amazon Q Developer local CLI/IDE state where accessible.", "detector_only", ["sqlite", "jsonl"], [
    "~/.aws/amazonq",
    "~/.aws/amazon-q",
    "~/.local/share/amazon-q",
    ...vscodeExtensionPaths(["amazonwebservices.amazon-q", "amazon-q"])
  ], ["MASTHEAD_AMAZON_Q_HOME", "AMAZON_Q_HOME"]),
  active("sourcegraph_amp", "Sourcegraph Amp", ["Amp"], "Sourcegraph Amp local CLI/editor agent state where available.", "detector_only", ["sqlite", "jsonl"], [
    "~/.amp",
    "~/.sourcegraph/amp",
    "~/.config/amp",
    "~/.local/share/amp"
  ], ["MASTHEAD_AMP_HOME", "AMP_HOME"]),
  active("jetbrains_ai", "JetBrains AI", ["JetBrains AI Assistant"], "JetBrains AI Assistant IDE state where local history is accessible.", "detector_only", ["sqlite", "jsonl"], [
    "~/Library/Application Support/JetBrains",
    "~/.config/JetBrains",
    "~/.local/share/JetBrains",
    "%APPDATA%/JetBrains"
  ], ["MASTHEAD_JETBRAINS_AI_HOME", "JETBRAINS_AI_HOME"]),
  active("qodo", "Qodo", ["CodiumAI", "Qodo Gen"], "Qodo/Codium local IDE assistant state where accessible.", "detector_only", ["sqlite", "jsonl"], [
    ...vscodeExtensionPaths(["qodo", "codium"]),
    "~/.qodo",
    "~/.codiumai"
  ], ["MASTHEAD_QODO_HOME", "QODO_HOME", "CODIUMAI_HOME"]),
  active("tabnine", "Tabnine", ["TabNine"], "Tabnine local chat/completion state where accessible.", "detector_only", ["sqlite", "jsonl"], [
    "~/.tabnine",
    "~/.config/TabNine",
    "~/.local/share/TabNine",
    ...vscodeExtensionPaths(["tabnine"])
  ], ["MASTHEAD_TABNINE_HOME", "TABNINE_HOME"]),
  active("ibm_bob", "IBM Bob", ["Bob"], "IBM Bob local agent state where available.", "detector_only", ["sqlite", "jsonl"], [
    "~/.ibm/bob",
    "~/.bob",
    "~/.config/ibm-bob",
    ...vscodeExtensionPaths(["ibm.bob", "bob"])
  ], ["MASTHEAD_IBM_BOB_HOME", "IBM_BOB_HOME"]),
  cloudReference("devin", "Devin", ["Cognition Devin"], "Cloud-first agent. Local source connector is not available in this pass."),
  cloudReference("jules", "Jules", ["Google Jules"], "Cloud-first agent. Local source connector is not available in this pass."),
  {
    aliases: ["Gemini CLI"],
    cloudOnly: false,
    description: "Legacy Gemini CLI compatibility for existing imported records. Antigravity is the forward-looking Google local agent path.",
    envOverrides: [],
    knownCandidatePaths: [],
    label: "Gemini CLI",
    localFirst: true,
    runtime: "gemini_cli",
    sourceKinds: ["jsonl"],
    supportLevel: "legacy",
    supportsFileEffects: false,
    supportsLiveWatch: false,
    supportsMcpExposure: true,
    supportsMetadataImport: false,
    supportsTokenUsage: false,
    supportsTranscriptImport: false,
    visibility: "hidden_legacy"
  }
];

export function onboardingHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.visibility === "onboarding" && !entry.cloudOnly);
}

export function advancedHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.visibility !== "hidden_legacy");
}

export function harnessForRuntime(runtime: RuntimeKind): HarnessCatalogEntry | undefined {
  return HARNESS_CATALOG.find((entry) => entry.runtime === runtime);
}

export function localHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.localFirst && !entry.cloudOnly);
}

export function cloudReferenceHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.cloudOnly);
}

type SupportOverrides = Partial<{
  files: boolean;
  live: boolean;
  tokens: boolean;
}>;

function active(
  runtime: RuntimeKind,
  label: string,
  aliases: string[],
  description: string,
  supportLevel: AdapterSupportLevel,
  sourceKinds: SourceKind[],
  knownCandidatePaths: string[],
  envOverrides: string[],
  overrides: SupportOverrides = {}
): HarnessCatalogEntry {
  const supportsTranscriptImport = supportLevel === "active_full" || supportLevel === "active_transcript" || supportLevel === "active_metadata" || supportLevel === "detector_only";
  return {
    aliases,
    cloudOnly: false,
    description,
    envOverrides,
    knownCandidatePaths,
    label,
    localFirst: true,
    runtime,
    sourceKinds,
    supportLevel,
    supportsFileEffects: overrides.files ?? false,
    supportsLiveWatch: overrides.live ?? false,
    supportsMcpExposure: true,
    supportsMetadataImport: true,
    supportsTokenUsage: overrides.tokens ?? false,
    supportsTranscriptImport,
    visibility: "onboarding"
  };
}

function cloudReference(runtime: RuntimeKind, label: string, aliases: string[], description: string): HarnessCatalogEntry {
  return {
    aliases,
    cloudOnly: true,
    description,
    envOverrides: [],
    knownCandidatePaths: [],
    label,
    localFirst: false,
    runtime,
    sourceKinds: [],
    supportLevel: "cloud_reference",
    supportsFileEffects: false,
    supportsLiveWatch: false,
    supportsMcpExposure: false,
    supportsMetadataImport: false,
    supportsTokenUsage: false,
    supportsTranscriptImport: false,
    visibility: "advanced"
  };
}

function vscodeExtensionPaths(extensionHints: string[]): string[] {
  const roots = [
    "~/Library/Application Support/Code/User/globalStorage",
    "~/Library/Application Support/Code/User/workspaceStorage",
    "~/.config/Code/User/globalStorage",
    "~/.config/Code/User/workspaceStorage",
    "%APPDATA%/Code/User/globalStorage",
    "%APPDATA%/Code/User/workspaceStorage"
  ];
  return roots.flatMap((root) => extensionHints.map((hint) => `${root}/${hint}*`));
}
