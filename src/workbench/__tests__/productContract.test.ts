import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("artifact authoring product contract", () => {
  test("documents guided V4 authoring and retires V3 writes", async () => {
    const active = await Promise.all([
      "CONTEXT.md",
      "README.md",
      "design.md",
      "prd.md",
      "openwiki/quickstart.md",
      "openwiki/logbook-and-workbench.md",
      "openwiki/data-and-integrations.md",
      "docs/reference/enrichment.md",
      "docs/reference/session-dossier.md",
      "docs/reference/artifact-first-logbook-cutover.md",
      "docs/reference/daemon-api.md",
      "docs/adr/0015-guided-authoring-campaigns.md",
    ].map((path) => readFile(resolve(path), "utf8")));
    const text = active.join("\n");

    expect(text).toContain("workbench-authoring-v4");
    expect(text).toContain("guided authoring request");
    expect(text).toContain("three-session canary");
    expect(text).toContain("operator approval");
    expect(text).toContain("instance-bound launcher");
    expect(text).toContain("high-signal opportunities require an evidence-backed disposition");
    expect(text).toContain("V1, V2, and V3 remain audit-only");
    expect(text).not.toContain("the agent must partition them");
  });
});
