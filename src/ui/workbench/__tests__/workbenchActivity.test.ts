import { describe, expect, test } from "vitest";
import {
  formatWorkbenchActivityTime,
  workbenchActivityLabel,
  workbenchActivityReason,
  workbenchActivityTone
} from "../workbenchActivity";

describe("workbenchActivityTone", () => {
  test("maps lifecycle events to tones", () => {
    expect(workbenchActivityTone("transcript_checked")).toBe("info");
    expect(workbenchActivityTone("transcript_import_queued")).toBe("info");
    expect(workbenchActivityTone("transcript_permission_required")).toBe("warn");
    expect(workbenchActivityTone("quality_passed")).toBe("ok");
    expect(workbenchActivityTone("quality_failed")).toBe("bad");
    expect(workbenchActivityTone("claimed")).toBe("claim");
    expect(workbenchActivityTone("claim_released")).toBe("mute");
    expect(workbenchActivityTone("published")).toBe("ok");
    expect(workbenchActivityTone("publication_gate_failed")).toBe("bad");
    expect(workbenchActivityTone("unknown_event")).toBe("mute");
  });

  test.each([
    ["authoring_request_created", "Request created", "info"],
    ["authoring_pack_claimed", "Pack claimed", "claim"],
    ["authoring_pack_finished", "Pack finished", "ok"],
    ["authoring_session_published", "Session published", "ok"],
    ["authoring_session_soft_flagged", "Session soft-flagged", "warn"],
    ["authoring_session_rejected", "Session rejected", "bad"],
    ["authoring_optional_artifact_published", "Optional artifact published", "ok"],
    ["authoring_optional_considered_no", "Optional considered — no", "info"],
    ["authoring_request_completed", "Request completed", "ok"],
    ["authoring_daemon_error", "Daemon error", "bad"],
    ["database_identity_mismatch", "Identity error", "bad"]
  ] as const)("presents %s as a clear V5 Activity state", (eventType, label, tone) => {
    expect(workbenchActivityLabel(eventType)).toBe(label);
    expect(workbenchActivityTone(eventType)).toBe(tone);
  });

  test("surfaces editorial findings and explicit errors without inventing a reason", () => {
    expect(workbenchActivityReason({
      details: {
        findings: [
          { code: "thin_key_work", message: "Key work is too thin." },
          { code: "weak_verification", message: "Verification wording is weak." }
        ]
      },
      eventType: "authoring_session_soft_flagged"
    })).toBe("Key work is too thin. · Verification wording is weak.");
    expect(workbenchActivityReason({
      details: { reason: "The daemon instance changed while the request was active." },
      eventType: "database_identity_mismatch"
    })).toBe("The daemon instance changed while the request was active.");
    expect(workbenchActivityReason({ details: {}, eventType: "authoring_session_published" })).toBeUndefined();
  });

  test("does not translate unproduced authoring event aliases", () => {
    expect(workbenchActivityLabel("optional_considered_no")).toBe("optional_considered_no");
    expect(workbenchActivityLabel("authoring_optional_artifact_considered_no"))
      .toBe("authoring_optional_artifact_considered_no");
    expect(workbenchActivityLabel("daemon_error")).toBe("daemon_error");
  });
});

describe("formatWorkbenchActivityTime", () => {
  test("returns locale time for valid ISO and falls back for invalid", () => {
    const iso = "2026-07-08T12:34:56.000Z";
    const formatted = formatWorkbenchActivityTime(iso);
    expect(formatted).toBe(new Date(iso).toLocaleTimeString(undefined, { hour12: false }));
    expect(formatWorkbenchActivityTime("not-a-date")).toBe("not-a-date");
  });
});
