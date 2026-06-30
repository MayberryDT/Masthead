import { afterEach, describe, expect, test, vi } from "vitest";
import { recordRuntimeDiagnostic } from "../diagnostics.ts";

describe("daemon diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not recurse when console output is closed", () => {
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw error;
    });

    expect(() =>
      recordRuntimeDiagnostic({
        kind: "daemon_uncaught_exception",
        message: "Daemon uncaught exception",
        severity: "error",
        details: { error }
      })
    ).not.toThrow();
  });
});
