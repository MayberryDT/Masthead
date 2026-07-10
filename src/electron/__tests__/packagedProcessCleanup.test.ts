import { describe, expect, test } from "vitest";
import {
  buildWindowsTaskkillInvocation,
  parseWindowsListenerPid
} from "../../../scripts/packaged-process-cleanup.js";

describe("packaged process cleanup", () => {
  test("finds the PID listening on the exact Windows smoke port", () => {
    const output = [
      "  TCP    127.0.0.1:17373      0.0.0.0:0       LISTENING       111",
      "  TCP    [::1]:5173           [::]:0          LISTENING       222",
      "  TCP    127.0.0.1:5173       0.0.0.0:0       LISTENING       333"
    ].join("\r\n");

    expect(parseWindowsListenerPid(output, 5173)).toBe(333);
    expect(parseWindowsListenerPid(output, 9999)).toBeUndefined();
  });

  test("builds bounded graceful and forceful taskkill tree commands", () => {
    expect(buildWindowsTaskkillInvocation(4242, false, "C:\\Windows")).toEqual({
      args: ["/pid", "4242", "/t"],
      command: "C:\\Windows\\System32\\taskkill.exe"
    });
    expect(buildWindowsTaskkillInvocation(4242, true, "C:\\Windows").args).toEqual([
      "/pid",
      "4242",
      "/t",
      "/f"
    ]);
  });
});
