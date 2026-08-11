import { describe, expect, test } from "vitest";

import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { finalizePageReview } from "../review.ts";

function dossier(): PublishedSessionDossierV1 {
  return {
    enrichment: { status: "current" },
    durableEnrichment: {
      sessionTitle: { text: "Review Masthead Pages egress", basis: "dominant_work", confidence: "high", evidenceRefs: [] },
      sessionSummary: { text: "Build the local review boundary.", state: "completed", confidence: "high", evidenceRefs: [] },
      sessionDossier: {
        keyWork: ["Scan the complete outbound request."],
        decisions: [],
        blockers: [],
        verification: { status: "missing", summary: "No check was recorded.", commands: [], failures: [], evidenceRefs: [] },
        continuation: { openQuestions: [], constraints: [] },
        warnings: [],
        evidenceRefs: [],
      },
    },
  } as unknown as PublishedSessionDossierV1;
}

function input() {
  return {
    dossier: dossier(),
    license: "all-rights-reserved" as const,
    generatorVersion: "0.1.15",
    publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
    slug: "review-masthead-pages-egress",
    idempotencyKey: "b4d8a1f1-5e76-4cc0-a3a8-4dcfbcce9d31",
  };
}

describe("finalizePageReview", () => {
  test("builds a ready request whose digest covers the exact reviewed bytes", () => {
    const result = finalizePageReview(input());

    expect(result.decision).toBe("ready");
    expect(result.request?.objectId).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(result.requestDigest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(finalizePageReview(input()).requestDigest).toBe(result.requestDigest);
  });

  test("holds a warning request for review", () => {
    const value = input();
    value.dossier.durableEnrichment!.sessionDossier.keyWork = ["Contact owner@example.test."];

    expect(finalizePageReview(value).decision).toBe("needs_review");
  });

  test("blocks a secret-bearing request without rewriting its reviewed object", () => {
    const value = input();
    value.dossier.durableEnrichment!.sessionDossier.keyWork = ["Used sk-secret-value-1234567890."];

    const result = finalizePageReview(value);

    expect(result.decision).toBe("blocked");
    expect(result.request?.object.body.keyWork).toEqual(["Used sk-secret-value-1234567890."]);
    expect(JSON.stringify(result.findings)).not.toContain("sk-secret-value-1234567890");
  });
});
