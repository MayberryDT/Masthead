import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("artifact authoring product contract", () => {
  test("documents one canonical dossier and candidate-driven optional artifacts", async () => {
    const context = await readFile(resolve("CONTEXT.md"), "utf8");

    expect(context).toContain("Agents never author a session dossier body");
    expect(context).toContain(
      "A dossier artifact is an immutable canonical dossier snapshot",
    );
    expect(context).toContain(
      "Optional artifact work begins from a positive-evidence artifact candidate",
    );
    expect(context).not.toContain(
      "exactly one published/N/A/contributed resolution path for every runbook",
    );
  });
});
