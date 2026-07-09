import { describe, expect, test } from "vitest";
import { getWorkbenchSchema, listWorkbenchSchemaKinds } from "../schemas.ts";

describe("Workbench schemas", () => {
  test("lists the V1 output kinds", () => {
    expect(listWorkbenchSchemaKinds()).toEqual(["session_enrichment", "session_dossier", "bug_fix_trace"]);
  });

  test("returns a strict session enrichment schema", () => {
    const schema = getWorkbenchSchema("session_enrichment");

    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      required: expect.arrayContaining(["title", "summary", "topics", "technologies", "searchPhrases", "confidence", "missingEvidence", "evidenceRefs"]),
      properties: {
        confidence: { enum: ["high", "medium", "low"] },
        evidenceRefs: { type: "array", items: { type: "string" } }
      }
    });
  });

  test("rejects unknown schema kinds", () => {
    expect(() => getWorkbenchSchema("unknown" as never)).toThrow("Unknown Workbench schema kind: unknown");
  });
});

