import type { RuntimeKind, SourceKind } from "./types.ts";

export type AdapterSupportLevel =
  | "active_full"
  | "active_transcript"
  | "active_metadata"
  | "detector_only"
  | "cloud_reference"
  | "legacy";

export type HarnessVisibility = "onboarding" | "advanced" | "hidden_legacy";
export type HarnessRuntimeStatus = "catalog_only" | "scan_target" | "import_adapter" | "cloud_reference" | "legacy";

export type HarnessCatalogEntry = {
  runtime: RuntimeKind;
  label: string;
  aliases: string[];
  description: string;
  supportLevel: AdapterSupportLevel;
  runtimeStatus: HarnessRuntimeStatus;
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
  // Codex is live-capable (hooks + Workbench transcript path) but has no SessionAdapter bulk import.
  // detector_only + scan_target: live watch only; do not claim transcript import maturity.
  // Candidate paths stay narrow (sessions + hooks) so we do not deep-scan all of ~/.codex.
  // CODEX_HOME is the Codex install/config root; MASTHEAD_CODEX_HOME is user home (config), not here.
  {
    aliases: ["OpenAI Codex"],
    cloudOnly: false,
    description: "Codex local hooks and session history.",
    envOverrides: ["CODEX_HOME"],
    knownCandidatePaths: ["~/.codex/sessions", "~/.codex/hooks.json"],
    label: "Codex",
    localFirst: true,
    runtime: "codex",
    runtimeStatus: "scan_target",
    sourceKinds: ["hook", "jsonl"],
    supportLevel: "detector_only",
    supportsFileEffects: true,
    supportsLiveWatch: true,
    supportsMcpExposure: true,
    supportsMetadataImport: false,
    supportsTokenUsage: true,
    supportsTranscriptImport: false,
    visibility: "onboarding"
  },
  active("cursor", "Cursor", ["Cursor Agent"], "Cursor local SQLite conversation and workspace history.", "active_transcript", ["sqlite"], [
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    "~/Library/Application Support/Cursor/User/workspaceStorage",
    "~/.config/Cursor/User/globalStorage/state.vscdb",
    "~/.config/Cursor/User/workspaceStorage",
    "%APPDATA%/Cursor/User/globalStorage/state.vscdb",
    "%APPDATA%/Cursor/User/workspaceStorage"
  ], ["MASTHEAD_CURSOR_HOME", "CURSOR_DB_PATH"], { live: true }),
  active("claude_code", "Claude Code", ["Claude"], "Claude Code local project conversation history.", "active_transcript", ["jsonl"], [
    "~/.claude/projects",
    "~/.claude/conversations",
    "~/.claude/history"
  ], ["MASTHEAD_CLAUDE_CODE_HOME", "CLAUDE_HOME"], { live: true, tokens: true, files: true }),
  active("opencode", "OpenCode", ["OpenCode AI"], "OpenCode local session history.", "active_transcript", ["jsonl", "sqlite"], [
    "~/.opencode",
    "~/.local/share/opencode",
    "~/.config/opencode"
  ], ["MASTHEAD_OPENCODE_HOME", "OPENCODE_HOME"], { live: true, tokens: true, files: true }),
  active("grok", "Grok Build", ["Grok", "xAI Grok Build"], "Grok Build local hooks and session transcripts.", "active_transcript", ["hook", "jsonl"], [
    "~/.grok/hooks",
    "~/.grok/sessions"
  ], ["MASTHEAD_GROK_HOME", "GROK_HOME"], { live: true, tokens: true, files: true }),
  active("hermes", "Hermes", ["Hermes Agent"], "Hermes local agent/session state.", "active_transcript", ["sqlite", "jsonl"], [
    "~/.hermes/state.db",
    "~/.hermes",
    "~/.local/share/hermes"
  ], ["MASTHEAD_HERMES_HOME", "HERMES_HOME"], { live: true, tokens: true, files: true }),
  active("pi", "Pi", ["Pi Mono"], "Pi local session history when schema is recognized.", "active_transcript", ["sqlite", "jsonl"], [
    "~/.pi",
    "~/.local/share/pi",
    "~/.config/pi"
  ], ["MASTHEAD_PI_HOME", "PI_HOME"], { live: true }),
  active("omp", "Oh My Pi", ["OMP", "oh-my-pi", "pi-coding-agent"], "Oh My Pi / OMP local session history.", "active_transcript", ["jsonl"], [
    "~/.omp/agent/sessions",
    "~/.oh-my-pi/agent/sessions",
    "~/.local/share/omp/agent/sessions",
    "~/.config/omp/agent/sessions",
    "~/.local/share/oh-my-pi/agent/sessions",
    "~/.config/oh-my-pi/agent/sessions"
  ], ["MASTHEAD_OMP_HOME", "OMP_HOME", "OH_MY_PI_HOME"], { live: true })
];

export function onboardingHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.visibility === "onboarding" && canScanHarness(entry));
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
  return HARNESS_CATALOG.filter((entry) => entry.runtimeStatus === "cloud_reference");
}

export function scanTargetHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter(canScanHarness);
}

export function importAdapterHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter(canImportHarness);
}

export function catalogOnlyHarnesses(): HarnessCatalogEntry[] {
  return HARNESS_CATALOG.filter((entry) => entry.runtimeStatus === "catalog_only");
}

export function activeImportRuntimes(): RuntimeKind[] {
  return importAdapterHarnesses().map((entry) => entry.runtime);
}

export function canScanHarness(entry: HarnessCatalogEntry): boolean {
  return entry.runtimeStatus === "import_adapter" || entry.runtimeStatus === "scan_target";
}

export function canImportHarness(entry: HarnessCatalogEntry): boolean {
  return entry.runtimeStatus === "import_adapter";
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
  const runtimeStatus: HarnessRuntimeStatus = supportLevel === "detector_only" ? "scan_target" : "import_adapter";
  const supportsImport = runtimeStatus === "import_adapter";
  const supportsTranscriptImport = supportsImport && (supportLevel === "active_full" || supportLevel === "active_transcript");
  return {
    aliases,
    cloudOnly: false,
    description,
    envOverrides,
    knownCandidatePaths,
    label,
    localFirst: true,
    runtime,
    runtimeStatus,
    sourceKinds,
    supportLevel,
    supportsFileEffects: overrides.files ?? false,
    supportsLiveWatch: overrides.live ?? false,
    supportsMcpExposure: true,
    supportsMetadataImport: supportsImport,
    supportsTokenUsage: overrides.tokens ?? false,
    supportsTranscriptImport,
    visibility: "onboarding"
  };
}

