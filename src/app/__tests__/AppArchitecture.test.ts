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
});
