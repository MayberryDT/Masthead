import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("packaged authoring CLI smoke coverage", () => {
  test("resource preparation asserts the bundled runtime and CLI entry", async () => {
    const source = await readFile("scripts/prepare-electron-resources.js", "utf8");

    expect(source).toContain("await access(nodeTarget, constants.X_OK)");
    expect(source).toContain("await access(cliTarget, constants.R_OK)");
  });

  test("packaged smoke invokes the capability-reported launcher from an isolated home", async () => {
    const source = await readFile("scripts/masthead-electron-packaged-smoke.js", "utf8");

    expect(source).toContain('const homeDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-home-"))');
    expect(source).toContain("HOME: homeDir");
    expect(source).toContain('fetch(`${baseUrl}/workbench/authoring/capabilities`');
    expect(source).toContain("capabilities.command");
    expect(source).toContain('["workbench", "capabilities", "--json"]');
    expect(source).not.toContain("MASTHEAD_DAEMON_URL: baseUrl");
  });
});
