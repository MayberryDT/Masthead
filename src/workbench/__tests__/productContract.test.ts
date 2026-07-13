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

  test("active documentation describes candidate-driven V2 authoring only", async () => {
    const activeDocPaths = [
      "design.md",
      "prd.md",
      "README.md",
      "docs/reference/session-dossier.md",
      "docs/reference/daemon-api.md",
      "docs/reference/mcp-tools.md",
      "docs/adr/0013-canonical-dossier-and-candidate-authoring.md",
      "docs/acceptance/product-release-gate.md",
      "docs/acceptance/workbench-v1-evidence.md",
      "docs/acceptance/workbench-enroll-evidence.md",
      "openwiki/quickstart.md",
      "openwiki/data-and-integrations.md",
    ];
    const documents = await Promise.all(
      activeDocPaths.map(async (path) => ({ path, body: await readFile(resolve(path), "utf8") })),
    );
    const activeDocs = documents.map(({ body }) => body).join("\n");
    const normalized = activeDocs.replace(/\s+/g, " ");

    for (const { body, path } of documents.filter(
      ({ path }) => path !== "docs/acceptance/workbench-v1-evidence.md",
    )) {
      expect(body, path).not.toMatch(/agent-authored session dossier/i);
      expect(body, path).not.toMatch(/agent-authored enrichment\/dossier/i);
      expect(body, path).not.toMatch(/read every item named by every session evidence manifest/i);
      expect(body, path).not.toMatch(/read evidence until every item.*evidence manifest/i);
      expect(body.replace(/\s+/g, " "), path).not.toMatch(
        /runbook.*ADR.*timeline.*N\/A.*every session/i,
      );
    }
    expect(normalized).not.toContain(
      "runbook / ADR / incident timeline when evidence supports them, else N/A",
    );
    expect(normalized).not.toContain(
      'POST /workbench/authoring/runs` opens or idempotently reuses one authoring run. Body: `{ "actorId": "...", "databaseId": "...", "sessionIds"',
    );
    expect(normalized).not.toContain(
      "validates and stores one complete `workbench-authoring-v1` bundle",
    );
    expect(activeDocs).toContain("canonical-session-dossier-v1");
    expect(activeDocs).toContain("workbench-authoring-v2");
    expect(activeDocs).toContain("audit-v1-generation");
    expect(activeDocs).toContain("--db <path> --audit-hash <sha256> --confirm");
    expect(activeDocs).toContain("dossierFidelity");

    const byPath = Object.fromEntries(documents.map(({ body, path }) => [path, body]));
    const design = byPath["design.md"]!;
    const readme = byPath["README.md"]!;
    const adr = byPath["docs/adr/0013-canonical-dossier-and-candidate-authoring.md"]!;
    const daemonApi = byPath["docs/reference/daemon-api.md"]!;
    const v1Evidence = byPath["docs/acceptance/workbench-v1-evidence.md"]!;
    const enrollmentEvidence = byPath["docs/acceptance/workbench-enroll-evidence.md"]!;

    expect(design).toContain("Author candidate");
    expect(design).not.toContain("Copy Agent Prompt");
    expect(readme).toMatch(/schema 23\b/);
    expect(adr).toContain("`masthead.workbench.authoring/v1`");
    expect(adr).toContain("`workbench-authoring-v2`");
    expect(adr).toMatch(/`path`,\s*`evidenceRef`,\s*`excerpt`,\s*and `supportKind`/);
    expect(adr).toMatch(
      /The session is resolved through candidate provenance and the\s+evidence reference/,
    );
    expect(adr).not.toMatch(/claim support:[^.]*session id/i);
    expect(daemonApi).toContain("with 1–100 canonical session IDs");
    expect(daemonApi).not.toContain("1–100 unique canonical");
    expect(v1Evidence).toMatch(/^# Historical:/);
    expect(v1Evidence.slice(0, 600)).toMatch(/superseded/i);
    expect(v1Evidence.slice(0, 600)).toContain("ADR 0013");
    expect(enrollmentEvidence).toMatch(/historical Workbench V1 evidence/i);
    expect(enrollmentEvidence).not.toMatch(/current end-to-end Workbench authoring contract[^\n]*workbench-v1-evidence/i);
  });
});
