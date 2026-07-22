import { createHash } from "node:crypto";
import { SESSION_CAPSULE_PROMPT_VERSION } from "../enrichment/sessionCompiler.ts";
import type { SessionCapsule, SessionEnrichmentKind } from "../enrichment/types.ts";
import { markStaleCurrentSessionEnrichments, upsertSessionEnrichment } from "../daemon/db/enrichmentRepository.ts";
import { indexCanonicalSessionSearch } from "../daemon/db/searchRepository.ts";
import { markWorkbenchSessionEnrichmentSatisfiedInTransaction } from "../daemon/db/workbenchPipelineRepository.ts";
import { stableRecordId } from "../daemon/identity.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../daemon/db/sqlite.ts";
import type { SessionEnrichmentOutput } from "./types.ts";
import { validateWorkbenchOutput } from "./validation.ts";
import { buildWorkbenchEvidencePacket } from "./evidencePacket.ts";

export type ApplySessionEnrichmentResult = {
  ok: boolean;
  dryRun: boolean;
  plannedRows: SessionEnrichmentKind[];
  enrichmentIds: string[];
};

export function applySessionEnrichment(
  db: MastheadDatabase,
  options: { sessionId: string; output: SessionEnrichmentOutput; dryRun?: boolean }
): ApplySessionEnrichmentResult {
  const evidencePacket = buildWorkbenchEvidencePacket(db, { kind: "session_enrichment", sessionId: options.sessionId });
  const validation = validateWorkbenchOutput("session_enrichment", options.output, evidencePacket);
  if (!validation.ok) {
    throw new Error(`Invalid Workbench session enrichment: ${validation.errors.map((error) => error.message).join("; ")}`);
  }
  const plannedRows: SessionEnrichmentKind[] = ["session_capsule", "live_summary", "search_projection"];
  if (options.dryRun) return { dryRun: true, enrichmentIds: [], ok: true, plannedRows };

  return withImmediateTransaction(db, () =>
    applySessionEnrichmentInTransaction(db, { output: options.output, sessionId: options.sessionId })
  );
}

export function applySessionEnrichmentInTransaction(
  db: MastheadDatabase,
  options: { sessionId: string; output: SessionEnrichmentOutput }
): ApplySessionEnrichmentResult {
  const plannedRows: SessionEnrichmentKind[] = ["session_capsule", "live_summary", "search_projection"];

  const now = new Date().toISOString();
  const fingerprint = contentFingerprint(options.output);
  const capsule = capsuleFromOutput(options.output, now);
  const contents: Record<SessionEnrichmentKind, SessionCapsule | { text: string } | { searchText: string; title: string }> = {
    live_summary: { text: options.output.summary },
    search_projection: { searchText: [options.output.title, options.output.summary, ...options.output.searchPhrases].join("\n"), title: options.output.title },
    session_capsule: capsule
  };

  const enrichmentIds = plannedRows.map((enrichmentKind) => {
    markStaleCurrentSessionEnrichments(db, {
      enrichmentKind,
      exceptContentFingerprint: fingerprint,
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      sessionId: options.sessionId
    });
    return upsertSessionEnrichment(db, {
      content: contents[enrichmentKind],
      contentFingerprint: fingerprint,
      enrichmentKind,
      generatedAt: now,
      model: "external_agent",
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      provider: "workbench_cli",
      sessionId: options.sessionId,
      sourceRefs: options.output.evidenceRefs.map((ref) => ({
        id: ref,
        kind: "event",
        observedAt: now,
        source: "workbench"
      })),
      status: "current"
    });
  });
  indexCanonicalSessionSearch(db, options.sessionId);
  db.prepare(
    `INSERT INTO workbench_runs (run_id, command, started_at, completed_at, status, session_id, artifact_id, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stableRecordId("workbench_run", [options.sessionId, "session_enrichment", fingerprint, now]),
    "apply session_enrichment",
    now,
    now,
    "succeeded",
    options.sessionId,
    null,
    JSON.stringify({ enrichmentIds, fingerprint })
  );
  markWorkbenchSessionEnrichmentSatisfiedInTransaction(db, {
    actor: { kind: "agent", id: "external_agent" },
    sessionId: options.sessionId
  });
  return { dryRun: false, enrichmentIds, ok: true, plannedRows };
}

function capsuleFromOutput(output: SessionEnrichmentOutput, generatedAt: string): SessionCapsule {
  const evidenceRefs = output.evidenceRefs.map((ref) => ({ id: ref, kind: "event" as const, observedAt: generatedAt, source: "workbench" }));
  return {
    candidateDecisions: [],
    commandsSummary: output.toolsSummary,
    confidence: output.confidence,
    durableEnrichment: {
      generatedAt,
      keywords: [],
      model: "external_agent",
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], openQuestions: [] },
        decisions: [],
        evidenceRefs,
        keyWork: [output.summary],
        outcome: output.outcome,
        verification: {
          commands: [],
          evidenceRefs,
          failures: [],
          status: output.verificationSummary ? "passed" : "unknown",
          summary: output.verificationSummary ?? ""
        },
        warnings: []
      },
      sessionSummary: { confidence: output.confidence, evidenceRefs, state: "completed", text: output.summary },
      sessionTitle: { basis: "dominant_work", confidence: output.confidence, evidenceRefs, text: output.title },
      source: "manual",
      version: SESSION_CAPSULE_PROMPT_VERSION
    },
    filesChangedSummary: output.filesSummary,
    liveSummary: output.summary,
    missingEvidence: output.missingEvidence,
    outcome: output.outcome,
    searchPhrases: output.searchPhrases,
    searchSummary: output.summary,
    sessionDossier: {
      blockers: [],
      continuation: { constraints: [], openQuestions: [] },
      decisions: [],
      evidenceRefs,
      keyWork: [output.summary],
      outcome: output.outcome,
      verification: {
        commands: [],
        evidenceRefs,
        failures: [],
        status: output.verificationSummary ? "passed" : "unknown",
        summary: output.verificationSummary ?? ""
      },
      warnings: []
    },
    sessionSummary: { confidence: output.confidence, evidenceRefs, state: "completed", text: output.summary },
    sessionTitle: { basis: "dominant_work", confidence: output.confidence, evidenceRefs, text: output.title },
    technologies: output.technologies,
    title: output.title,
    titleSource: "llm",
    topics: output.topics,
    unresolved: [],
    validationWarnings: []
  };
}

function contentFingerprint(output: SessionEnrichmentOutput): string {
  return createHash("sha256").update(stableStringify(output)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
