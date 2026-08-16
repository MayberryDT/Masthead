import {
  evaluateStableSessionDossierEligibility,
  type StableEligibilityReason
} from "../../mastheadPages/eligibility.ts";
import type { ResolveMastheadPagesSelectionResult } from "../../mastheadPages/selection.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { withImmediateTransaction } from "./sqlite.ts";

export const MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION = "masthead-pages-session-dossier-v1";
export const MASTHEAD_PAGES_ELIGIBILITY_BACKFILL_BATCH_SIZE = 100;
export const MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT = 25;
export const MASTHEAD_PAGES_SELECTION_LIMIT = 500;

export type MastheadPagesArtifactEligibilityStatus = "eligible" | "ineligible" | "error";

export type MastheadPagesArtifactEligibilityRow = {
  artifactId: string;
  policyVersion: string;
  status: MastheadPagesArtifactEligibilityStatus;
  reasonCode?: string;
  evaluatedAt: string;
};

export type MastheadPagesArtifactEligibilityInput = {
  artifactId: string;
  artifactKind: string;
  schemaVersion: string;
  content: unknown;
  provenanceSessionIds: readonly string[];
};

export type MastheadPagesEligibilityBackfillResult = {
  policyVersion: string;
  scanned: number;
  materialized: number;
  errors: number;
  nextCursor?: string;
  complete: boolean;
};

export type MastheadPagesEligibilityDiagnosticKind =
  | "missing"
  | "duplicate"
  | "impossible"
  | "stale_policy"
  | "orphaned"
  | "error";

export type MastheadPagesEligibilityDiagnostics = {
  policyVersion: string;
  counts: Record<MastheadPagesEligibilityDiagnosticKind, number>;
  samples: Record<MastheadPagesEligibilityDiagnosticKind, string[]>;
};

export type MaterializedMastheadPagesSelectionQuery = {
  q?: string;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
};

type SupportedArtifactRow = {
  artifactId: string;
  artifactKind: string;
  schemaVersion: string;
  contentJson: string;
};

export type MastheadPagesSelectionSql = {
  from: string;
  predicates: string[];
  params: Array<string | number>;
  ordering: string;
};

const SUPPORTED_DOSSIER_PREDICATES = [
  "session_artifacts.artifact_kind = 'session_dossier'",
  "session_artifacts.schema_version = 'canonical-session-dossier-v1'"
];

const LEGACY_MAX_CANDIDATE_WINDOW = 2_000;
const LEGACY_CANDIDATE_OVERSAMPLE_FACTOR = 4;

export function materializeMastheadPagesArtifactEligibilityInTransaction(
  db: MastheadDatabase,
  input: MastheadPagesArtifactEligibilityInput,
  evaluatedAt = new Date().toISOString()
): MastheadPagesArtifactEligibilityRow | undefined {
  if (
    input.artifactKind !== "session_dossier" ||
    input.schemaVersion !== "canonical-session-dossier-v1"
  ) {
    return undefined;
  }

  let status: MastheadPagesArtifactEligibilityStatus;
  let reasonCode: StableEligibilityReason | "eligibility_evaluation_error" | undefined;
  try {
    const result = evaluateStableSessionDossierEligibility({
      artifactKind: input.artifactKind,
      schemaVersion: input.schemaVersion,
      content: input.content as PublishedSessionDossierV1,
      provenanceSessionIds: input.provenanceSessionIds
    });
    status = result.eligible ? "eligible" : "ineligible";
    reasonCode = result.eligible ? undefined : result.reason;
  } catch {
    status = "error";
    reasonCode = "eligibility_evaluation_error";
  }

  db.prepare(
    `INSERT INTO masthead_pages_artifact_eligibility (
       artifact_id, policy_version, status, reason_code, evaluated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(artifact_id, policy_version) DO UPDATE SET
       status = excluded.status,
       reason_code = excluded.reason_code,
       evaluated_at = excluded.evaluated_at`
  ).run(
    input.artifactId,
    MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
    status,
    reasonCode ?? null,
    evaluatedAt
  );

  return {
    artifactId: input.artifactId,
    evaluatedAt,
    policyVersion: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
    reasonCode,
    status
  };
}

