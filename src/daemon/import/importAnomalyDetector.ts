import type { ImportAnomaly } from "../../shared/sourceImport.ts";

export type { ImportAnomaly, ImportAnomalyCode } from "../../shared/sourceImport.ts";

export type ImportAnomalyMetrics = {
  recordsRecognized: number;
  recordsRejected: number;
  sessionsFinalized: number;
  oneMessageSessions: number;
  sessionsWithUserOrAssistant: number;
  outOfRangeSessions: number;
  toolRoleMessages: number;
  structuredToolItems: number;
  epochTimestampSessions: number;
};

export function detectImportAnomalies(metrics: ImportAnomalyMetrics): ImportAnomaly[] {
  const anomalies: ImportAnomaly[] = [];
  if (
    metrics.sessionsFinalized >= 50 &&
    metrics.recordsRecognized / metrics.sessionsFinalized <= 1.1 &&
    metrics.oneMessageSessions / metrics.sessionsFinalized >= 0.9
  ) {
    anomalies.push({
      code: "record_id_session_explosion",
      count: metrics.sessionsFinalized,
      message: `${metrics.sessionsFinalized} sessions were finalized from nearly one recognized record each.`,
      severity: "error"
    });
  }
  if (metrics.sessionsFinalized >= 20 && metrics.sessionsWithUserOrAssistant === 0) {
    anomalies.push({
      code: "conversation_roles_missing",
      count: metrics.sessionsFinalized,
      message: `${metrics.sessionsFinalized} finalized sessions contain no user or assistant messages.`,
      severity: "error"
    });
  }
  const recordsExamined = metrics.recordsRecognized + metrics.recordsRejected;
  if (
    metrics.recordsRejected >= 100 &&
    recordsExamined > 0 &&
    metrics.recordsRejected / recordsExamined >= 0.5
  ) {
    anomalies.push({
      code: "schema_rejection_dominates",
      count: metrics.recordsRejected,
      message: `${metrics.recordsRejected} records were rejected, at least half of all examined records.`,
      severity: "error"
    });
  }
  if (metrics.outOfRangeSessions > 0) {
    anomalies.push({
      code: "out_of_range_sessions",
      count: metrics.outOfRangeSessions,
      message: `${metrics.outOfRangeSessions} sessions were finalized outside the selected recent import range.`,
      severity: "error"
    });
  }
  if (metrics.toolRoleMessages >= 20 && metrics.structuredToolItems === 0) {
    anomalies.push({
      code: "tool_evidence_not_normalized",
      count: metrics.toolRoleMessages,
      message: `${metrics.toolRoleMessages} tool-role messages produced no normalized tool calls or results.`,
      severity: "error"
    });
  }
  if (
    metrics.sessionsFinalized >= 20 &&
    metrics.epochTimestampSessions / metrics.sessionsFinalized >= 0.25
  ) {
    anomalies.push({
      code: "epoch_timestamp_dominates",
      count: metrics.epochTimestampSessions,
      message: `${metrics.epochTimestampSessions} finalized sessions use Unix epoch timestamps.`,
      severity: "error"
    });
  }
  return anomalies;
}
