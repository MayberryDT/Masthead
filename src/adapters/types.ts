export const RUNTIME_KINDS = [
  "cursor",
  "claude_code",
  "opencode",
  "grok",
  "hermes",
  "pi",
  "omp"
] as const;

export const COMPAT_RUNTIME_KINDS = ["codex"] as const;
export const ALL_RUNTIME_KINDS = [...RUNTIME_KINDS, ...COMPAT_RUNTIME_KINDS] as const;

export type RuntimeKind = (typeof ALL_RUNTIME_KINDS)[number];
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
  sourceSessionId?: string;
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
