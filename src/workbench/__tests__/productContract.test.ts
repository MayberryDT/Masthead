import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("artifact authoring product contract", () => {
  test("documents one canonical dossier and candidate-driven optional artifacts", async () => {
    const context = await readFile(resolve("CONTEXT.md"), "utf8");
    const normalized = context.replace(/\s+/g, " ");

    expect(context).toContain("Agents never author a session dossier body");
    expect(context).toContain(
      "A dossier artifact is an immutable canonical dossier snapshot",
    );
    expect(context).toContain(
      "Optional artifact work begins from a positive-evidence artifact candidate",
    );
    expect(context).toContain("One authoring contract V2 run owns exactly one candidate group");
    expect(context).toContain("The daemon verifies the excerpt against canonical evidence");
    expect(context).toContain("V1 bundles or completed runs are never reusable by V2");
    expect(normalized).not.toContain(
      "exactly one published/N/A/contributed resolution path for every runbook",
    );
    expect(normalized).not.toContain(
      "runbook, ADR, and incident timeline are each either published or explicitly not applicable",
    );
    expect(normalized).not.toContain(
      "published session package plus runbook/ADR/timeline each published or N/A",
    );
  });
});
