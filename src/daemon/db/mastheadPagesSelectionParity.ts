import type {
  MastheadPagesSelectionIncompleteReason,
  ResolveMastheadPagesSelectionResult
} from "../../mastheadPages/selection.ts";
import {
  listEligibleMastheadPagesArtifactIds,
  type LogbookArtifactSearchQuery
} from "./logbookArtifactRepository.ts";
import {
  buildMastheadPagesSelectionSql,
  capMastheadPagesSelectionLimit,
  diagnoseMastheadPagesArtifactEligibility,
  MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION,
  MASTHEAD_PAGES_SELECTION_LIMIT,
  mastheadPagesLegacyCandidateWindowSize as legacyMastheadPagesCandidateWindowSize,
  resolveMaterializedMastheadPagesSelection,
  type MastheadPagesSelectionSql
} from "./mastheadPagesEligibilityRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export { legacyMastheadPagesCandidateWindowSize };

export type MastheadPagesSelectionParityClassification =
  | "equal"
  | "materialization_incomplete"
  | "unaccepted_mismatch"
  | "legacy_candidate_window_exhausted";
export type MastheadPagesSelectionParityDecision =
  | { classification: "equal"; accepted: true }
  | { classification: "legacy_candidate_window_exhausted"; accepted: true }
  | { classification: "materialization_incomplete"; accepted: false }
  | { classification: "unaccepted_mismatch"; accepted: false };
export type MastheadPagesSelectionParityDiagnosticCounts = {
  missing: number;
  duplicate: number;
  impossible: number;
  stale_policy: number;
  orphaned: number;
  error: number;
};


export type MastheadPagesSelectionParityProof = {
  requestedLimit: number;
  legacyCandidateWindowSize: number;
  legacyCandidateWindowExhausted: boolean;
  legacyResultUnderfilled: boolean;
  filtersMatched: boolean;
  orderedPrefixPreserved: boolean;
  newOnlyArtifactIds: string[];
  newOnlyArtifactsEligibleUnderCurrentPolicy: boolean;
  newOnlyArtifactsStrictlyAfterLegacyWindow: boolean;
  materializedOrderAndCapVerified: boolean;
};

type CompleteSelectionResult = Extract<ResolveMastheadPagesSelectionResult, { status: "complete" }>;
type IncompleteSelectionResult = Extract<ResolveMastheadPagesSelectionResult, { status: "incomplete" }>;

type ComparableParityResult = {
  diagnosticCounts: MastheadPagesSelectionParityDiagnosticCounts;
  legacyArtifactIds: string[];
  materializedResult: CompleteSelectionResult;
  proof: MastheadPagesSelectionParityProof;
};

export type MastheadPagesSelectionParityResult =
  | ({ classification: "equal"; accepted: true } & ComparableParityResult)
  | ({ classification: "legacy_candidate_window_exhausted"; accepted: true } & ComparableParityResult)
  | ({ classification: "unaccepted_mismatch"; accepted: false } & ComparableParityResult)
  | {
      classification: "materialization_incomplete";
      accepted: false;
      diagnosticCounts: MastheadPagesSelectionParityDiagnosticCounts;
      legacyArtifactIds: string[];
      materializedResult: IncompleteSelectionResult;
    };

/**
 * Compares both resolvers against one SQLite snapshot. The read-only preflight
 * prevents the materialized resolver's bounded synchronous repair from
 * upgrading this deferred transaction to a writer.
 */
export function compareMastheadPagesSelectionParity(
  db: MastheadDatabase,
  query: LogbookArtifactSearchQuery = {},
  limit = MASTHEAD_PAGES_SELECTION_LIMIT
): MastheadPagesSelectionParityResult {
  return withDeferredReadTransaction(db, () => {
    const capped = capMastheadPagesSelectionLimit(limit);
    const legacyArtifactIds = listEligibleMastheadPagesArtifactIds(db, query, capped);
    const sql = buildMastheadPagesSelectionSql(query);
    const diagnosticCounts = readMaterializationDiagnosticCounts(db);
    const incomplete = materializationIncompleteFromDiagnostics(diagnosticCounts);
    if (incomplete) {
      return {
        accepted: false,
        classification: "materialization_incomplete",
        diagnosticCounts,
        legacyArtifactIds,
        materializedResult: incomplete
      };
    }

    const materializedResult = resolveMaterializedMastheadPagesSelection(db, query, capped);
    if (materializedResult.status === "incomplete") {
      return {
        accepted: false,
        classification: "materialization_incomplete",
        diagnosticCounts,
        legacyArtifactIds,
        materializedResult
      };
    }

    const legacyCandidateWindowSize = legacyMastheadPagesCandidateWindowSize(capped);
    const legacyCandidateWindowArtifactIds = readCandidateWindow(db, sql, legacyCandidateWindowSize);
    const expectedMaterializedArtifactIds = readCurrentPolicyEligibleIds(db, sql, capped);
    const newOnlyArtifactIds = materializedResult.artifactIds.slice(legacyArtifactIds.length);
    const legacyWindowIds = new Set(legacyCandidateWindowArtifactIds);
    const orderedPrefixPreserved =
      legacyArtifactIds.length < materializedResult.artifactIds.length &&
      legacyArtifactIds.every((artifactId, index) => materializedResult.artifactIds[index] === artifactId);
    const materializedOrderAndCapVerified =
      materializedResult.artifactIds.length <= capped &&
      arraysEqual(materializedResult.artifactIds, expectedMaterializedArtifactIds);
    const filtersMatched =
      legacyArtifactIds.every((artifactId) => legacyWindowIds.has(artifactId)) && materializedOrderAndCapVerified;
    const proof: MastheadPagesSelectionParityProof = {
      filtersMatched,
      legacyCandidateWindowExhausted: legacyCandidateWindowArtifactIds.length === legacyCandidateWindowSize,
      legacyCandidateWindowSize,
      legacyResultUnderfilled: legacyArtifactIds.length < capped,
      materializedOrderAndCapVerified,
      newOnlyArtifactIds,
      newOnlyArtifactsEligibleUnderCurrentPolicy:
        materializedOrderAndCapVerified && newOnlyArtifactIds.length > 0,
      newOnlyArtifactsStrictlyAfterLegacyWindow:
        newOnlyArtifactIds.length > 0 && newOnlyArtifactIds.every((artifactId) => !legacyWindowIds.has(artifactId)),
      orderedPrefixPreserved,
      requestedLimit: capped
    };

    const decision = classifyMastheadPagesSelectionParity(legacyArtifactIds, materializedResult, proof);
    return {
      diagnosticCounts,
      ...decision,
      legacyArtifactIds,
      materializedResult,
      proof
    } as MastheadPagesSelectionParityResult;
  });
}

