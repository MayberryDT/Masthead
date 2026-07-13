import { stableRecordId } from "../identity.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import { type MastheadDatabase, withImmediateTransaction } from "./sqlite.ts";

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
    snapshot.durableEnrichment?.sessionSummary.text,
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
