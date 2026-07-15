import { describe, expect, test } from "vitest";
import { detectImportAnomalies } from "../importAnomalyDetector.ts";

describe("import anomaly detector", () => {
  test("flags record-id session explosions with missing conversation roles and dominant schema rejection", () => {
    expect(detectImportAnomalies({
      epochTimestampSessions: 0,
      oneMessageSessions: 1_001,
      outOfRangeSessions: 0,
      recordsRecognized: 1_001,
      recordsRejected: 202_390,
      sessionsFinalized: 1_001,
      sessionsWithUserOrAssistant: 0,
      structuredToolItems: 0,
      toolRoleMessages: 0
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "record_id_session_explosion", severity: "error" }),
      expect.objectContaining({ code: "conversation_roles_missing", severity: "error" }),
      expect.objectContaining({ code: "schema_rejection_dominates", severity: "error" })
    ]));
  });

  test("flags sessions created outside a recent import scope", () => {
    expect(detectImportAnomalies({
      epochTimestampSessions: 0,
      oneMessageSessions: 0,
      outOfRangeSessions: 3,
      recordsRecognized: 10,
      recordsRejected: 0,
      sessionsFinalized: 10,
      sessionsWithUserOrAssistant: 10,
      structuredToolItems: 0,
      toolRoleMessages: 0
    })).toContainEqual({
      code: "out_of_range_sessions",
      count: 3,
      message: "3 sessions were finalized outside the selected recent import range.",
      severity: "error"
    });
  });

  test("flags tool-role evidence that was not normalized into structured tools", () => {
    expect(detectImportAnomalies({
      epochTimestampSessions: 0,
      oneMessageSessions: 0,
      outOfRangeSessions: 0,
      recordsRecognized: 20,
      recordsRejected: 0,
      sessionsFinalized: 20,
      sessionsWithUserOrAssistant: 20,
      structuredToolItems: 0,
      toolRoleMessages: 20
    })).toContainEqual({
      code: "tool_evidence_not_normalized",
      count: 20,
      message: "20 tool-role messages produced no normalized tool calls or results.",
      severity: "error"
    });
  });

  test("flags epoch timestamps when they dominate finalized sessions", () => {
    expect(detectImportAnomalies({
      epochTimestampSessions: 5,
      oneMessageSessions: 0,
      outOfRangeSessions: 0,
      recordsRecognized: 20,
      recordsRejected: 0,
      sessionsFinalized: 20,
      sessionsWithUserOrAssistant: 20,
      structuredToolItems: 0,
      toolRoleMessages: 0
    })).toContainEqual(expect.objectContaining({
      code: "epoch_timestamp_dominates",
      count: 5,
      severity: "error"
    }));
  });

  test("returns no anomalies below deterministic thresholds", () => {
    expect(detectImportAnomalies({
      epochTimestampSessions: 4,
      oneMessageSessions: 44,
      outOfRangeSessions: 0,
      recordsRecognized: 49,
      recordsRejected: 99,
      sessionsFinalized: 49,
      sessionsWithUserOrAssistant: 49,
      structuredToolItems: 1,
      toolRoleMessages: 19
    })).toEqual([]);
  });
});