export function getMastheadPagesArtifactEligibility(
  db: MastheadDatabase,
  artifactId: string,
  policyVersion = MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION
): MastheadPagesArtifactEligibilityRow | undefined {
  const row = db.prepare(
    `SELECT artifact_id AS artifactId,
            policy_version AS policyVersion,
            status,
            reason_code AS reasonCode,
            evaluated_at AS evaluatedAt
     FROM masthead_pages_artifact_eligibility
     WHERE artifact_id = ? AND policy_version = ?`
  ).get(artifactId, policyVersion) as (Omit<MastheadPagesArtifactEligibilityRow, "reasonCode"> & {
    reasonCode: string | null;
  }) | undefined;
  return row ? { ...row, reasonCode: row.reasonCode ?? undefined } : undefined;
}

export function backfillMastheadPagesArtifactEligibilityBatch(
  db: MastheadDatabase,
  options: { afterArtifactId?: string; batchSize?: number } = {}
): MastheadPagesEligibilityBackfillResult {
  const batchSize = Math.max(
    1,
    Math.min(
      Math.trunc(options.batchSize ?? MASTHEAD_PAGES_ELIGIBILITY_BACKFILL_BATCH_SIZE),
      MASTHEAD_PAGES_ELIGIBILITY_BACKFILL_BATCH_SIZE
    )
  );
  const rows = db.prepare(
    `SELECT session_artifacts.artifact_id AS artifactId,
            session_artifacts.artifact_kind AS artifactKind,
            session_artifacts.schema_version AS schemaVersion,
            session_artifacts.content_json AS contentJson
     FROM session_artifacts
     LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
     WHERE session_artifacts.artifact_kind = 'session_dossier'
       AND session_artifacts.schema_version = 'canonical-session-dossier-v1'
       AND session_artifacts.artifact_id > ?
       AND eligibility.artifact_id IS NULL
     ORDER BY session_artifacts.artifact_id
     LIMIT ?`
  ).all(
    MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
    options.afterArtifactId ?? "",
    batchSize
  ) as SupportedArtifactRow[];

  if (rows.length === 0) {
    return {
      complete: true,
      errors: 0,
      materialized: 0,
      policyVersion: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
      scanned: 0
    };
  }

  const provenanceByArtifact = readProvenanceForArtifacts(db, rows.map((row) => row.artifactId));
  let errors = 0;
  const evaluatedAt = new Date().toISOString();
  withImmediateTransaction(db, () => {
    for (const row of rows) {
      const provenance = provenanceByArtifact.get(row.artifactId) ?? [];
      let content: unknown;
      try {
        content = JSON.parse(row.contentJson) as unknown;
      } catch {
        content = undefined;
      }
      const materialized = materializeMastheadPagesArtifactEligibilityInTransaction(
        db,
        {
          artifactId: row.artifactId,
          artifactKind: row.artifactKind,
          content,
          provenanceSessionIds: provenance,
          schemaVersion: row.schemaVersion
        },
        evaluatedAt
      );
      if (materialized?.status === "error") errors += 1;
    }
  });

  return {
    complete: rows.length < batchSize,
    errors,
    materialized: rows.length,
    nextCursor: rows.length < batchSize ? undefined : rows.at(-1)?.artifactId,
    policyVersion: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
    scanned: rows.length
  };
}

