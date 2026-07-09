import { describe, expect, test } from "vitest";
import { formatWorkbenchActivityTime, workbenchActivityTone } from "../workbenchActivity";

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
});

describe("formatWorkbenchActivityTime", () => {
  test("returns locale time for valid ISO and falls back for invalid", () => {
    const iso = "2026-07-08T12:34:56.000Z";
    const formatted = formatWorkbenchActivityTime(iso);
    expect(formatted).toBe(new Date(iso).toLocaleTimeString(undefined, { hour12: false }));
    expect(formatWorkbenchActivityTime("not-a-date")).toBe("not-a-date");
  });
});
