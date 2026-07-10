import { describe, expect, test } from "vitest";
import { buildPackagedCliInvocation } from "../../../scripts/packaged-cli-command.js";

describe("packaged CLI process invocation", () => {
  test("runs POSIX launchers directly", () => {
    expect(
      buildPackagedCliInvocation("/home/test/Masthead CLI/mastheadctl", ["workbench", "capabilities", "--json"], {
        platform: "linux"
      })
    ).toEqual({
      args: ["workbench", "capabilities", "--json"],
      command: "/home/test/Masthead CLI/mastheadctl",
      env: {}
    });
  });

  test("runs Windows command launchers through explicit ComSpec with escaped metacharacters", () => {
    expect(
      buildPackagedCliInvocation(
        "C:\\Users\\%TEMP% & 100%%\\Masthead CLI\\mastheadctl.cmd",
        ["workbench", "%TEMP% & capabilities", "--json"],
        { comspec: "C:\\Windows\\System32\\cmd.exe", platform: "win32" }
      )
    ).toEqual({
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        '""%MASTHEAD_PACKAGED_CLI%" "%MASTHEAD_PACKAGED_CLI_ARG_0%" "%MASTHEAD_PACKAGED_CLI_ARG_1%" "%MASTHEAD_PACKAGED_CLI_ARG_2%""'
      ],
      command: "C:\\Windows\\System32\\cmd.exe",
      env: {
        MASTHEAD_PACKAGED_CLI: "C:\\Users\\%TEMP% & 100%%\\Masthead CLI\\mastheadctl.cmd",
        MASTHEAD_PACKAGED_CLI_ARG_0: "workbench",
        MASTHEAD_PACKAGED_CLI_ARG_1: "%TEMP% & capabilities",
        MASTHEAD_PACKAGED_CLI_ARG_2: "--json"
      }
    });
  });

  test("rejects control characters instead of passing them to cmd", () => {
    expect(() =>
      buildPackagedCliInvocation("C:\\Masthead\\mastheadctl.cmd", ["workbench\r\nwhoami"], {
        comspec: "C:\\Windows\\System32\\cmd.exe",
        platform: "win32"
      })
    ).toThrow("control characters");
  });
});
