import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SessionArtifactKind = "session_dossier" | "bug_fix_trace";
export type SessionArtifactStatus = "current" | "superseded" | "invalid";

export type SessionArtifactInput = {
  sessionId: string;
  artifactKind: SessionArtifactKind;
  contentFingerprint: string;
  createdBy: string;
  schemaVersion: string;
  title?: string;
  content: unknown;
  evidenceRefs: string[];
  validation: unknown;
};

export type SessionArtifactRecord = SessionArtifactInput & {
  artifactId: string;
  status: SessionArtifactStatus;
  createdAt: string;
  updatedAt: string;
};

type SessionArtifactRow = {
  artifactId: string;
  sessionId: string;
  artifactKind: SessionArtifactKind;
  status: SessionArtifactStatus;
  contentFingerprint: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  schemaVersion: string;
  title: string | null;
  contentJson: string;
  evidenceRefsJson: string;
  validationJson: string;
};

export function applySessionArtifact(db: MastheadDatabase, input: SessionArtifactInput): SessionArtifactRecord {
  const existing = readArtifactByFingerprint(db, input);
  if (existing) {
    makeCurrent(db, existing);
    return readArtifactById(db, existing.artifactId)!;
  }

  const now = new Date().toISOString();
  const artifactId = stableRecordId("session_artifact", [input.sessionId, input.artifactKind, input.schemaVersion, input.contentFingerprint]);
  db.exec("BEGIN IMMEDIATE;");
  try {
    supersedeCurrent(db, input.sessionId, input.artifactKind);
    db.prepare(
      `INSERT INTO session_artifacts (
        artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
        created_by, schema_version, title, content_json, evidence_refs_json, validation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      artifactId,
      input.sessionId,
      input.artifactKind,
      "current",
      input.contentFingerprint,
      now,
      now,
      input.createdBy,
      input.schemaVersion,
      input.title ?? null,
      JSON.stringify(input.content),
      JSON.stringify(input.evidenceRefs),
      JSON.stringify(input.validation)
    );
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return readArtifactById(db, artifactId)!;
}

export function listSessionArtifacts(db: MastheadDatabase, options: { sessionId?: string; artifactKind?: SessionArtifactKind }): SessionArtifactRecord[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.sessionId) {
    clauses.push("session_id = ?");
    params.push(options.sessionId);
  }
  if (options.artifactKind) {
    clauses.push("artifact_kind = ?");
    params.push(options.artifactKind);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT
        artifact_id AS artifactId,
        session_id AS sessionId,
        artifact_kind AS artifactKind,
        status,
        content_fingerprint AS contentFingerprint,
        created_at AS createdAt,
        updated_at AS updatedAt,
        created_by AS createdBy,
        schema_version AS schemaVersion,
        title,
        content_json AS contentJson,
        evidence_refs_json AS evidenceRefsJson,
        validation_json AS validationJson
      FROM session_artifacts
      ${where}
      ORDER BY CASE status WHEN 'current' THEN 0 WHEN 'superseded' THEN 1 ELSE 2 END, updated_at DESC, artifact_id DESC`
    )
    .all(...params) as SessionArtifactRow[];
  return rows.map(rowToRecord);
}

function readArtifactByFingerprint(db: MastheadDatabase, input: Pick<SessionArtifactInput, "artifactKind" | "contentFingerprint" | "schemaVersion" | "sessionId">) {
  const row = db
    .prepare(
      `SELECT artifact_id AS artifactId, session_id AS sessionId, artifact_kind AS artifactKind, status,
        content_fingerprint AS contentFingerprint, created_at AS createdAt, updated_at AS updatedAt,
        created_by AS createdBy, schema_version AS schemaVersion, title, content_json AS contentJson,
        evidence_refs_json AS evidenceRefsJson, validation_json AS validationJson
      FROM session_artifacts
      WHERE session_id = ? AND artifact_kind = ? AND schema_version = ? AND content_fingerprint = ?`
    )
    .get(input.sessionId, input.artifactKind, input.schemaVersion, input.contentFingerprint) as SessionArtifactRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

function readArtifactById(db: MastheadDatabase, artifactId: string): SessionArtifactRecord | undefined {
  const row = db
    .prepare(
      `SELECT artifact_id AS artifactId, session_id AS sessionId, artifact_kind AS artifactKind, status,
        content_fingerprint AS contentFingerprint, created_at AS createdAt, updated_at AS updatedAt,
        created_by AS createdBy, schema_version AS schemaVersion, title, content_json AS contentJson,
        evidence_refs_json AS evidenceRefsJson, validation_json AS validationJson
      FROM session_artifacts
      WHERE artifact_id = ?`
    )
    .get(artifactId) as SessionArtifactRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

function makeCurrent(db: MastheadDatabase, artifact: SessionArtifactRecord): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE;");
  try {
    supersedeCurrent(db, artifact.sessionId, artifact.artifactKind);
    db.prepare("UPDATE session_artifacts SET status = 'current', updated_at = ? WHERE artifact_id = ?").run(now, artifact.artifactId);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function supersedeCurrent(db: MastheadDatabase, sessionId: string, artifactKind: SessionArtifactKind): void {
  db.prepare("UPDATE session_artifacts SET status = 'superseded', updated_at = ? WHERE session_id = ? AND artifact_kind = ? AND status = 'current'").run(
    new Date().toISOString(),
    sessionId,
    artifactKind
  );
}

function rowToRecord(row: SessionArtifactRow): SessionArtifactRecord {
  return {
    artifactId: row.artifactId,
    artifactKind: row.artifactKind,
    content: JSON.parse(row.contentJson) as unknown,
    contentFingerprint: row.contentFingerprint,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
    schemaVersion: row.schemaVersion,
    sessionId: row.sessionId,
    status: row.status,
    title: row.title ?? undefined,
    updatedAt: row.updatedAt,
    validation: JSON.parse(row.validationJson) as unknown
  };
}

