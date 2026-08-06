import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("packaged authoring CLI smoke coverage", () => {
  test("resource preparation asserts the bundled runtime and CLI entry", async () => {
    const source = await readFile("scripts/prepare-electron-resources.js", "utf8");

    expect(source).toContain("await access(nodeTarget, constants.X_OK)");
    expect(source).toContain("await access(cliTarget, constants.R_OK)");
    expect(source).toContain("await access(maintenanceTarget, constants.R_OK)");
    expect(source).toContain("masthead-production.js");
    expect(source).toContain("masthead-production-cold-activation.js");
    expect(source).toContain("packaged-bundle-manifest.js");
    expect(source).toContain("release.json");
    expect(source).toContain('execFileSync("git", ["rev-parse", "HEAD"]');
    expect(source).toContain("bundleRelocatableNode");
    expect(source).toContain("installOfficialNodeBinary");
    expect(source).toContain("assertNodeRunsStandalone");
    expect(source).toContain("nodejs.org/dist");
  });

  test("packaged smoke invokes the capability-reported launcher from the isolated instance directory", async () => {
    const source = await readFile("scripts/masthead-electron-packaged-smoke.js", "utf8");
    const cleanupSource = await readFile("scripts/packaged-process-cleanup.js", "utf8");

    expect(source).toContain('homeDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-home-"))');
    expect(source).toContain("HOME: homeDir");
    expect(source).toContain('fetch(`${baseUrl}/workbench/authoring/capabilities`');
    expect(source).toContain("capabilities.command");
    expect(source).toContain("verifyPackagedAuthoringCli(");
    expect(source).toContain("dataDir,");
    expect(source).toContain("const commandRelativeToDataDirectory = relative(dataDir, capabilities.command)");
    expect(source).toContain("Packaged authoring CLI was installed outside the smoke data directory");
    expect(source).not.toContain("commandRelativeToHome");
    expect(source).toContain('["workbench", "capabilities", "--json"]');
    expect(source).not.toContain("MASTHEAD_DAEMON_URL: baseUrl");
    expect(source).toContain("buildPackagedCliInvocation");
    expect(source).not.toContain("shell: process.platform");
    expect(source).toContain("finally {");
    expect(source).toContain("await terminateChild");
    expect(source).toContain('child.kill("SIGKILL")');
    expect(source).toContain("processGroupMayRemain");
    expect(cleanupSource).toContain('"taskkill.exe"');
    expect(source).toContain("findWindowsListenerPid");
    expect(source).toContain("assertProcessTreeStopped");
    expect(source).toContain("startWindowsProcessTreeTracker");
    expect(source).toContain("windowsProcessBelongsToTree");
    expect(source).toContain("processTree: true");
    expect(source).toContain("cleanupError");
    expect(source).toContain("verificationAbort.abort()");
    expect(source).toContain("const electronTimeout = new Promise");
    expect(source).toContain("let settled = false");
    expect(source).toContain("await rm(dataDir");
    expect(source).toContain("await rm(homeDir");
    expect(source).toContain('join(resources, "release.json")');
    expect(source).toContain("productionTransitionMaintenance.js");
    expect(source).toContain("verifyPackagedBundleManifest");
    expect(source).toContain("resolvePackagedExecutableLayout");
    expect(source).toContain("release-manifest.json");
    expect(source).toContain("health?.buildVersion");
    expect(source).toContain("health?.buildSha");
  });

  test("Forge writes the final content manifest after packaging", async () => {
    const source = await readFile("forge.config.ts", "utf8");

    expect(source).toContain("writeForgePackagedBundleManifests");
    expect(source).toContain("postPackage");
    expect(source).toContain('appBundleId: "ai.animas.masthead"');
    expect(source).toContain("@electron-forge/maker-dmg");
    expect(source).toContain('platforms: ["darwin"]');
  });
});