export function diagnoseMastheadPagesArtifactEligibility(
  db: MastheadDatabase,
  sampleLimit = 25
): MastheadPagesEligibilityDiagnostics {
  const boundedSampleLimit = Math.max(1, Math.min(Math.trunc(sampleLimit), 100));
  const definitions: Record<MastheadPagesEligibilityDiagnosticKind, { countSql: string; sampleSql: string; params: string[] }> = {
    missing: {
      countSql: `SELECT COUNT(*) AS count
                 FROM session_artifacts
                 LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
                   ON eligibility.artifact_id = session_artifacts.artifact_id
                  AND eligibility.policy_version = ?
                 WHERE session_artifacts.status = 'current'
                   AND session_artifacts.publication_status = 'published'
                   AND session_artifacts.artifact_kind = 'session_dossier'
                   AND session_artifacts.schema_version = 'canonical-session-dossier-v1'
                   AND eligibility.artifact_id IS NULL`,
      sampleSql: `SELECT session_artifacts.artifact_id AS artifactId
                  FROM session_artifacts
                  LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
                    ON eligibility.artifact_id = session_artifacts.artifact_id
                   AND eligibility.policy_version = ?
                  WHERE session_artifacts.status = 'current'
                    AND session_artifacts.publication_status = 'published'
                    AND session_artifacts.artifact_kind = 'session_dossier'
                    AND session_artifacts.schema_version = 'canonical-session-dossier-v1'
                    AND eligibility.artifact_id IS NULL
                  ORDER BY session_artifacts.artifact_id LIMIT ?`,
      params: [MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION]
    },
    duplicate: {
      countSql: `SELECT COUNT(*) AS count FROM (
                   SELECT artifact_id, policy_version
                   FROM masthead_pages_artifact_eligibility
                   GROUP BY artifact_id, policy_version HAVING COUNT(*) > 1
                 )`,
      sampleSql: `SELECT artifact_id || '@' || policy_version AS artifactId
                  FROM masthead_pages_artifact_eligibility
                  GROUP BY artifact_id, policy_version HAVING COUNT(*) > 1
                  ORDER BY artifact_id, policy_version LIMIT ?`,
      params: []
    },
    impossible: {
      countSql: `SELECT COUNT(*) AS count
                 FROM masthead_pages_artifact_eligibility AS eligibility
                 JOIN session_artifacts ON session_artifacts.artifact_id = eligibility.artifact_id
                 WHERE (eligibility.status = 'eligible' AND eligibility.reason_code IS NOT NULL)
                    OR (eligibility.status <> 'eligible' AND eligibility.reason_code IS NULL)
                    OR session_artifacts.artifact_kind <> 'session_dossier'
                    OR session_artifacts.schema_version <> 'canonical-session-dossier-v1'`,
      sampleSql: `SELECT eligibility.artifact_id AS artifactId
                  FROM masthead_pages_artifact_eligibility AS eligibility
                  JOIN session_artifacts ON session_artifacts.artifact_id = eligibility.artifact_id
                  WHERE (eligibility.status = 'eligible' AND eligibility.reason_code IS NOT NULL)
                     OR (eligibility.status <> 'eligible' AND eligibility.reason_code IS NULL)
                     OR session_artifacts.artifact_kind <> 'session_dossier'
                     OR session_artifacts.schema_version <> 'canonical-session-dossier-v1'
                  ORDER BY eligibility.artifact_id LIMIT ?`,
      params: []
    },
    stale_policy: {
      countSql: `SELECT COUNT(*) AS count
                 FROM masthead_pages_artifact_eligibility
                 WHERE policy_version <> ?`,
      sampleSql: `SELECT artifact_id || '@' || policy_version AS artifactId
                  FROM masthead_pages_artifact_eligibility
                  WHERE policy_version <> ?
                  ORDER BY artifact_id, policy_version LIMIT ?`,
      params: [MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION]
    },
    orphaned: {
      countSql: `SELECT COUNT(*) AS count
                 FROM masthead_pages_artifact_eligibility AS eligibility
                 LEFT JOIN session_artifacts ON session_artifacts.artifact_id = eligibility.artifact_id
                 WHERE session_artifacts.artifact_id IS NULL`,
      sampleSql: `SELECT eligibility.artifact_id AS artifactId
                  FROM masthead_pages_artifact_eligibility AS eligibility
                  LEFT JOIN session_artifacts ON session_artifacts.artifact_id = eligibility.artifact_id
                  WHERE session_artifacts.artifact_id IS NULL
                  ORDER BY eligibility.artifact_id LIMIT ?`,
      params: []
    },
    error: {
      countSql: `SELECT COUNT(*) AS count
                 FROM masthead_pages_artifact_eligibility
                 WHERE policy_version = ? AND status = 'error'`,
      sampleSql: `SELECT artifact_id AS artifactId
                  FROM masthead_pages_artifact_eligibility
                  WHERE policy_version = ? AND status = 'error'
                  ORDER BY artifact_id LIMIT ?`,
      params: [MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION]
    }
  };

  const counts = {} as Record<MastheadPagesEligibilityDiagnosticKind, number>;
  const samples = {} as Record<MastheadPagesEligibilityDiagnosticKind, string[]>;
  for (const kind of Object.keys(definitions) as MastheadPagesEligibilityDiagnosticKind[]) {
    const definition = definitions[kind];
    counts[kind] = Number((db.prepare(definition.countSql).get(...definition.params) as { count: number }).count);
    samples[kind] = (db.prepare(definition.sampleSql).all(...definition.params, boundedSampleLimit) as Array<{
      artifactId: string;
    }>).map((row) => row.artifactId);
  }
  return { counts, policyVersion: MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, samples };
}

