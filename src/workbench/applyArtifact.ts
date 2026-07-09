import { createHash } from "node:crypto";
import type { SessionArtifactKind, SessionArtifactRecord } from "../daemon/db/sessionArtifactRepository.ts";
import { applySessionArtifact } from "../daemon/db/sessionArtifactRepository.ts";
import { markWorkbenchArtifactSatisfied } from "../daemon/db/workbenchPipelineRepository.ts";
import { stableRecordId } from "../daemon/identity.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { buildWorkbenchEvidencePacket } from "./evidencePacket.ts";
import type { WorkbenchOutputKind, WorkbenchValidationResult } from "./types.ts";
import { validateWorkbenchOutput } from "./validation.ts";

export type ApplyArtifactResult = {
  ok: boolean;
  dryRun: boolean;
  artifactKind: SessionArtifactKind;
  artifactId?: string;
  status?: SessionArtifactRecord["status"];
  title?: string;
  contentFingerprint: string;
  validation: WorkbenchValidationResult;
};

export function applyArtifact(
  db: MastheadDatabase,
  options: { sessionId: string; kind: WorkbenchOutputKind; output: unknown; dryRun?: boolean }
): ApplyArtifactResult {
  if (!isArtifactKind(options.kind)) throw new Error(`Workbench kind is not a local artifact: ${options.kind}`);

  const evidencePacket = buildWorkbenchEvidencePacket(db, { kind: options.kind, sessionId: options.sessionId });
  const validation = validateWorkbenchOutput(options.kind, options.output, evidencePacket);
  if (!validation.ok) {
    throw new Error(`Invalid Workbench ${options.kind}: ${validation.errors.map((error) => error.message).join("; ")}`);
  }

  const fingerprint = contentFingerprint(options.output);
  const title = titleFromOutput(options.output);
  if (options.dryRun) {
    return {
      artifactKind: options.kind,
      contentFingerprint: fingerprint,
      dryRun: true,
      ok: true,
      title,
      validation
    };
  }

  const artifact = applySessionArtifact(db, {
    artifactKind: options.kind,
    content: options.output,
    contentFingerprint: fingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: evidenceRefsFromOutput(options.output),
    schemaVersion: `${options.kind}-v1`,
    sessionId: options.sessionId,
    title,
    validation
  });
  recordWorkbenchRun(db, options.sessionId, artifact, fingerprint);
  markWorkbenchArtifactSatisfied(db, {
    actor: { kind: "agent", id: "external_agent" },
    artifactKind: artifact.artifactKind,
    sessionId: options.sessionId
  });

  return {
    artifactId: artifact.artifactId,
    artifactKind: artifact.artifactKind,
    contentFingerprint: fingerprint,
    dryRun: false,
    ok: true,
    status: artifact.status,
    title: artifact.title,
    validation
  };
}

function isArtifactKind(kind: WorkbenchOutputKind): kind is SessionArtifactKind {
  return kind === "session_dossier" || kind === "bug_fix_trace";
}

function titleFromOutput(output: unknown): string | undefined {
  return isRecord(output) && typeof output.title === "string" ? output.title : undefined;
}

function evidenceRefsFromOutput(output: unknown): string[] {
  return isRecord(output) && Array.isArray(output.evidenceRefs) && output.evidenceRefs.every((entry) => typeof entry === "string")
    ? output.evidenceRefs
    : [];
}

function recordWorkbenchRun(db: MastheadDatabase, sessionId: string, artifact: SessionArtifactRecord, fingerprint: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workbench_runs (run_id, command, started_at, completed_at, status, session_id, artifact_id, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stableRecordId("workbench_run", [sessionId, artifact.artifactKind, fingerprint, now]),
    `apply ${artifact.artifactKind}`,
    now,
    now,
    "succeeded",
    sessionId,
    artifact.artifactId,
    JSON.stringify({ artifactId: artifact.artifactId, fingerprint })
  );
}

function contentFingerprint(output: unknown): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
