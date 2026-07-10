import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("installs the authoring CLI before the renderer can start a daemon", async () => {
  const source = await readFile("src/electron/main.ts", "utf8");

  expect(source).toContain('from "./cliLauncher"');
  expect(source).toContain("await installMastheadCliLauncher(target,");
  expect(source).toContain("process.env.MASTHEAD_CLI_COMMAND = target.launcherPath");
  expect(source).toContain("Masthead CLI launcher installation failed:");
  expect(source).toContain("delete process.env.MASTHEAD_CLI_COMMAND");
  expect(source.indexOf("await configureCliLauncher()")).toBeLessThan(source.indexOf("registerDesktopIpc()"));
  expect(source.indexOf("await configureCliLauncher()")).toBeLessThan(source.indexOf("createMainWindow(appIconPath)"));
  expect(source).toContain("prepareAuthoringLauncher: ({ baseUrl }) => configureCliLauncher(baseUrl, true)");
  expect(source).not.toContain("await configureCliLauncher(connector.baseUrl)");
  expect(source).not.toContain("await configureCliLauncher(result.baseUrl)");
});
