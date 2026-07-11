import { describe, expect, test } from "vitest";
import {
  activeProductFiles,
  findProductContractFailures
} from "../../../scripts/masthead-product-contract.js";

function currentDocuments(): Record<string, string> {
  const documents = Object.fromEntries(activeProductFiles.map((file) => [file, "Current Masthead product documentation."]));
  documents["README.md"] = "Masthead is a harness-neutral session data layer with Logbook and MCP.";
  return documents;
}

describe("Masthead product documentation contract", () => {
  test("rejects direct import-to-Logbook user guidance", () => {
    const documents = currentDocuments();
    documents["docs/how-to/import-codex-history.md"] = "Imported sessions should appear in Logbook.";

    expect(findProductContractFailures(documents)).toContain(
      "docs/how-to/import-codex-history.md still uses obsolete product framing: imported sessions become Logbook rows"
    );
  });

  test("rejects legacy artifact kinds as current CLI guidance", () => {
    const documents = currentDocuments();
    documents["docs/reference/enrichment.md"] = "For `bug_fix_trace`, produce a durable artifact.";

    expect(findProductContractFailures(documents)).toContain(
      "docs/reference/enrichment.md still uses obsolete product framing: bug_fix_trace is a current output kind"
    );
  });

  test("rejects the legacy control-tower title", () => {
    const documents = currentDocuments();
    documents["docs/reference/new-product-page.md"] = "# Masthead: Local Coding-Agent Control Tower";

    expect(findProductContractFailures(documents)).toContain(
      "docs/reference/new-product-page.md still uses obsolete product framing: Masthead is a control tower"
    );
  });

  test("rejects shared session detail as the Logbook primary path", () => {
    const documents = currentDocuments();
    documents["docs/tutorials/new-user-journey.md"] =
      "The session dossier is the shared detail surface for Board and Logbook sessions.";

    expect(findProductContractFailures(documents)).toContain(
      "docs/tutorials/new-user-journey.md still uses obsolete product framing: Logbook shares the canonical session dossier detail"
    );
  });

  test("does not scan historical ADR context", () => {
    const documents = currentDocuments();
    documents["docs/adr/0009-logbook-only-shows-published-sessions.md"] =
      "Logbook shows only published sessions and bug_fix_trace is first-class.";

    expect(findProductContractFailures(documents)).toEqual([]);
  });
});
