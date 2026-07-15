import type { RuntimeKind } from "../adapters/types.ts";

export type ImportRepairSourceMapping = {
  sourceId: string;
  available: boolean;
  correctedSourceId?: string;
  adapterRuntime?: RuntimeKind;
  reason?: "source_not_discovered" | "adapter_unavailable" | "runtime_mismatch" | "ambiguous_candidates";
};

export type ImportRepairSourcePlan = ImportRepairSourceMapping & {
  importJobIds: string[];
};

export type ImportRepairPreservationReason = {
  sessionId: string;
  reason: "artifact_preserved" | "live_state" | "manual_decision" | "out_of_range" | "published_artifact" | "shared_ownership" | "source_linked_only" | "source_unavailable";
};

export type ImportRepairPreview = {
  importJobIds: string[];
  affectedSessions: string[];
  pseudoSessionsToRemove: string[];
  sessionsToReparse: string[];
  automaticSuppressionsToReopen: string[];
  outOfRangeSessionsToDefer: string[];
  preservedSessions: string[];
  preservationReasons: ImportRepairPreservationReason[];
  blockedPublishedSessions: string[];
  affectedArtifacts: string[];
  reimportSources: string[];
  cursorSourcesToReset: string[];
  unavailableSources: string[];
  sourcePlans: ImportRepairSourcePlan[];
  applyAllowed: boolean;
  planHash: string;
};

export type ImportRepairReceipt = {
  importJobIds: string[];
  planHash: string;
  removedSessions: string[];
  resetSessions: string[];
  reopenedSuppressions: string[];
  preservedSessions: string[];
  blockedPublishedSessions: string[];
  reimportSources: string[];
  cursorSourcesToReset: string[];
  reimportJobIds: string[];
};
