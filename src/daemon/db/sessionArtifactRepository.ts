import { createHash } from "node:crypto";
import { stableRecordId } from "../identity.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { type MastheadDatabase, withImmediateTransaction } from "./sqlite.ts";
import { listCompletedV1AuthoringRunsForRecovery } from "./workbenchAuthoringRepository.ts";

export type SessionArtifactKind = "session_dossier" | "runbook" | "adr" | "incident_timeline";
export type SessionArtifactStatus = "current" | "superseded" | "invalid";
export type SessionArtifactPublicationStatus = "applied" | "published";
export type SessionArtifactConfidence = "high" | "medium" | "low";

export type SessionArtifactInput = {
  /** Primary / seed session (always present; for session_dossier this is the only provenance). */
  sessionId: string;
  artifactKind: SessionArtifactKind;
  contentFingerprint: string;
  createdBy: string;
  schemaVersion: string;
  title?: string;
  summary?: string;
  highlight?: string;
  confidence?: SessionArtifactConfidence;
  projectLabel?: string;
  signatureKey?: string;
  joinRationale?: string;
  /** Full provenance set. Defaults to [sessionId]. Session dossier must be size 1. */
  provenanceSessionIds?: string[];
  content: unknown;
  evidenceRefs: string[];
  validation: unknown;
};

export type SessionArtifactRecord = {
  artifactId: string;
  sessionId: string;
  artifactKind: SessionArtifactKind;
  status: SessionArtifactStatus;
  publicationStatus: SessionArtifactPublicationStatus;
  contentFingerprint: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  schemaVersion: string;
  title?: string;
  summary?: string;
  highlight?: string;
  confidence?: SessionArtifactConfidence;
  projectLabel?: string;
  signatureKey?: string;
  lineageId: string;
  joinRationale?: string;
  publishedAt?: string;
  provenanceSessionIds: string[];
  content: unknown;
  evidenceRefs: string[];
  validation: unknown;
};

export type ArtifactCapsule = {
  artifactId: string;
  kind: SessionArtifactKind;
  title: string;
  summary: string;
  project?: string;
  confidence?: SessionArtifactConfidence;
  publishedAt?: string;
  signatureKey?: string;
  provenanceSize: number;
  provenanceLabel: string;
  highlight?: string;
  status: SessionArtifactStatus;
};

