export type SessionTranscriptKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "checkpoint"
  | "runtime_signal"
  | "file_effect";

export type SessionTranscriptRole = "user" | "assistant" | "system" | "tool" | "unknown";

export type SessionTranscriptItem = {
  itemId: string;
  sessionId: string;
  kind: SessionTranscriptKind;
  role: SessionTranscriptRole;
  label: string;
  text: string;
  observedAt: string;
  sourceRef: unknown;
  status?: string;
  exitCode?: number;
  toolName?: string;
  collapsedByDefault?: boolean;
  lowValue?: boolean;
};

export type SessionTranscriptCoverage = {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  checkpoints: number;
  runtimeSignals: number;
  fileEffects: number;
  lowValueItems: number;
  hasUsableTranscript: boolean;
};

export type SessionTranscriptResult = {
  items: SessionTranscriptItem[];
  total: number;
  nextCursor?: string;
  coverage: SessionTranscriptCoverage;
};