export function classifyMastheadPagesSelectionParity(
  legacyArtifactIds: readonly string[],
  materializedResult: ResolveMastheadPagesSelectionResult,
  proof?: MastheadPagesSelectionParityProof
): MastheadPagesSelectionParityDecision {
  if (materializedResult.status === "incomplete") {
    return { accepted: false, classification: "materialization_incomplete" };
  }
  if (arraysEqual(legacyArtifactIds, materializedResult.artifactIds)) {
    return { accepted: true, classification: "equal" };
  }
  if (!proof) return { accepted: false, classification: "unaccepted_mismatch" };

  const newOnlyArtifactIds = materializedResult.artifactIds.slice(legacyArtifactIds.length);
  const orderedPrefixPreserved =
    legacyArtifactIds.length < materializedResult.artifactIds.length &&
    legacyArtifactIds.every((artifactId, index) => materializedResult.artifactIds[index] === artifactId);
  const acceptedCandidateWindowExhaustion =
    proof.requestedLimit === capMastheadPagesSelectionLimit(proof.requestedLimit) &&
    proof.legacyCandidateWindowSize === legacyMastheadPagesCandidateWindowSize(proof.requestedLimit) &&
    proof.legacyCandidateWindowExhausted &&
    proof.legacyResultUnderfilled &&
    legacyArtifactIds.length < proof.requestedLimit &&
    proof.filtersMatched &&
    proof.orderedPrefixPreserved &&
    orderedPrefixPreserved &&
    arraysEqual(proof.newOnlyArtifactIds, newOnlyArtifactIds) &&
    proof.newOnlyArtifactsEligibleUnderCurrentPolicy &&
    proof.newOnlyArtifactsStrictlyAfterLegacyWindow &&
    proof.materializedOrderAndCapVerified &&
    materializedResult.artifactIds.length <= proof.requestedLimit;
  return acceptedCandidateWindowExhaustion
    ? { accepted: true, classification: "legacy_candidate_window_exhausted" }
    : { accepted: false, classification: "unaccepted_mismatch" };
}

function withDeferredReadTransaction<T>(db: MastheadDatabase, callback: () => T): T {
  if (db.isTransaction) return callback();
  db.exec("BEGIN DEFERRED TRANSACTION;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function readMaterializationDiagnosticCounts(db: MastheadDatabase): MastheadPagesSelectionParityDiagnosticCounts {
  const { counts } = diagnoseMastheadPagesArtifactEligibility(db, 1);
  return {
    duplicate: counts.duplicate,
    error: counts.error,
    impossible: counts.impossible,
    missing: counts.missing,
    orphaned: counts.orphaned,
    stale_policy: counts.stale_policy
  };
}

function materializationIncompleteFromDiagnostics(
  counts: MastheadPagesSelectionParityDiagnosticCounts
): IncompleteSelectionResult | undefined {
  if (counts.missing > 0) {
    return incompleteSelection("eligibility_backfill_incomplete", true);
  }
  // Rows for old policy versions are retained history: report their count,
  // but do not treat them as unexplained current-policy materialization state.
  if (counts.duplicate > 0 || counts.impossible > 0 || counts.orphaned > 0 || counts.error > 0) {
    return incompleteSelection("eligibility_evaluation_failed", false);
  }
  return undefined;
}

function incompleteSelection(
  reason: MastheadPagesSelectionIncompleteReason,
  retryable: boolean
): IncompleteSelectionResult {
  return { artifactIds: [], reason, retryable, status: "incomplete" };
}

function readCandidateWindow(db: MastheadDatabase, sql: MastheadPagesSelectionSql, limit: number): string[] {
  const rows = db.prepare(
    `SELECT session_artifacts.artifact_id AS artifactId
     ${sql.from}
     WHERE ${sql.predicates.join(" AND ")}
     ORDER BY ${sql.ordering}
     LIMIT ?`
  ).all(...sql.params, limit) as Array<{ artifactId: string }>;
  return rows.map((row) => row.artifactId);
}

function readCurrentPolicyEligibleIds(
  db: MastheadDatabase,
  sql: MastheadPagesSelectionSql,
  limit: number
): string[] {
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
  ).all(MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION, ...sql.params, limit) as Array<{ artifactId: string }>;
  return rows.map((row) => row.artifactId);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => right[index] === value);
}
