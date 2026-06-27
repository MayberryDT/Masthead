import type { AdapterDiagnostic, RuntimeKind, SourceConfidence } from "./types.ts";

export type AdapterPathContentKind = "jsonl-file" | "jsonl-tree" | "sqlite-file" | "markdown-files" | "directory" | "unknown";

export type AdapterPathCandidate = {
  runtime: RuntimeKind;
  relativePath: string;
  contentKind: AdapterPathContentKind;
  sourceKind: "jsonl" | "sqlite" | "stream" | "sdk" | "ui_signal" | "inference";
  purpose: string;
  confidence: SourceConfidence;
  maxDepth?: number;
  legacy?: boolean;
};

export type AdapterPathPreflight = {
  runtime: RuntimeKind;
  relativePath: string;
  absolutePath: string;
  contentKind: AdapterPathContentKind;
  exists: boolean;
  readable: boolean;
  kind: "file" | "directory" | "missing" | "other";
  byteCount: number;
  candidateFileCount: number;
  candidateRecordCount: number;
  lastModifiedAt?: string;
  diagnostics: AdapterDiagnostic[];
};

export type AdapterRuntimePreflight = {
  runtime: RuntimeKind;
  state: "connected" | "degraded" | "not_detected" | "planned";
  discoveredCount: number;
  diagnostics: AdapterDiagnostic[];
  checkedPaths: AdapterPathPreflight[];
};
