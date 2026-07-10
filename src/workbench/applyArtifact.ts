import { createHash } from "node:crypto";
import type { SessionArtifactKind, SessionArtifactRecord } from "../daemon/db/sessionArtifactRepository.ts";
import {
  applySessionArtifactInTransaction,
  normalizeSessionArtifactSignatureKey,
  publishSessionArtifactInTransaction
} from "../daemon/db/sessionArtifactRepository.ts";
import {
  markContributionSatisfactionForProvenanceInTransaction,
  markWorkbenchArtifactAppliedInTransaction,
  markWorkbenchArtifactPublishedInTransaction,
  type WorkbenchAutomaticKind
} from "../daemon/db/workbenchPipelineRepository.ts";
import { stableRecordId } from "../daemon/identity.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../daemon/db/sqlite.ts";
import { buildWorkbenchEvidencePacket } from "./evidencePacket.ts";
import { isWorkbenchArtifactKind } from "./schemas.ts";
import type { WorkbenchOutputKind, WorkbenchValidationResult } from "./types.ts";
import { validateWorkbenchOutput } from "./validation.ts";

export type ApplyArtifactResult = {
  ok: boolean;
  dryRun: boolean;
  artifactKind: SessionArtifactKind;
  artifactId?: string;
  status?: SessionArtifactRecord["status"];
  publicationStatus?: SessionArtifactRecord["publicationStatus"];
  title?: string;
  contentFingerprint: string;
  validation: WorkbenchValidationResult;
};

export type PublishArtifactResult = {
  ok: boolean;
  artifactId: string;
  artifactKind: SessionArtifactKind;
  publicationStatus: SessionArtifactRecord["publicationStatus"];
  publishedAt?: string;
};

export function applyArtifact(
  db: MastheadDatabase,
  options: {
    sessionId: string;
    kind: WorkbenchOutputKind;
    output: unknown;
    dryRun?: boolean;
    provenanceSessionIds?: string[];
  }
): ApplyArtifactResult {
  if (!isWorkbenchArtifactKind(options.kind)) throw new Error(`Workbench kind is not a local artifact: ${options.kind}`);
  const artifactKind = options.kind as SessionArtifactKind;

  const provenanceSessionIds = provenanceFromOutputOrOptions(options.output, options.sessionId, options.provenanceSessionIds);
  const evidencePacket = buildWorkbenchEvidencePacket(db, {
    kind: options.kind,
    provenanceSessionIds,
    sessionId: options.sessionId
  });
  const validation = validateWorkbenchOutput(options.kind, options.output, evidencePacket);
  if (!validation.ok) {
    throw new Error(`Invalid Workbench ${options.kind}: ${validation.errors.map((error) => error.message).join("; ")}`);
  }

  const fingerprint = fingerprintWorkbenchOutput(options.output);
  const title = titleFromOutput(options.output);
  if (options.dryRun) {
    return {
      artifactKind,
      contentFingerprint: fingerprint,
      dryRun: true,
      ok: true,
      title,
      validation
    };
  }

  const projectLabel = evidencePacket.session.project;
  const content = isRecord(options.output) ? options.output : {};
  const artifact = withImmediateTransaction(db, () => {
    const applied = applySessionArtifactInTransaction(db, {
      artifactKind,
      confidence: confidenceFromOutput(options.output),
      content: options.output,
      contentFingerprint: fingerprint,
      createdBy: "workbench_cli",
      evidenceRefs: evidenceRefsFromOutput(options.output),
      joinRationale: typeof content.joinRationale === "string" ? content.joinRationale : undefined,
      projectLabel,
      provenanceSessionIds,
      schemaVersion: `${artifactKind}-v1`,
      sessionId: options.sessionId,
      signatureKey: normalizeSessionArtifactSignatureKey(content.signatureKey),
      title,
      validation
    });
    recordWorkbenchRun(db, options.sessionId, applied, fingerprint);
    markWorkbenchArtifactAppliedInTransaction(db, {
      actor: { kind: "agent", id: "external_agent" },
      artifactKind: applied.artifactKind,
      sessionId: options.sessionId
    });
    return applied;
  });

  return {
    artifactId: artifact.artifactId,
    artifactKind: artifact.artifactKind,
    contentFingerprint: fingerprint,
    dryRun: false,
    ok: true,
    publicationStatus: artifact.publicationStatus,
    status: artifact.status,
    title: artifact.title,
    validation
  };
}

export function publishArtifact(db: MastheadDatabase, artifactId: string): PublishArtifactResult {
  const published = withImmediateTransaction(db, () => {
    const artifact = publishSessionArtifactInTransaction(db, artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    if (isAutomaticKind(artifact.artifactKind)) {
      markWorkbenchArtifactPublishedInTransaction(db, {
        actor: { kind: "agent", id: "external_agent" },
        artifactId: artifact.artifactId,
        artifactKind: artifact.artifactKind,
        sessionId: artifact.sessionId
      });
      markContributionSatisfactionForProvenanceInTransaction(db, {
        actor: { kind: "agent", id: "external_agent" },
        artifactKind: artifact.artifactKind,
        provenanceSessionIds: artifact.provenanceSessionIds,
        publishedArtifactId: artifact.artifactId,
        seedSessionId: artifact.sessionId
      });
    }
    return artifact;
  });
  return {
    artifactId: published.artifactId,
    artifactKind: published.artifactKind,
    ok: true,
    publicationStatus: published.publicationStatus,
    publishedAt: published.publishedAt
  };
}

function isAutomaticKind(kind: SessionArtifactKind): kind is WorkbenchAutomaticKind {
  return kind === "runbook" || kind === "adr" || kind === "incident_timeline";
}

function provenanceFromOutputOrOptions(
  output: unknown,
  sessionId: string,
  provenanceSessionIds?: string[]
): string[] {
  if (provenanceSessionIds?.length) return provenanceSessionIds;
  if (isRecord(output) && Array.isArray(output.provenanceSessionIds)) {
    const fromOutput = output.provenanceSessionIds.filter((entry): entry is string => typeof entry === "string");
    if (fromOutput.length > 0) return fromOutput;
  }
  return [sessionId];
}

function confidenceFromOutput(output: unknown): "high" | "medium" | "low" | undefined {
  if (!isRecord(output)) return undefined;
  return output.confidence === "high" || output.confidence === "medium" || output.confidence === "low"
    ? output.confidence
    : undefined;
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

export function fingerprintWorkbenchOutput(output: unknown): string {
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
