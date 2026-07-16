import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("artifact authoring product contract", () => {
  test("documents agent-led enrichment and optional artifact judgment", async () => {
    const paths = [
      "CONTEXT.md",
      "design.md",
      "prd.md",
      "README.md",
      "openwiki/quickstart.md",
      "openwiki/logbook-and-workbench.md",
      "docs/adr/0014-agent-led-enriched-artifact-authoring.md",
    ];
    const activeDocs = (
      await Promise.all(paths.map((path) => readFile(resolve(path), "utf8")))
    ).join("\n");
    const normalized = activeDocs.replace(/\s+/g, " ");

    expect(activeDocs).toContain("Copy Agent Prompt");
    expect(activeDocs).toContain("workbench-authoring-v3");
    expect(activeDocs).toContain("suggestions are nonbinding");
    expect(activeDocs).toContain("nothing enters Logbook until enrichment is current");
    expect(activeDocs).toContain("zero or more optional artifacts");
    expect(activeDocs).toContain("canonical dossier structure");
    expect(normalized).not.toMatch(/Author candidate/i);
    expect(normalized).not.toMatch(/Publish canonical dossiers/i);
    expect(normalized).not.toMatch(/one candidate group/i);
    expect(normalized).not.toMatch(/artifact candidate.*required/i);
  });
});
