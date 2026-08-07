import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("artifact authoring product contract", () => {
  test("documents V5 authoring as the sole live contract and retires V1-V4 writes", async () => {
    const active = await Promise.all([
      "docs/internal/CONTEXT.md",
      "README.md",
      "docs/internal/design.md",
      "docs/archive/prd.md",
      "docs/openwiki/quickstart.md",
      "docs/openwiki/logbook-and-workbench.md",
      "docs/openwiki/data-and-integrations.md",
      "docs/reference/enrichment.md",
      "docs/reference/session-dossier.md",
      "docs/reference/artifact-first-logbook-cutover.md",
      "docs/reference/daemon-api.md",
      "docs/adr/0016-agent-led-v5-pack-authoring.md",
    ].map((path) => readFile(resolve(path), "utf8")));
    const text = active.join("\n");

    expect(text).toContain("workbench-authoring-v5");
    expect(text).toContain("guided authoring request");
    expect(text).toContain("fixed packs of 5–12 sessions");
    expect(text).toContain("V1–V4");
    expect(text).toContain("instance-bound launcher");
    expect(text).toContain("no operator approval");
    expect(text).toContain("opportunities are nonbinding");
    expect(text).not.toContain("the agent must partition them");
    expect(text).not.toContain("three-session canary");
    expect(text).not.toContain("guided_canary_not_constructible");
    expect(text).not.toContain("high-signal opportunities require an evidence-backed disposition");
  });
});