export type SearchPublishedArtifactsQuery = {
  q?: string;
  kind?: SessionArtifactKind;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export const FAILED_V1_DOSSIER_COUNT = 1_283;
export const FAILED_V1_RUN_COUNT = 66;

export type FailedGenerationAudit = {
  auditHash: string;
  contractVersion: "workbench-authoring-v1";
  dossiers: number;
  runbooks: number;
  adrs: number;
  incidentTimelines: number;
  totalArtifacts: number;
  totalRuns: number;
  totalSessions: number;
  publicationWindow: { from: string; to: string };
  generationWindow: { from: string; to: string };
  actorId: string;
  createdBy: string[];
  schemaVersions: string[];
  templateFingerprint: string;
  generationFingerprint: string;
  counts: {
    byKind: Record<string, number>;
    byRun: Record<string, number>;
    byStatus: Record<string, number>;
    bySession: Record<string, number>;
  };
};

export type FailedGenerationRecoveryBackupEvidence = {
  artifacts: number;
  auditHash: string;
  backupPath: string;
  backupPreserved: true;
  databaseId: string;
  device: string;
  inode: string;
  integrityResult: "ok";
  runs: number;
  sessions: number;
  sizeBytes: number;
};

export type FailedGenerationReceipt = {
  auditHash: string;
  artifactsInvalidated: number;
  provenanceDeleted: number;
  searchRowsDeleted: number;
  sessionsReset: number;
  claimsReleased: number;
  activityId: string;
  recoveryBackup: FailedGenerationRecoveryBackupEvidence;
};

export type FailedGenerationInvalidationBoundary =
  | "search_deleted"
  | "provenance_deleted"
  | "artifacts_deleted"
  | "pipeline_reset"
  | "claims_released"
  | "activity_recorded";

type FailedGenerationRecoverySnapshot = {
  artifacts: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  pipeline: Array<Record<string, unknown>>;
  provenance: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  search: Array<Record<string, unknown>>;
};

type FailedGenerationSelection = {
  audit: FailedGenerationAudit;
  artifactIds: string[];
  claimIds: string[];
  runIds: string[];
  sessionIds: string[];
};

type SessionArtifactRow = {
  artifactId: string;
  sessionId: string;
  artifactKind: SessionArtifactKind;
  status: SessionArtifactStatus;
  publicationStatus: SessionArtifactPublicationStatus;
  contentFingerprint: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  schemaVersion: string;
  title: string | null;
  summary: string | null;
  highlight: string | null;
  confidence: SessionArtifactConfidence | null;
  projectLabel: string | null;
  signatureKey: string | null;
  lineageId: string | null;
  joinRationale: string | null;
  publishedAt: string | null;
  contentJson: string;
  evidenceRefsJson: string;
  validationJson: string;
};

const ARTIFACT_SELECT = `SELECT
  artifact_id AS artifactId,
  session_id AS sessionId,
  artifact_kind AS artifactKind,
  status,
  publication_status AS publicationStatus,
  content_fingerprint AS contentFingerprint,
  created_at AS createdAt,
  updated_at AS updatedAt,
  created_by AS createdBy,
  schema_version AS schemaVersion,
  title,
  summary,
  highlight,
  confidence,
  project_label AS projectLabel,
  signature_key AS signatureKey,
  lineage_id AS lineageId,
  join_rationale AS joinRationale,
  published_at AS publishedAt,
  content_json AS contentJson,
  evidence_refs_json AS evidenceRefsJson,
  validation_json AS validationJson
FROM session_artifacts`;

export function applySessionArtifact(db: MastheadDatabase, input: SessionArtifactInput): SessionArtifactRecord {
  return withImmediateTransaction(db, () => applySessionArtifactInTransaction(db, input));
}

export function applySessionArtifactInTransaction(
  db: MastheadDatabase,
  input: SessionArtifactInput
): SessionArtifactRecord {
  const artifactInput = {
    ...input,
    signatureKey: normalizeSessionArtifactSignatureKey(input.signatureKey)
  };
  const provenanceSessionIds = normalizeProvenance(artifactInput);
  validateProvenanceRules(artifactInput.artifactKind, provenanceSessionIds, artifactInput.joinRationale);

  const existing = readArtifactByFingerprint(db, artifactInput);
  if (existing) {
    makeCurrentInTransaction(db, existing);
    indexArtifactScope(db, existing);
    return readArtifactById(db, existing.artifactId)!;
  }

  const now = new Date().toISOString();
  const artifactId = stableRecordId("session_artifact", [
    artifactInput.sessionId,
    artifactInput.artifactKind,
    artifactInput.schemaVersion,
    artifactInput.contentFingerprint
  ]);
  const lineageId = resolveLineageId(db, artifactInput, artifactId);
  const capsule = capsuleFieldsFromInput(artifactInput);

  supersedeForApply(db, artifactInput, lineageId);
  db.prepare(
    `INSERT INTO session_artifacts (
      artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
      created_by, schema_version, title, content_json, evidence_refs_json, validation_json,
      publication_status, signature_key, lineage_id, summary, highlight, confidence, project_label,
      join_rationale, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    artifactId,
    artifactInput.sessionId,
    artifactInput.artifactKind,
    "current",
    artifactInput.contentFingerprint,
    now,
    now,
    artifactInput.createdBy,
    artifactInput.schemaVersion,
    capsule.title,
    JSON.stringify(artifactInput.content),
    JSON.stringify(artifactInput.evidenceRefs),
    JSON.stringify(artifactInput.validation),
    artifactInput.signatureKey ?? null,
    lineageId,
    capsule.summary,
    capsule.highlight,
    capsule.confidence,
    capsule.projectLabel,
    artifactInput.joinRationale ?? null
  );
  replaceProvenance(db, artifactId, provenanceSessionIds);
  indexArtifactScope(db, artifactInput);
  return readArtifactById(db, artifactId)!;
}

export function normalizeSessionArtifactSignatureKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

export function publishSessionArtifact(
  db: MastheadDatabase,
  artifactId: string
): SessionArtifactRecord | undefined {
  return withImmediateTransaction(db, () => publishSessionArtifactInTransaction(db, artifactId));
}

export function publishSessionArtifactInTransaction(
  db: MastheadDatabase,
  artifactId: string
): SessionArtifactRecord | undefined {
  const existing = readArtifactById(db, artifactId);
  if (!existing) return undefined;
  if (existing.status !== "current") {
    throw new Error(`Cannot publish non-current artifact: ${artifactId}`);
  }
  if (existing.publicationStatus === "published") {
    indexSessionArtifactSearch(db, artifactId);
    return existing;
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE session_artifacts
     SET publication_status = 'published', published_at = ?, updated_at = ?
     WHERE artifact_id = ?`
  ).run(now, now, artifactId);
  indexSessionArtifactSearch(db, artifactId);
  return readArtifactById(db, artifactId)!;
}

export function indexSessionArtifactSearch(db: MastheadDatabase, artifactId: string): void {
  db.prepare("DELETE FROM session_artifact_search WHERE artifact_id = ?").run(artifactId);
  const artifact = readArtifactById(db, artifactId);
  if (!artifact || artifact.status !== "current" || artifact.publicationStatus !== "published") return;
  const body =
    artifact.schemaVersion === "canonical-session-dossier-v1"
      ? canonicalDossierSearchText(artifact.content as PublishedSessionDossierV1)
      : JSON.stringify(artifact.content);
  db.prepare(
    `INSERT INTO session_artifact_search (artifact_id, title, summary, highlight, project, body)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    artifact.artifactId,
    artifact.title ?? "",
    artifact.summary ?? "",
    artifact.highlight ?? "",
    artifact.projectLabel ?? "",
    body
  );
}

export function canonicalDossierSearchText(snapshot: PublishedSessionDossierV1): string {
  const durable = snapshot.durableEnrichment;
  return [
    snapshot.identity.title,
    snapshot.identity.project,
    snapshot.identity.branch,
    snapshot.narrative.objective,
    snapshot.narrative.firstUserPrompt,
    snapshot.narrative.latestUserPrompt,
    snapshot.narrative.finalAssistantMessage,
    snapshot.narrative.liveSummary,
    snapshot.narrative.outcome,
    durable?.sessionTitle.text,
    durable?.sessionSummary.text,
    durable?.sessionDossier.purpose,
    durable?.sessionDossier.outcome,
    ...(durable?.sessionDossier.keyWork ?? []),
    ...(durable?.sessionDossier.decisions ?? []),
    ...(durable?.sessionDossier.blockers ?? []),
    durable?.sessionDossier.verification.status,
    durable?.sessionDossier.verification.summary,
    ...(durable?.sessionDossier.verification.commands ?? []),
    ...(durable?.sessionDossier.verification.failures ?? []),
    durable?.sessionDossier.continuation.nextStep,
    ...(durable?.sessionDossier.continuation.openQuestions ?? []),
    ...(durable?.sessionDossier.continuation.constraints ?? []),
    ...(durable?.sessionDossier.warnings ?? []),
    ...snapshot.narrative.topics,
    ...snapshot.narrative.technologies,
    ...snapshot.narrative.unresolved,
    ...snapshot.files.flatMap((file) => [file.path, file.displayPath, file.basename, file.effectKind]),
    ...snapshot.tools.flatMap((tool) => [tool.toolName, tool.category, tool.status, tool.outputPreview]),
    snapshot.verification.summary,
    ...snapshot.verification.commands.flatMap((tool) => [tool.toolName, tool.status, tool.outputPreview]),
    ...snapshot.attention.flatMap((item) => [item.title, item.detail]),
    ...snapshot.excerpts.map((excerpt) => excerpt.text)
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join("\n")
    .slice(0, 256_000);
}

export function getSessionArtifact(db: MastheadDatabase, artifactId: string): SessionArtifactRecord | undefined {
  return readArtifactById(db, artifactId);
}

export function listSessionArtifacts(
  db: MastheadDatabase,
  options: { sessionId?: string; artifactKind?: SessionArtifactKind; publicationStatus?: SessionArtifactPublicationStatus } = {}
): SessionArtifactRecord[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.sessionId) {
    clauses.push(
      `(session_id = ? OR artifact_id IN (SELECT artifact_id FROM session_artifact_provenance WHERE session_id = ?))`
    );
    params.push(options.sessionId, options.sessionId);
  }
  if (options.artifactKind) {
    clauses.push("artifact_kind = ?");
    params.push(options.artifactKind);
  }
  if (options.publicationStatus) {
    clauses.push("publication_status = ?");
    params.push(options.publicationStatus);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `${ARTIFACT_SELECT}
      ${where}
      ORDER BY CASE status WHEN 'current' THEN 0 WHEN 'superseded' THEN 1 ELSE 2 END, updated_at DESC, artifact_id DESC`
    )
    .all(...params) as SessionArtifactRow[];
  return rows.map((row) => rowToRecord(db, row));
}

export function searchPublishedArtifactCapsules(
  db: MastheadDatabase,
  query: SearchPublishedArtifactsQuery = {}
): { artifacts: ArtifactCapsule[]; total: number } {
  const limit = Math.max(1, Math.min(Math.trunc(query.limit ?? 50), 100));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const clauses = [`publication_status = 'published'`, `status = 'current'`];
  const params: Array<string | number> = [];

  if (query.kind) {
    clauses.push("artifact_kind = ?");
    params.push(query.kind);
  }
  if (query.project) {
    clauses.push("project_label = ?");
    params.push(query.project);
  }
  const searchQuery = sanitizeArtifactSearchQuery(query.q);
  if (searchQuery) {
    clauses.push(
      `artifact_id IN (
        SELECT artifact_id
        FROM session_artifact_search
        WHERE session_artifact_search MATCH ?
      )`
    );
    params.push(searchQuery);
  }
  const dateFrom = normalizeDateLowerBound(query.dateFrom);
  if (dateFrom) {
    clauses.push("published_at >= ?");
    params.push(dateFrom);
  }
  const dateTo = normalizeDateUpperBound(query.dateTo);
  if (dateTo) {
    clauses.push("published_at <= ?");
    params.push(dateTo);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM session_artifacts ${where}`).get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `${ARTIFACT_SELECT}
      ${where}
      ORDER BY published_at DESC, updated_at DESC, artifact_id DESC
      LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as SessionArtifactRow[];

  return {
    artifacts: rows.map((row) => toCapsule(db, row)),
    total
  };
}

/**
 * Read-only, fail-closed identification of the one known failed V1 publication.
 * It deliberately refuses to return a partial or merely similar V1 population.
 */
export function auditFailedV1Generation(db: MastheadDatabase): FailedGenerationAudit {
  return selectFailedV1Generation(db).audit;
}

export function invalidateFailedV1Generation(
  db: MastheadDatabase,
  expectedAuditHash: string,
  recoveryBackup: FailedGenerationRecoveryBackupEvidence,
  options: { onMutationBoundary?: (boundary: FailedGenerationInvalidationBoundary) => void } = {}
): FailedGenerationReceipt {
  if (!/^[a-f0-9]{64}$/u.test(expectedAuditHash)) throw new Error("failed_v1_recovery_audit_hash_invalid");
  if (!recoveryBackup) throw new Error("failed_v1_recovery_backup_evidence_required");
  return withImmediateTransaction(db, () => {
    const selection = selectFailedV1Generation(db);
    if (selection.audit.auditHash !== expectedAuditHash) {
      throw new Error(
        `failed_v1_recovery_audit_hash_mismatch:${expectedAuditHash}:${selection.audit.auditHash}`
      );
    }
    const boundRecoveryBackup = { ...recoveryBackup };
    validateFailedGenerationRecoveryBackup(db, selection.audit, boundRecoveryBackup);
    const now = new Date().toISOString();
    const deleteSearch = db.prepare("DELETE FROM session_artifact_search WHERE artifact_id = ?");
    const deleteProvenance = db.prepare("DELETE FROM session_artifact_provenance WHERE artifact_id = ?");
    const deleteArtifact = db.prepare("DELETE FROM session_artifacts WHERE artifact_id = ?");
    let searchRowsDeleted = 0;
    let provenanceDeleted = 0;
    let artifactsInvalidated = 0;
    for (const artifactId of selection.artifactIds) searchRowsDeleted += Number(deleteSearch.run(artifactId).changes);
    options.onMutationBoundary?.("search_deleted");
    for (const artifactId of selection.artifactIds) provenanceDeleted += Number(deleteProvenance.run(artifactId).changes);
    options.onMutationBoundary?.("provenance_deleted");
    for (const artifactId of selection.artifactIds) artifactsInvalidated += Number(deleteArtifact.run(artifactId).changes);
    options.onMutationBoundary?.("artifacts_deleted");

    const resetPipeline = db.prepare(
      `UPDATE workbench_session_state
       SET publication_status = 'publish_path',
           next_action = 'create_dossier',
           session_dossier_status = 'missing',
           bug_fix_trace_status = 'unknown',
           runbook_status = 'unknown',
           adr_status = 'unknown',
           incident_timeline_status = 'unknown',
           session_package_status = 'missing',
           resolution_status = 'in_progress',
           non_publication_reason = NULL,
           published_at = NULL,
           published_activity_id = NULL,
           updated_at = ?
       WHERE session_id = ?`
    );
    let sessionsReset = 0;
    for (const sessionId of selection.sessionIds) sessionsReset += Number(resetPipeline.run(now, sessionId).changes);
    options.onMutationBoundary?.("pipeline_reset");

    const releaseClaim = db.prepare(
      `UPDATE workbench_claims
       SET released_at = ?, release_reason = 'failed_v1_generation_recovery'
       WHERE claim_id = ? AND released_at IS NULL`
    );
    let claimsReleased = 0;
    for (const claimId of selection.claimIds) claimsReleased += Number(releaseClaim.run(now, claimId).changes);
    options.onMutationBoundary?.("claims_released");

    const activitySessionId = selection.sessionIds[0]!;
    const activityId = stableRecordId("workbench_activity", [
      "failed_v1_generation_recovery",
      expectedAuditHash
    ]);
    db.prepare(
      `INSERT INTO workbench_activity (
         activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary,
         details_json, related_run_id, related_claim_id
       ) VALUES (?, ?, 'failed_v1_generation_recovered', ?, 'system', 'mastheadctl', ?, ?, NULL, NULL)`
    ).run(
      activityId,
      activitySessionId,
      now,
      "Failed V1 artifact generation invalidated",
      JSON.stringify({
        artifactCount: selection.artifactIds.length,
        auditHash: expectedAuditHash,
        recoveryBackup: boundRecoveryBackup,
        runIds: selection.runIds,
        sessionCount: selection.sessionIds.length
      })
    );
    options.onMutationBoundary?.("activity_recorded");

    return {
      activityId,
      artifactsInvalidated,
      auditHash: expectedAuditHash,
      claimsReleased,
      provenanceDeleted,
      recoveryBackup: boundRecoveryBackup,
      searchRowsDeleted,
      sessionsReset
    };
  });
}

function validateFailedGenerationRecoveryBackup(
  db: MastheadDatabase,
  audit: FailedGenerationAudit,
  evidence: FailedGenerationRecoveryBackupEvidence
): void {
  if (
    evidence.backupPreserved !== true || evidence.integrityResult !== "ok" ||
    typeof evidence.backupPath !== "string" || !evidence.backupPath ||
    !/^\d+$/u.test(evidence.device) || !/^\d+$/u.test(evidence.inode) ||
    !Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes <= 0
  ) {
    throw new Error("failed_v1_recovery_backup_evidence_invalid");
  }
  if (evidence.auditHash !== audit.auditHash) {
    throw new Error("failed_v1_recovery_backup_audit_hash_mismatch");
  }
  if (
    evidence.artifacts !== audit.totalArtifacts || evidence.runs !== audit.totalRuns ||
    evidence.sessions !== audit.totalSessions
  ) {
    throw new Error("failed_v1_recovery_backup_population_mismatch");
  }
  const identity = db.prepare(
    "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
  ).get() as { value: string } | undefined;
  if (recoveryDatabaseId(identity?.value) !== evidence.databaseId) {
    throw new Error("failed_v1_recovery_backup_identity_mismatch");
  }
}

function recoveryDatabaseId(value: string | undefined): string {
  if (!value) throw new Error("failed_v1_recovery_database_identity_missing");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" && parsed !== null && "databaseId" in parsed &&
      typeof parsed.databaseId === "string" && parsed.databaseId
    ) return parsed.databaseId;
  } catch {
    // Converted to one stable recovery error below.
  }
  throw new Error("failed_v1_recovery_database_identity_invalid");
}

function selectFailedV1Generation(db: MastheadDatabase): FailedGenerationSelection {
  const candidateRuns = listCompletedV1AuthoringRunsForRecovery(db);
  const allV1AuthoredArtifacts = db.prepare(
    `SELECT
       artifact_id AS artifactId, session_id AS sessionId, artifact_kind AS artifactKind,
       status, publication_status AS publicationStatus, content_fingerprint AS contentFingerprint,
       created_at AS createdAt, updated_at AS updatedAt, created_by AS createdBy,
       schema_version AS schemaVersion, published_at AS publishedAt, content_json AS contentJson,
       validation_json AS validationJson, evidence_refs_json AS evidenceRefsJson,
       title, summary, highlight, confidence, project_label AS projectLabel,
       signature_key AS signatureKey, lineage_id AS lineageId, join_rationale AS joinRationale
     FROM session_artifacts
     WHERE created_by LIKE 'workbench_authoring:%'
       AND schema_version IN ('session_dossier-v2', 'runbook-v2', 'adr-v2', 'incident_timeline-v2')
       AND json_extract(validation_json, '$.contract') = 'workbench-authoring-v1'
     ORDER BY artifact_id`
  ).all() as Array<Record<string, unknown>>;
  const artifactsById = new Map(
    allV1AuthoredArtifacts.map((artifact) => [recoveryString(artifact.artifactId), artifact])
  );
  const allV1Provenance = db.prepare(
    `SELECT provenance.artifact_id AS artifactId, provenance.session_id AS sessionId
     FROM session_artifact_provenance AS provenance
     JOIN session_artifacts AS artifacts ON artifacts.artifact_id = provenance.artifact_id
     WHERE artifacts.created_by LIKE 'workbench_authoring:%'
       AND artifacts.schema_version IN ('session_dossier-v2', 'runbook-v2', 'adr-v2', 'incident_timeline-v2')
       AND json_extract(artifacts.validation_json, '$.contract') = 'workbench-authoring-v1'
     ORDER BY provenance.artifact_id, provenance.session_id`
  ).all() as Array<Record<string, unknown>>;
  const provenanceByArtifactId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of allV1Provenance) {
    const artifactId = recoveryString(row.artifactId);
    const existing = provenanceByArtifactId.get(artifactId) ?? [];
    existing.push(row);
    provenanceByArtifactId.set(artifactId, existing);
  }
  const artifacts: Array<Record<string, unknown>> = [];
  const provenance: Array<Record<string, unknown>> = [];
  const selectedRuns: Array<Record<string, unknown>> = [];
  const artifactIds = new Set<string>();
  const sessionIds = new Set<string>();
  const claimIds = new Set<string>();
  const runIds: string[] = [];
  let expectedTemplateSignature: Record<string, unknown> | undefined;

  for (const run of candidateRuns) {
    const bundle = parseRecoveryObject(run.bundleJson, `bundle:${run.runId}`);
    const receipt = parseRecoveryObject(run.receiptJson, `receipt:${run.runId}`);
    const packages = recoveryArray(bundle.sessionPackages);
    const authoredArtifacts = recoveryArray(bundle.artifacts);
    const contributions = recoveryArray(bundle.contributions);
    const notApplicable = recoveryArray(bundle.notApplicable);
    const receiptArtifactIds = recoveryStringArray(receipt.publishedArtifactIds);
    const receiptSessions = recoveryStringArray(receipt.resolvedSessionIds);
    const runSessionIds = [...new Set(run.sessionIds)].sort();
    const packageSessionIds = packages.map((entry) => recoveryString(recoveryObject(entry).sessionId)).sort();
    const expectedNotApplicable = runSessionIds.flatMap((sessionId) =>
      ["adr", "incident_timeline", "runbook"].map((kind) => `${sessionId}\0${kind}`)
    ).sort();
    const actualNotApplicable = notApplicable.map((entry) => {
      const decision = recoveryObject(entry);
      return `${recoveryString(decision.sessionId)}\0${recoveryString(decision.kind)}`;
    }).sort();
    const receiptNotApplicable = recoveryArray(receipt.notApplicable).map((entry) => {
      const decision = recoveryObject(entry);
      return `${recoveryString(decision.sessionId)}\0${recoveryString(decision.kind)}`;
    }).sort();
    const exactRunShape =
      bundle.bundleVersion === "workbench-authoring-v1" &&
      receipt.runId === run.runId &&
      (receipt.contractVersion === undefined || receipt.contractVersion === "workbench-authoring-v1") &&
      packages.length > 0 &&
      authoredArtifacts.length === 0 &&
      contributions.length === 0 &&
      recoveryArray(receipt.contributions).length === 0 &&
      receiptArtifactIds.length === packages.length &&
      sameRecoveryStrings(runSessionIds, packageSessionIds) &&
      sameRecoveryStrings(runSessionIds, [...receiptSessions].sort()) &&
      sameRecoveryStrings(expectedNotApplicable, actualNotApplicable) &&
      sameRecoveryStrings(expectedNotApplicable, receiptNotApplicable);
    if (!exactRunShape) continue;

    const runArtifacts: Array<Record<string, unknown>> = [];
    const runProvenance: Array<Record<string, unknown>> = [];
    let exactMembership = true;
    for (const packageEntry of packages) {
      const sessionPackage = recoveryObject(packageEntry);
      const sessionId = recoveryString(sessionPackage.sessionId);
      const dossier = recoveryObject(sessionPackage.dossier);
      const templateSignature = failedV1TemplateSignature(dossier);
      if (
        expectedTemplateSignature &&
        stableRecoveryStringify(templateSignature) !== stableRecoveryStringify(expectedTemplateSignature)
      ) {
        throw new Error("failed_v1_generation_template_signature_mismatch");
      }
      expectedTemplateSignature ??= templateSignature;
      const expectedFingerprint = recoveryFingerprint(dossier);
      const artifact = receiptArtifactIds
        .map((artifactId) => artifactsById.get(artifactId))
        .find((row) =>
          row?.sessionId === sessionId &&
          row.artifactKind === "session_dossier" &&
          row.contentFingerprint === expectedFingerprint
        );
      if (!artifact) {
        exactMembership = false;
        break;
      }
      const validation = parseRecoveryObject(recoveryString(artifact.validationJson), `validation:${artifact.artifactId}`);
      const content = parseRecoveryObject(recoveryString(artifact.contentJson), `content:${artifact.artifactId}`);
      const publishedAt = recoveryString(artifact.publishedAt);
      if (
        artifact.createdBy !== `workbench_authoring:${run.actorId}` ||
        artifact.schemaVersion !== "session_dossier-v2" ||
        artifact.status !== "current" ||
        artifact.publicationStatus !== "published" ||
        validation.contract !== "workbench-authoring-v1" ||
        validation.schemaVersion !== "session_dossier-v2" ||
        recoveryFingerprint(content) !== expectedFingerprint ||
        stableRecoveryStringify(content) !== stableRecoveryStringify(dossier) ||
        publishedAt < run.createdAt ||
        publishedAt > run.completedAt ||
        artifactIds.has(recoveryString(artifact.artifactId))
      ) {
        exactMembership = false;
        break;
      }
      const artifactProvenance = provenanceByArtifactId.get(recoveryString(artifact.artifactId)) ?? [];
      if (
        artifactProvenance.length !== 1 ||
        artifactProvenance[0]?.sessionId !== sessionId
      ) {
        exactMembership = false;
        break;
      }
      runArtifacts.push(artifact);
      runProvenance.push(...artifactProvenance);
    }
    if (!exactMembership || runArtifacts.length !== receiptArtifactIds.length) continue;
    const foundIds = runArtifacts.map((artifact) => recoveryString(artifact.artifactId)).sort();
    if (!sameRecoveryStrings(foundIds, [...receiptArtifactIds].sort())) continue;

    artifacts.push(...runArtifacts);
    provenance.push(...runProvenance);
    runArtifacts.forEach((artifact) => artifactIds.add(recoveryString(artifact.artifactId)));
    runSessionIds.forEach((sessionId) => sessionIds.add(sessionId));
    run.claimIds.forEach((claimId) => claimIds.add(claimId));
    runIds.push(run.runId);
    selectedRuns.push({
      actorId: run.actorId,
      bundleJson: run.bundleJson,
      claimIds: run.claimIds,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      receiptJson: run.receiptJson,
      runId: run.runId,
      sessionIds: run.sessionIds
    });
  }

  const unmatched = allV1AuthoredArtifacts.filter((artifact) => !artifactIds.has(recoveryString(artifact.artifactId)));
  if (unmatched.length > 0) {
    throw new Error(`failed_v1_generation_ambiguous_population:${unmatched.length}`);
  }
  if (artifacts.length !== FAILED_V1_DOSSIER_COUNT) {
    throw new Error(`failed_v1_generation_not_exact:${artifacts.length}:${FAILED_V1_DOSSIER_COUNT}`);
  }
  if (
    sessionIds.size !== FAILED_V1_DOSSIER_COUNT ||
    claimIds.size !== FAILED_V1_DOSSIER_COUNT ||
    runIds.length !== FAILED_V1_RUN_COUNT
  ) {
    throw new Error("failed_v1_generation_membership_not_exact");
  }

  const selectedArtifactIds = [...artifactIds].sort();
  const selectedSessionIds = [...sessionIds].sort();
  const selectedClaimIds = [...claimIds].sort();
  const artifactPlaceholders = selectedArtifactIds.map(() => "?").join(",");
  const sessionPlaceholders = selectedSessionIds.map(() => "?").join(",");
  const searchRows = db.prepare(
    `SELECT artifact_id AS artifactId, title, summary, highlight, project, body
     FROM session_artifact_search WHERE artifact_id IN (${artifactPlaceholders})`
  ).all(...selectedArtifactIds) as Array<Record<string, unknown>>;
  if (
    searchRows.length !== selectedArtifactIds.length ||
    new Set(searchRows.map((row) => recoveryString(row.artifactId))).size !== selectedArtifactIds.length
  ) {
    throw new Error("failed_v1_generation_search_membership_not_exact");
  }
  const pipeline = db.prepare(
    `SELECT * FROM workbench_session_state WHERE session_id IN (${sessionPlaceholders})`
  ).all(...selectedSessionIds) as Array<Record<string, unknown>>;
  if (pipeline.length !== selectedSessionIds.length) {
    throw new Error("failed_v1_generation_pipeline_missing");
  }
  const claims = db.prepare(
    `SELECT * FROM workbench_claims WHERE session_id IN (${sessionPlaceholders}) ORDER BY claim_id`
  ).all(...selectedSessionIds) as Array<Record<string, unknown>>;
  const claimsById = new Map(claims.map((claim) => [recoveryString(claim.claim_id), claim]));
  if (
    selectedClaimIds.some((claimId) => !claimsById.has(claimId)) ||
    claims.some((claim) => claim.released_at === null && !claimIds.has(recoveryString(claim.claim_id)))
  ) {
    throw new Error("failed_v1_generation_claim_membership_not_exact");
  }
  const snapshot: FailedGenerationRecoverySnapshot = {
    artifacts: artifacts.sort(compareRecoveryRows("artifactId")),
    claims: claims.sort(compareRecoveryRows("claim_id")),
    pipeline: pipeline.sort(compareRecoveryRows("session_id")),
    provenance: provenance.sort(compareRecoveryRows("artifactId", "sessionId")),
    runs: selectedRuns.sort(compareRecoveryRows("runId")),
    search: searchRows.sort(compareRecoveryRows("artifactId"))
  };
  const auditHash = createHash("sha256").update(stableRecoveryStringify(snapshot)).digest("hex");
  const byKind = countRecoveryRows(artifacts, (row) => recoveryString(row.artifactKind));
  const byStatus = countRecoveryRows(
    artifacts,
    (row) => `${recoveryString(row.status)}/${recoveryString(row.publicationStatus)}`
  );
  const bySession = countRecoveryRows(artifacts, (row) => recoveryString(row.sessionId));
  const byRun = Object.fromEntries(
    selectedRuns.map((run) => [recoveryString(run.runId), recoveryArray(parseRecoveryObject(recoveryString(run.receiptJson), "receipt").publishedArtifactIds).length])
  );
  const publishedAt = artifacts.map((artifact) => recoveryString(artifact.publishedAt)).sort();
  const createdBy = [...new Set(artifacts.map((artifact) => recoveryString(artifact.createdBy)))].sort();
  const schemaVersions = [...new Set(artifacts.map((artifact) => recoveryString(artifact.schemaVersion)))].sort();
  const actorIds = [...new Set(selectedRuns.map((run) => recoveryString(run.actorId)))];
  if (actorIds.length !== 1 || createdBy.length !== 1 || createdBy[0] !== `workbench_authoring:${actorIds[0]}`) {
    throw new Error("failed_v1_generation_actor_not_exact");
  }
  const generationWindow = validateFailedV1GenerationWindow(selectedRuns);
  if (!expectedTemplateSignature) throw new Error("failed_v1_generation_template_signature_missing");
  const templateFingerprint = recoveryFingerprint(expectedTemplateSignature);
  const generationFingerprint = recoveryFingerprint({
    actorId: actorIds[0],
    createdBy: createdBy[0],
    generationWindow,
    runIds: [...runIds].sort(),
    templateFingerprint
  });
  const audit: FailedGenerationAudit = {
    actorId: actorIds[0]!,
    adrs: byKind.adr ?? 0,
    auditHash,
    contractVersion: "workbench-authoring-v1",
    counts: { byKind, byRun, bySession, byStatus },
    createdBy,
    dossiers: byKind.session_dossier ?? 0,
    generationFingerprint,
    generationWindow,
    incidentTimelines: byKind.incident_timeline ?? 0,
    publicationWindow: { from: publishedAt[0]!, to: publishedAt.at(-1)! },
    runbooks: byKind.runbook ?? 0,
    schemaVersions,
    templateFingerprint,
    totalArtifacts: artifacts.length,
    totalRuns: runIds.length,
    totalSessions: sessionIds.size
  };
  return {
    artifactIds: selectedArtifactIds,
    audit,
    claimIds: selectedClaimIds,
    runIds: [...runIds].sort(),
    sessionIds: selectedSessionIds
  };
}

function failedV1TemplateSignature(dossier: Record<string, unknown>): Record<string, unknown> {
  const approach = recoveryStringArray(dossier.approach).map(normalizeRecoveryText);
  const keyDecisions = recoveryStringArray(dossier.keyDecisions).map(normalizeRecoveryText);
  const outcome = normalizeRecoveryText(recoveryString(dossier.outcome));
  const problemStatement = normalizeRecoveryText(recoveryString(dossier.problemStatement));
  const missingEvidence = recoveryStringArray(dossier.missingEvidence).map(normalizeRecoveryText);
  const filesTouched = recoveryArray(dossier.filesTouched).map(recoveryObject);
  const commandsAndTools = recoveryArray(dossier.commandsAndTools).map(recoveryObject);
  const filesText = normalizeRecoveryText(stableRecoveryStringify(filesTouched));
  const toolsText = normalizeRecoveryText(stableRecoveryStringify(commandsAndTools));
  if (
    stableRecoveryStringify(approach) !== stableRecoveryStringify([
      "read every canonical evidence item through cursor pagination.",
      "kept all claims single-session and limited unsupported root-cause or publication assertions."
    ]) ||
    stableRecoveryStringify(keyDecisions) !== stableRecoveryStringify([
      "keep the package single-provenance and avoid weak multi-session joins."
    ]) ||
    outcome !== "the canonical redacted record was fully reviewed; no stronger published outcome is asserted without direct supporting evidence." ||
    !problemStatement ||
    stableRecoveryStringify(missingEvidence) !== stableRecoveryStringify([
      "the redacted session record does not independently establish a published artifact or durable root cause."
    ]) ||
    filesText !== normalizeRecoveryText(stableRecoveryStringify([
      {
        label: "No canonical file effect recorded",
        role: "No file effect was asserted in the reviewed evidence."
      }
    ])) ||
    toolsText !== normalizeRecoveryText(stableRecoveryStringify([
      {
        label: "Masthead Workbench evidence reader",
        purpose: "Read the session manifest to completion.",
        status: "completed"
      }
    ]))
  ) {
    throw new Error("failed_v1_generation_template_signature_mismatch");
  }
  return {
    approach,
    commandsAndTools,
    filesTouched,
    keyDecisions,
    missingEvidence,
    outcome,
    problemPrefix: problemStatement.slice(0, 96)
  };
}

function validateFailedV1GenerationWindow(
  runs: Array<Record<string, unknown>>
): { from: string; to: string } {
  const intervals = runs.map((run) => {
    const from = recoveryString(run.createdAt);
    const to = recoveryString(run.completedAt);
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
      throw new Error("failed_v1_generation_window_invalid");
    }
    return { from, fromMs, to, toMs };
  }).sort((left, right) => left.fromMs - right.fromMs || left.toMs - right.toMs);
  const fromMs = intervals[0]!.fromMs;
  const toMs = Math.max(...intervals.map((interval) => interval.toMs));
  const durations = intervals.map((interval) => Math.max(1, interval.toMs - interval.fromMs));
  const maxDuration = Math.max(...durations);
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);
  let runningEnd = intervals[0]!.toMs;
  let maxGap = 0;
  for (const interval of intervals.slice(1)) {
    maxGap = Math.max(maxGap, interval.fromMs - runningEnd);
    runningEnd = Math.max(runningEnd, interval.toMs);
  }
  if (maxGap > maxDuration || toMs - fromMs > totalDuration * 2) {
    throw new Error("failed_v1_generation_window_not_tightly_bounded");
  }
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

function normalizeRecoveryText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function parseRecoveryObject(json: string, label: string): Record<string, unknown> {
  try {
    return recoveryObject(JSON.parse(json));
  } catch (error) {
    throw new Error(`failed_v1_generation_invalid_json:${label}`, { cause: error });
  }
}

function recoveryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("failed_v1_generation_invalid_shape");
  return value as Record<string, unknown>;
}

function recoveryArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("failed_v1_generation_invalid_shape");
  return value;
}

function recoveryStringArray(value: unknown): string[] {
  return recoveryArray(value).map(recoveryString);
}

function recoveryString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("failed_v1_generation_invalid_shape");
  return value;
}

function recoveryFingerprint(value: unknown): string {
  return createHash("sha256").update(stableRecoveryStringify(value)).digest("hex");
}

function stableRecoveryStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRecoveryStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableRecoveryStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sameRecoveryStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function countRecoveryRows(
  rows: Array<Record<string, unknown>>,
  keyFor: (row: Record<string, unknown>) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFor(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function compareRecoveryRows(...keys: string[]): (left: Record<string, unknown>, right: Record<string, unknown>) => number {
  return (left, right) => {
    for (const key of keys) {
      const comparison = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
}

export function wipePublishedArtifactState(db: MastheadDatabase): { artifactsDeleted: number; provenanceDeleted: number } {
  const provenanceDeleted = (
    db.prepare("SELECT COUNT(*) AS count FROM session_artifact_provenance").get() as { count: number }
  ).count;
  const artifactsDeleted = (
    db.prepare("SELECT COUNT(*) AS count FROM session_artifacts").get() as { count: number }
  ).count;
  db.exec("DELETE FROM session_artifact_provenance;");
  db.exec("DELETE FROM session_artifact_search;");
  db.exec("DELETE FROM session_artifacts;");
  db.prepare(
    `UPDATE workbench_session_state
     SET publication_status = 'publish_path',
         published_at = NULL,
         published_activity_id = NULL,
         session_package_status = CASE
           WHEN session_enrichment_status = 'satisfied' AND session_dossier_status = 'satisfied' THEN 'applied'
           ELSE 'missing'
         END,
         resolution_status = 'in_progress',
         bug_fix_trace_status = CASE
           WHEN runbook_status IN ('applied', 'published', 'contributed') THEN 'unknown'
           ELSE bug_fix_trace_status
         END,
         runbook_status = CASE
           WHEN runbook_status IN ('applied', 'published', 'contributed') THEN 'unknown'
           ELSE runbook_status
         END,
         adr_status = CASE
           WHEN adr_status IN ('applied', 'published', 'contributed') THEN 'unknown'
           ELSE adr_status
         END,
         incident_timeline_status = CASE
           WHEN incident_timeline_status IN ('applied', 'published', 'contributed') THEN 'unknown'
           ELSE incident_timeline_status
         END,
         updated_at = ?`
  ).run(new Date().toISOString());
  return { artifactsDeleted, provenanceDeleted };
}

function indexArtifactScope(
  db: MastheadDatabase,
  input: Pick<SessionArtifactInput, "artifactKind" | "sessionId" | "signatureKey">
): void {
  const rows = input.signatureKey
    ? (db
        .prepare(
          `SELECT artifact_id AS artifactId
           FROM session_artifacts
           WHERE artifact_kind = ? AND signature_key = ?`
        )
        .all(input.artifactKind, input.signatureKey) as Array<{ artifactId: string }>)
    : (db
        .prepare(
          `SELECT artifact_id AS artifactId
           FROM session_artifacts
           WHERE session_id = ? AND artifact_kind = ?`
        )
        .all(input.sessionId, input.artifactKind) as Array<{ artifactId: string }>);
  for (const row of rows) indexSessionArtifactSearch(db, row.artifactId);
}

function normalizeProvenance(input: SessionArtifactInput): string[] {
  const raw = input.provenanceSessionIds?.length ? input.provenanceSessionIds : [input.sessionId];
  const unique = Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)));
  if (!unique.includes(input.sessionId)) unique.unshift(input.sessionId);
  return unique;
}

function validateProvenanceRules(
  kind: SessionArtifactKind,
  provenanceSessionIds: string[],
  joinRationale: string | undefined
): void {
  if (kind === "session_dossier" && provenanceSessionIds.length !== 1) {
    throw new Error("session_dossier provenance must be exactly one session");
  }
  if (provenanceSessionIds.length > 1 && !joinRationale?.trim()) {
    throw new Error("joinRationale is required when provenance includes more than one session");
  }
}

function resolveLineageId(db: MastheadDatabase, input: SessionArtifactInput, newArtifactId: string): string {
  if (!input.signatureKey) return newArtifactId;
  const current = db
    .prepare(
      `SELECT lineage_id AS lineageId
       FROM session_artifacts
       WHERE artifact_kind = ? AND signature_key = ? AND status = 'current'
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(input.artifactKind, input.signatureKey) as { lineageId: string | null } | undefined;
  return current?.lineageId ?? newArtifactId;
}

function supersedeForApply(db: MastheadDatabase, input: SessionArtifactInput, lineageId: string): void {
  const now = new Date().toISOString();
  if (input.signatureKey) {
    db.prepare(
      `UPDATE session_artifacts
       SET status = 'superseded', updated_at = ?
       WHERE artifact_kind = ? AND signature_key = ? AND status = 'current'`
    ).run(now, input.artifactKind, input.signatureKey);
    return;
  }
  if (input.artifactKind === "session_dossier") {
    db.prepare(
      `UPDATE session_artifacts
       SET status = 'superseded', updated_at = ?
       WHERE session_id = ? AND artifact_kind = ? AND status = 'current'`
    ).run(now, input.sessionId, input.artifactKind);
    return;
  }
  // Multi-session capable without signature: supersede same primary session + kind current draft only
  db.prepare(
    `UPDATE session_artifacts
     SET status = 'superseded', updated_at = ?
     WHERE session_id = ? AND artifact_kind = ? AND status = 'current' AND lineage_id = ?`
  ).run(now, input.sessionId, input.artifactKind, lineageId);
  db.prepare(
    `UPDATE session_artifacts
     SET status = 'superseded', updated_at = ?
     WHERE session_id = ? AND artifact_kind = ? AND status = 'current' AND publication_status = 'applied'`
  ).run(now, input.sessionId, input.artifactKind);
}

function replaceProvenance(db: MastheadDatabase, artifactId: string, sessionIds: string[]): void {
  db.prepare("DELETE FROM session_artifact_provenance WHERE artifact_id = ?").run(artifactId);
  const insert = db.prepare("INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)");
  for (const sessionId of sessionIds) {
    insert.run(artifactId, sessionId);
  }
}

function readArtifactByFingerprint(
  db: MastheadDatabase,
  input: Pick<SessionArtifactInput, "artifactKind" | "contentFingerprint" | "schemaVersion" | "sessionId">
): SessionArtifactRecord | undefined {
  const row = db
    .prepare(
      `${ARTIFACT_SELECT}
      WHERE session_id = ? AND artifact_kind = ? AND schema_version = ? AND content_fingerprint = ?`
    )
    .get(input.sessionId, input.artifactKind, input.schemaVersion, input.contentFingerprint) as SessionArtifactRow | undefined;
  return row ? rowToRecord(db, row) : undefined;
}

function readArtifactById(db: MastheadDatabase, artifactId: string): SessionArtifactRecord | undefined {
  const row = db.prepare(`${ARTIFACT_SELECT} WHERE artifact_id = ?`).get(artifactId) as SessionArtifactRow | undefined;
  return row ? rowToRecord(db, row) : undefined;
}

function makeCurrentInTransaction(db: MastheadDatabase, artifact: SessionArtifactRecord): void {
  const now = new Date().toISOString();
  if (artifact.signatureKey) {
    db.prepare(
      `UPDATE session_artifacts SET status = 'superseded', updated_at = ?
       WHERE artifact_kind = ? AND signature_key = ? AND status = 'current' AND artifact_id <> ?`
    ).run(now, artifact.artifactKind, artifact.signatureKey, artifact.artifactId);
  } else if (artifact.artifactKind === "session_dossier") {
    db.prepare(
      `UPDATE session_artifacts SET status = 'superseded', updated_at = ?
       WHERE session_id = ? AND artifact_kind = ? AND status = 'current' AND artifact_id <> ?`
    ).run(now, artifact.sessionId, artifact.artifactKind, artifact.artifactId);
  }
  db.prepare(
    "UPDATE session_artifacts SET status = 'current', updated_at = ? WHERE artifact_id = ? AND status <> 'current'"
  ).run(now, artifact.artifactId);
}

function provenanceFor(db: MastheadDatabase, artifactId: string): string[] {
  const rows = db
    .prepare("SELECT session_id AS sessionId FROM session_artifact_provenance WHERE artifact_id = ? ORDER BY session_id")
    .all(artifactId) as Array<{ sessionId: string }>;
  return rows.map((row) => row.sessionId);
}

function rowToRecord(db: MastheadDatabase, row: SessionArtifactRow): SessionArtifactRecord {
  const provenanceSessionIds = provenanceFor(db, row.artifactId);
  return {
    artifactId: row.artifactId,
    artifactKind: row.artifactKind,
    confidence: row.confidence ?? undefined,
    content: JSON.parse(row.contentJson) as unknown,
    contentFingerprint: row.contentFingerprint,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
    highlight: row.highlight ?? undefined,
    joinRationale: row.joinRationale ?? undefined,
    lineageId: row.lineageId ?? row.artifactId,
    projectLabel: row.projectLabel ?? undefined,
    provenanceSessionIds: provenanceSessionIds.length > 0 ? provenanceSessionIds : [row.sessionId],
    publicationStatus: row.publicationStatus ?? "applied",
    publishedAt: row.publishedAt ?? undefined,
    schemaVersion: row.schemaVersion,
    sessionId: row.sessionId,
    signatureKey: row.signatureKey ?? undefined,
    status: row.status,
    summary: row.summary ?? undefined,
    title: row.title ?? undefined,
    updatedAt: row.updatedAt,
    validation: JSON.parse(row.validationJson) as unknown
  };
}

function toCapsule(db: MastheadDatabase, row: SessionArtifactRow): ArtifactCapsule {
  const provenanceSessionIds = provenanceFor(db, row.artifactId);
  const size = provenanceSessionIds.length > 0 ? provenanceSessionIds.length : 1;
  return {
    artifactId: row.artifactId,
    confidence: row.confidence ?? undefined,
    highlight: row.highlight ?? undefined,
    kind: row.artifactKind,
    project: row.projectLabel ?? undefined,
    provenanceLabel: size === 1 ? "1 session" : `${size} sessions`,
    provenanceSize: size,
    publishedAt: row.publishedAt ?? undefined,
    signatureKey: row.signatureKey ?? undefined,
    status: row.status,
    summary: row.summary ?? row.title ?? "",
    title: row.title ?? "Untitled artifact"
  };
}

function capsuleFieldsFromInput(input: SessionArtifactInput): {
  title: string | null;
  summary: string | null;
  highlight: string | null;
  confidence: string | null;
  projectLabel: string | null;
} {
  const content = isRecord(input.content) ? input.content : {};
  const title = input.title ?? (typeof content.title === "string" ? content.title : undefined);
  const summary =
    input.summary ??
    (typeof content.summary === "string"
      ? content.summary
      : typeof content.decision === "string"
        ? content.decision
        : typeof content.problemSignature === "object" && content.problemSignature && isRecord(content.problemSignature)
          ? firstString(content.problemSignature.symptoms as unknown) ??
            firstString(content.problemSignature.errorStrings as unknown)
          : typeof content.symptom === "string"
            ? content.symptom
            : undefined);
  const highlight =
    input.highlight ??
    (input.artifactKind === "runbook"
      ? firstString(isRecord(content.problemSignature) ? content.problemSignature.symptoms : undefined) ??
        firstString(isRecord(content.problemSignature) ? content.problemSignature.errorStrings : undefined)
      : input.artifactKind === "adr"
        ? typeof content.decision === "string"
          ? content.decision
          : undefined
        : input.artifactKind === "incident_timeline"
          ? typeof content.symptom === "string"
            ? content.symptom
            : undefined
          : title);
  const confidence =
    input.confidence ??
    (content.confidence === "high" || content.confidence === "medium" || content.confidence === "low"
      ? content.confidence
      : undefined);
  return {
    confidence: confidence ?? null,
    highlight: highlight ?? null,
    projectLabel: input.projectLabel ?? null,
    summary: summary ?? title ?? null,
    title: title ?? null
  };
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof first === "string" ? first : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDateLowerBound(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isDateOnly(value) ? `${value}T00:00:00.000Z` : value;
}

function sanitizeArtifactSearchQuery(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const terms = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
}

function normalizeDateUpperBound(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isDateOnly(value) ? `${value}T23:59:59.999Z` : value;
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