export function resolveMaterializedMastheadPagesSelection(
  db: MastheadDatabase,
  query: MaterializedMastheadPagesSelectionQuery = {},
  limit = MASTHEAD_PAGES_SELECTION_LIMIT
): ResolveMastheadPagesSelectionResult {
  const capped = capMastheadPagesSelectionLimit(limit);
  const sql = buildMastheadPagesSelectionSql(query);
  const missing = db.prepare(
    `SELECT session_artifacts.artifact_id AS artifactId
     ${sql.from}
     LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
     WHERE ${sql.predicates.join(" AND ")}
       AND eligibility.artifact_id IS NULL
     ORDER BY ${sql.ordering}
     LIMIT ?`
  ).all(
    MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
    ...sql.params,
    MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT + 1
  ) as Array<{ artifactId: string }>;

  if (missing.length > MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT) {
    return {
      artifactIds: [],
      reason: "eligibility_backfill_incomplete",
      retryable: true,
      status: "incomplete"
    };
  }

  if (missing.length > 0) {
    const repair = repairMissingEligibilityRows(db, missing.map((row) => row.artifactId));
    if (!repair) {
      return {
        artifactIds: [],
        reason: "eligibility_evaluation_failed",
        retryable: false,
        status: "incomplete"
      };
    }
  }

  const evaluationError = db.prepare(
    `SELECT 1
     ${sql.from}
     JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
      AND eligibility.status = 'error'
     WHERE ${sql.predicates.join(" AND ")}
     LIMIT 1`
  ).get(MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, ...sql.params);
  if (evaluationError) {
    return {
      artifactIds: [],
      reason: "eligibility_evaluation_failed",
      retryable: false,
      status: "incomplete"
    };
  }

  const rows = db.prepare(
    `SELECT session_artifacts.artifact_id AS artifactId
     ${sql.from}
     JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
      AND eligibility.status = 'eligible'
     WHERE ${sql.predicates.join(" AND ")}
     ORDER BY ${sql.ordering}
     LIMIT ?`
  ).all(MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, ...sql.params, capped) as Array<{ artifactId: string }>;
  return { artifactIds: rows.map((row) => row.artifactId), status: "complete" };
}

export function explainMaterializedMastheadPagesSelection(
  db: MastheadDatabase,
  query: MaterializedMastheadPagesSelectionQuery = {},
  limit = MASTHEAD_PAGES_SELECTION_LIMIT
): Array<Record<string, unknown>> {
  const capped = capMastheadPagesSelectionLimit(limit);
  const sql = buildMastheadPagesSelectionSql(query);
  return db.prepare(
    `EXPLAIN QUERY PLAN
     SELECT session_artifacts.artifact_id AS artifactId
     ${sql.from}
     JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
      AND eligibility.status = 'eligible'
     WHERE ${sql.predicates.join(" AND ")}
     ORDER BY ${sql.ordering}
     LIMIT ?`
  ).all(MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, ...sql.params, capped) as Array<Record<string, unknown>>;
}

