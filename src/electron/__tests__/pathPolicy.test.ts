import { describe, expect, test } from "vitest";
import { isMastheadOwnedDirectory, packagedDaemonPaths } from "../pathPolicy";

describe("Electron path policy", () => {
  test("accepts only Masthead-owned data directories", () => {
    expect(isMastheadOwnedDirectory("/home/tyler/.local/share/masthead-dev")).toBe(true);
    expect(isMastheadOwnedDirectory("/tmp/masthead-doctor-acceptance")).toBe(true);
    expect(isMastheadOwnedDirectory("/home/tyler/Documents")).toBe(false);
    expect(isMastheadOwnedDirectory("/tmp/project")).toBe(false);
  });

  test("resolves packaged daemon resource paths", () => {
    expect(packagedDaemonPaths("/opt/Masthead/resources")).toEqual({
      daemonRoot: "/opt/Masthead/resources/daemon",
      nodePath: "/opt/Masthead/resources/daemon/node",
      daemonEntry: "/opt/Masthead/resources/daemon/dist/src/daemon/main.js",
      hookScript: "/opt/Masthead/resources/daemon/scripts/masthead-hook.js",
      mcpEntry: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
      releaseJson: "/opt/Masthead/resources/daemon/release.json"
    });
  });
});
