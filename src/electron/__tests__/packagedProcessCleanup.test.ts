import { describe, expect, test } from "vitest";
import {
  buildWindowsProcessSnapshotInvocation,
  buildWindowsTaskkillInvocation,
  collectWindowsDescendantPids,
  parseWindowsListenerPid,
  parseWindowsProcessSnapshot,
  windowsProcessBelongsToTree
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

  test("parses CIM process snapshots and retains descendants after the root exits", () => {
    const snapshot = parseWindowsProcessSnapshot(JSON.stringify([
      { ProcessId: 11, ParentProcessId: 10 },
      { ProcessId: 12, ParentProcessId: 11 },
      { ProcessId: 13, ParentProcessId: 12 },
      { ProcessId: 20, ParentProcessId: 1 }
    ]));

    expect(collectWindowsDescendantPids(snapshot, [10])).toEqual([11, 12, 13]);
    expect(windowsProcessBelongsToTree(snapshot, 13, [10, 11])).toBe(true);
    expect(windowsProcessBelongsToTree(snapshot, 20, [10, 11, 12, 13])).toBe(false);
  });

  test("parses a single CIM process and builds the PowerShell snapshot command", () => {
    expect(parseWindowsProcessSnapshot('{"ProcessId":42,"ParentProcessId":7}')).toEqual([
      { parentPid: 7, pid: 42 }
    ]);
    expect(buildWindowsProcessSnapshotInvocation("C:\\Windows")).toEqual({
      args: expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
      command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    });
  });
});
