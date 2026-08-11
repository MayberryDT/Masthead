import { describe, expect, test } from "vitest";

import {
  scanCompleteOutboundRequest,
  scanPageEgress,
} from "../egressPreflight.ts";
import type { PageRevisionV1 } from "../types.ts";

function pageWith(text: string): PageRevisionV1 {
  return {
    schemaVersion: "masthead-page-revision-v1",
    kind: "session_dossier",
    title: "Safe title",
    summary: "Safe summary",
    body: {
      keyWork: [text],
      decisions: [],
      blockers: [],
      continuation: { openQuestions: [], constraints: [] },
      warnings: [],
    },
    labels: { topics: [], technologies: [] },
    verification: { status: "missing", summary: "No check was recorded.", checks: [], failures: [] },
    evidence: [],
    provenance: { sourceKind: "session_dossier", sourceSchema: "canonical-session-dossier-v1", sourceLinks: [] },
    license: "all-rights-reserved",
    generator: { name: "Masthead", version: "0.1.15", projection: "session-dossier-public-v1" },
  };
}

describe("scanPageEgress", () => {
  test.each([
    "sk-secret-value-1234567890",
    "Authorization: Bearer this-is-a-token-value",
    "-----BEGIN PRIVATE KEY-----\nprivate key material\n-----END PRIVATE KEY-----",
    "https://user:password@example.test/repository",
    "postgresql://user:password@example.test/database",
    "OPENAI_API_KEY=super-secret-value",
    "/home/alice/private/repository",
    "/Users/alice/private/repository",
    "C:\\Users\\alice\\private\\repository",
    "diff --git a/private.ts b/private.ts\n+complete command output",
    "<script>alert('not inert')</script>",
  ])("blocks prohibited content: %s", (value) => {
    const result = scanPageEgress(pageWith(value));

    expect(result.decision).toBe("blocked");
    expect(result.findings.some((finding) => finding.severity === "block")).toBe(true);
  });

  test("blocks a confirmed secret without returning the secret", () => {
    const secret = "sk-secret-value-1234567890";
    const result = scanPageEgress(pageWith(secret));

    expect(JSON.stringify(result.findings)).not.toContain(secret);
  });

  test("warns for information that needs publisher review", () => {
    const result = scanPageEgress(
      pageWith("Contact owner@example.test about the production customer deployment."),
    );

    expect(result.decision).toBe("needs_review");
    expect(result.findings.every((finding) => finding.severity === "warn")).toBe(true);
  });

  test("warns for a potential private repository URL", () => {
    const result = scanPageEgress(pageWith("See https://github.com/acme/private-repository for details."));

    expect(result.decision).toBe("needs_review");
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "private_repository_url", severity: "warn" })]),
    );
  });

  test("blocks oversized evidence excerpts", () => {
    const page = pageWith("Safe work.");
    page.evidence = [{
      id: "evidence-1",
      kind: "excerpt",
      label: "Reviewed",
      text: "x".repeat(4_001),
      supports: ["outcome"],
    }];

    expect(scanPageEgress(page).decision).toBe("blocked");
  });

  test("blocks internal identifiers and transcript-shaped objects in the complete request", () => {
    const result = scanCompleteOutboundRequest({
      protocolVersion: "masthead-pages-publish-v1",
      object: pageWith("Safe work."),
      internal: { sessionId: "session:private-123" },
      transcript: [{ role: "user", text: "raw private prompt" }],
    });

    expect(result.decision).toBe("blocked");
    expect(result.findings.map((finding) => finding.path)).toEqual(
      expect.arrayContaining(["/internal/sessionId", "/transcript"]),
    );
  });

  test("blocks unsafe source links before transfer", () => {
    const page = pageWith("Safe work.");
    page.provenance.sourceLinks = [{ rel: "repository", label: "Private repo", url: "http://example.test/repository" }];

    expect(scanPageEgress(page).decision).toBe("blocked");
  });
});