function repairMissingEligibilityRows(db: MastheadDatabase, artifactIds: string[]): boolean {
  if (artifactIds.length === 0 || artifactIds.length > MASTHEAD_PAGES_ELIGIBILITY_SYNC_REPAIR_LIMIT) return false;
  const placeholders = artifactIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT artifact_id AS artifactId,
            artifact_kind AS artifactKind,
            schema_version AS schemaVersion,
            content_json AS contentJson
     FROM session_artifacts
     WHERE artifact_id IN (${placeholders})`
  ).all(...artifactIds) as SupportedArtifactRow[];
  if (rows.length !== artifactIds.length) return false;

  const provenanceByArtifact = readProvenanceForArtifacts(db, artifactIds);
  let failed = false;
  const evaluatedAt = new Date().toISOString();
  withImmediateTransaction(db, () => {
    for (const row of rows) {
      let content: unknown;
      try {
        content = JSON.parse(row.contentJson) as unknown;
      } catch {
        content = undefined;
      }
      const materialized = materializeMastheadPagesArtifactEligibilityInTransaction(
        db,
        {
          artifactId: row.artifactId,
          artifactKind: row.artifactKind,
          content,
          provenanceSessionIds: provenanceByArtifact.get(row.artifactId) ?? [],
          schemaVersion: row.schemaVersion
        },
        evaluatedAt
      );
      if (!materialized || materialized.status === "error") failed = true;
    }
  });
  return !failed;
}

function readProvenanceForArtifacts(db: MastheadDatabase, artifactIds: string[]): Map<string, string[]> {
  if (artifactIds.length === 0) return new Map();
  const placeholders = artifactIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT artifact_id AS artifactId, session_id AS sessionId
     FROM session_artifact_provenance
     WHERE artifact_id IN (${placeholders})
     ORDER BY artifact_id, session_id`
  ).all(...artifactIds) as Array<{ artifactId: string; sessionId: string }>;
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const sessions = result.get(row.artifactId);
    if (sessions) sessions.push(row.sessionId);
    else result.set(row.artifactId, [row.sessionId]);
  }
  return result;
}

export function buildMastheadPagesSelectionSql(
  query: MaterializedMastheadPagesSelectionQuery
): MastheadPagesSelectionSql {
  const predicates = [
    "session_artifacts.publication_status = 'published'",
    "session_artifacts.status = 'current'",
    ...SUPPORTED_DOSSIER_PREDICATES
  ];
  const params: Array<string | number> = [];
  let from = "FROM session_artifacts";
  let ordering = `session_artifacts.published_at DESC,
                  session_artifacts.updated_at DESC,
                  session_artifacts.artifact_id DESC`;

  if (query.project) {
    predicates.push("session_artifacts.project_label = ?");
    params.push(query.project);
  }
  const searchQuery = typeof query.q === "string" ? query.q.trim() : "";
  if (searchQuery) {
    from += " JOIN session_artifact_search ON session_artifact_search.artifact_id = session_artifacts.artifact_id";
    predicates.push("session_artifact_search MATCH ?");
    params.push(sanitizeMastheadPagesSearchQuery(searchQuery));
    ordering = `bm25(session_artifact_search, 0.0, 12.0, 10.0, 12.0, 1.0, 1.0, 1.0) ASC,
                session_artifacts.published_at DESC,
                session_artifacts.updated_at DESC,
                session_artifacts.artifact_id DESC`;
  }
  if (query.dateFrom) {
    predicates.push("session_artifacts.published_at >= ?");
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    predicates.push("session_artifacts.published_at <= ?");
    params.push(query.dateTo);
  }
  return { from, ordering, params, predicates };
}

export function capMastheadPagesSelectionLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit || MASTHEAD_PAGES_SELECTION_LIMIT), MASTHEAD_PAGES_SELECTION_LIMIT));
}

export function mastheadPagesLegacyCandidateWindowSize(limit: number): number {
  const capped = capMastheadPagesSelectionLimit(limit);
  return Math.min(Math.max(capped * LEGACY_CANDIDATE_OVERSAMPLE_FACTOR, capped), LEGACY_MAX_CANDIDATE_WINDOW);
}

export function sanitizeMastheadPagesSearchQuery(value: string): string {
  const tokens = value
    .replace(/["']/g, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !/^(AND|OR|NOT)$/i.test(token))
    .map((token) => `"${token.replace(/"/g, "")}"`);
  return tokens.length > 0 ? tokens.join(" ") : '""';
}
