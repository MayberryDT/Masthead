import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("App component architecture", () => {
  test("keeps Sources administration orchestration out of App.tsx", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).not.toContain("scanSources,");
    expect(appSource).not.toContain("syncAdapter,");
    expect(appSource).not.toContain("const loadSourceInventory");
    expect(appSource).not.toContain("const handleImportMetadata");
  });

  test("keeps Logbook loading orchestration out of App.tsx", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).not.toContain("searchLogbook,");
    expect(appSource).not.toContain("getLogbookSession,");
    expect(appSource).not.toContain("const handleLogbookQueryChange");
    expect(appSource).not.toContain("const handleLoadMoreLogbookTranscript");
  });

  test("keeps Settings data lifecycle orchestration out of App.tsx", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).not.toContain("deleteMastheadData as deleteCanonicalMastheadData");
    expect(appSource).not.toContain("const handleRequestDeleteLocalData");
    expect(appSource).not.toContain("const handleConfirmScopedDelete");
    expect(appSource).not.toContain("function downloadTextFile");
  });

  test("keeps Board detail loading orchestration out of App.tsx", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).not.toContain("getSessionDossier");
    expect(appSource).not.toContain("getSessionTranscript");
    expect(appSource).not.toContain("const handleLoadMoreBoardTranscript");
    expect(appSource).not.toContain("boardDossierRetryKey");
  });

  test("keeps the retired Usage surface out of App orchestration", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).not.toContain("UsageSurface");
    expect(appSource).not.toContain("UsagePanel");
    expect(appSource).not.toContain("useUsageStatsController");
  });

  test("wires receipt repair preview through the Sources controller without an apply action", async () => {
    const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
    const appSource = await readFile(appPath, "utf8");

    expect(appSource).toContain("onPreviewImportRepair={sourcesController.previewImportRepair}");
    expect(appSource).not.toContain("onApplyImportRepair=");
  });
});
