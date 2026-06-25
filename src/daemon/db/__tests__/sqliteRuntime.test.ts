import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

describe("SQLite runtime metadata", () => {
  test("declares a Node engine that supports node:sqlite without an experimental flag", async () => {
    const packageJsonPath = fileURLToPath(new URL("../../../../package.json", import.meta.url));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      engines?: {
        node?: string;
      };
    };

    expect(packageJson.engines?.node).toBe(">=22.13.0");
  });
});
