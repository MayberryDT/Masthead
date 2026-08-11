import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { getAuthoringValidationEvidenceByRef } from "../workbench/authoring/evidenceCatalog.ts";
import type { WorkbenchValidationEvidence } from "../workbench/types.ts";
import type { EvidenceItemV1, EvidenceSupport } from "./types.ts";

const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_TEXT_SCALARS = 4_000;
const MAX_EVIDENCE_TEXT_BYTES = 64 * 1024;
const MAX_EVIDENCE_LABEL_SCALARS = 100;
const SUPPORTED_SECTIONS = new Set<EvidenceSupport>([
  "purpose",
  "outcome",
  "key-work",
  "decisions",
  "blockers",
  "verification",
  "continuation",
]);

export type PublicEvidenceSelection = {
  ref: string;
  kind: EvidenceItemV1["kind"];
  label: string;
  supports: EvidenceSupport[];
};

export type PublicEvidenceResolutionInput = {
  sessionId: string;
  selections: readonly PublicEvidenceSelection[];
};

export class EvidenceSelectionError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "EvidenceSelectionError";
  }
}

/** Resolves selected evidence only from the eligible dossier's provenance session. */
export function resolvePublicEvidenceCandidates(
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>,
  input: PublicEvidenceResolutionInput,
): EvidenceItemV1[] {
  if (input.selections.length > MAX_EVIDENCE_ITEMS) {
    throw new EvidenceSelectionError("evidence_limit_exceeded", "At most 20 evidence items may be selected");
  }

  const selected = new Set<string>();
  let aggregateBytes = 0;
  return input.selections.map((selection, index) => {
    if (!selected.add(selection.ref)) {
      throw new EvidenceSelectionError("duplicate_evidence_selection", "Evidence may be selected only once");
    }
    const source = evidenceByRef.get(selection.ref);
    if (!source) {
      throw new EvidenceSelectionError("unknown_evidence_reference", "Selected evidence is unavailable");
    }
    if (source.sessionId !== input.sessionId) {
      throw new EvidenceSelectionError("evidence_outside_provenance", "Selected evidence is outside the Page provenance");
    }
    validateSelection(selection);
    if (unicodeScalarCount(source.text) > MAX_EVIDENCE_TEXT_SCALARS) {
      throw new EvidenceSelectionError("evidence_text_too_long", "Evidence text exceeds 4,000 Unicode scalar values");
    }
    aggregateBytes += new TextEncoder().encode(source.text).byteLength;
    if (aggregateBytes > MAX_EVIDENCE_TEXT_BYTES) {
      throw new EvidenceSelectionError("evidence_aggregate_too_large", "Selected evidence exceeds 64 KiB");
    }
    return {
      id: `evidence-${index + 1}`,
      kind: selection.kind,
      label: selection.label.trim(),
      text: source.text,
      supports: [...selection.supports],
    };
  });
}

export function resolvePublicEvidenceCandidatesForSession(
  db: MastheadDatabase,
  input: PublicEvidenceResolutionInput,
): EvidenceItemV1[] {
  return resolvePublicEvidenceCandidates(
    getAuthoringValidationEvidenceByRef(db, [input.sessionId]),
    input,
  );
}

function validateSelection(selection: PublicEvidenceSelection): void {
  const label = selection.label.trim();
  if (!label || unicodeScalarCount(label) > MAX_EVIDENCE_LABEL_SCALARS) {
    throw new EvidenceSelectionError("evidence_label_invalid", "Evidence labels must be 1-100 Unicode scalar values");
  }
  if (selection.kind !== "excerpt" && selection.kind !== "verification") {
    throw new EvidenceSelectionError("evidence_kind_invalid", "Evidence kind must be excerpt or verification");
  }
  if (selection.supports.length === 0 || selection.supports.some((section) => !SUPPORTED_SECTIONS.has(section))) {
    throw new EvidenceSelectionError("evidence_support_invalid", "Evidence must support one or more public sections");
  }
}

function unicodeScalarCount(value: string): number {
  return Array.from(value).length;
}
