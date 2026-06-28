export const RUNTIME_KINDS = [
  "codex",
  "cursor",
  "claude_code",
  "antigravity",
  "opencode",
  "aider",
  "openclaw",
  "hermes",
  "pi",
  "omp",
  "cline",
  "roo_code",
  "kilo_code",
  "continue_dev",
  "openhands",
  "github_copilot",
  "windsurf",
  "zed_ai",
  "amazon_q",
  "sourcegraph_amp",
  "jetbrains_ai",
  "qodo",
  "tabnine",
  "ibm_bob",
  "devin",
  "jules",
  "gemini_cli",
  "crush"
] as const;

export type RuntimeKind = (typeof RUNTIME_KINDS)[number];
export type SourceKind = "stream" | "hook" | "sdk" | "sqlite" | "jsonl" | "ui_signal" | "inference";
export type SourceConfidence = "authoritative" | "inferred" | "heuristic";

export type DiscoveryContext = {
  homeDir: string;
  now: string;
  exclusions: SourceExclusion[];
};

export type SourceExclusion = {
  pattern: string;
  reason: string;
};

export type DiscoveredSource = {
  sourceId: string;
  runtime: RuntimeKind;
  sourceKind: SourceKind;
  path?: string;
  endpoint?: string;
  schemaVersion?: string;
  runtimeVersion?: string;
  confidence: SourceConfidence;
};

export type SourceInventory = {
  source: DiscoveredSource;
  sessionCount: number;
  recordCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  failures: AdapterDiagnostic[];
};

export type IngestCursor = {
  cursorId: string;
  sourceId: string;
  sourcePath?: string;
  byteOffset: number;
  modifiedAt?: string;
  contentFingerprint?: string;
  sourceSessionId?: string;
  cwd?: string;
  model?: string;
};

export type AdapterRecord = {
  source: DiscoveredSource;
  sourceRecordKey: string;
  observedAt: string;
  payloadHash: string;
  payload: unknown;
  normalized: NormalizedAdapterPayload;
  diagnostics: AdapterDiagnostic[];
};

export type NormalizedAdapterPayload = {
  kind:
    | "session"
    | "event"
    | "message"
    | "tool_call"
    | "tool_result"
    | "runtime_signal"
    | "usage"
    | "relationship"
    | "checkpoint";
  confidence: SourceConfidence;
  sourceRef: {
    sourceKind: SourceKind;
    sourcePath?: string;
    endpoint?: string;
    schemaVersion?: string;
    runtimeVersion?: string;
  };
  value: unknown;
};

export type AdapterDiagnostic = {
  code: string;
  count?: number;
  message: string;
  severity: "info" | "warning" | "error";
  observedAt: string;
  sampleSourceIds?: string[];
  details?: string;
};

export type CanonicalSession = {
  sessionId: string;
  sourceSessionId: string;
  runtime: RuntimeKind;
};

export type OpenSourceTarget = {
  label: string;
  uri: string;
};

export interface SessionAdapter {
  readonly runtime: RuntimeKind;
  discover(context: DiscoveryContext): Promise<DiscoveredSource[]>;
  inspect(source: DiscoveredSource): Promise<SourceInventory>;
  backfill(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord>;
  watch(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord>;
  openSource?(session: CanonicalSession): Promise<OpenSourceTarget | undefined>;
}
