import { describe, expect, test } from "vitest";

import type { WorkbenchValidationEvidence } from "../../workbench/types.ts";
import {
  resolvePublicEvidenceCandidates,
  type PublicEvidenceSelection,
} from "../evidence.ts";

function evidence(
  id: string,
  sessionId = "session:allowed",
  text = "Reviewed public-safe evidence.",
): WorkbenchValidationEvidence {
  return {
    sessionId,
    kind: "message",
    role: "assistant",
    text,
    observedAt: "2026-08-11T12:00:00.000Z",
    label: id,
    lowValue: false,
  };
}

function selection(ref: string, overrides: Partial<PublicEvidenceSelection> = {}): PublicEvidenceSelection {
  return {
    ref,
    kind: "excerpt",
    label: "Reviewed evidence",
    supports: ["outcome"],
    ...overrides,
  };
}

describe("resolvePublicEvidenceCandidates", () => {
  test("copies only selected evidence with sequential release-local IDs", () => {
    const evidenceByRef = new Map([
      ["message:one", evidence("message:one")],
      ["message:two", evidence("message:two")],
      ["message:unselected", evidence("message:unselected", "session:allowed", "Must not be copied.")],
    ]);

    const result = resolvePublicEvidenceCandidates(evidenceByRef, {
      sessionId: "session:allowed",
      selections: [selection("message:two"), selection("message:one", { kind: "verification" })],
    });

    expect(result).toEqual([
      {
        id: "evidence-1",
        kind: "excerpt",
        label: "Reviewed evidence",
        text: "Reviewed public-safe evidence.",
        supports: ["outcome"],
      },
      {
        id: "evidence-2",
        kind: "verification",
        label: "Reviewed evidence",
        text: "Reviewed public-safe evidence.",
        supports: ["outcome"],
      },
    ]);
  });

  test("rejects evidence outside the dossier provenance session", () => {
    const evidenceByRef = new Map([["message:foreign", evidence("message:foreign", "session:foreign")]]);

    expect(() =>
      resolvePublicEvidenceCandidates(evidenceByRef, {
        sessionId: "session:allowed",
        selections: [selection("message:foreign")],
      }),
    ).toThrow(expect.objectContaining({ code: "evidence_outside_provenance" }));
  });

  test("enforces public evidence text bounds without truncating selected text", () => {
    const evidenceByRef = new Map([["message:long", evidence("message:long", "session:allowed", "x".repeat(4_001))]]);

    expect(() =>
      resolvePublicEvidenceCandidates(evidenceByRef, {
        sessionId: "session:allowed",
        selections: [selection("message:long")],
      }),
    ).toThrow(expect.objectContaining({ code: "evidence_text_too_long" }));
  });
});
