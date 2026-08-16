#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { Session } from "node:inspector";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SAMPLE_RUNS = 5;
const MAX_SELECTION = 500;
const FTS_WEIGHTS = "0.0, 12.0, 10.0, 12.0, 1.0, 1.0, 1.0";
const QUERY_PLAN_FACTORY = Symbol("queryPlanFactory");

export async function runLocalDataFoundationProbe(options) {
  if (!options.databasePath) throw new Error("--db <path> is required");
  const databasePath = resolve(options.databasePath);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let snapshotOpen = false;
  try {
    const [eligibilityModule, logbookModule, sessionArtifactModule] = await Promise.all([
      importBuiltModule("src/daemon/db/mastheadPagesEligibilityRepository.js"),
      importBuiltModule("src/daemon/db/logbookArtifactRepository.js"),
      importBuiltModule("src/daemon/db/sessionArtifactRepository.js")
    ]);
    db.exec("BEGIN");
    snapshotOpen = true;
    const policyVersion = eligibilityModule.MASTHEAD_PAGES_ELIGIBILITY_POLICY_VERSION;
    const requestedLimit = Math.max(1, Math.min(Number(options.limit || MAX_SELECTION), MAX_SELECTION));
    const limits = [...new Set([1, 10, 50, 100, MAX_SELECTION, requestedLimit])].sort((left, right) => left - right);
    const scenarios = selectionMeasurementScenarios(db, options);
    const digestKey = randomBytes(32);
    const digest = (value) => createHmac("sha256", digestKey).update(String(value)).digest("hex");
    const selectionMeasurements = await measureSelectionScenarios(
      db,
      scenarios,
      limits,
      policyVersion,
      logbookModule.listEligibleMastheadPagesArtifactIds,
      eligibilityModule.resolveMaterializedMastheadPagesSelection,
      digest
    );
    const capsules = await measureCapsuleScenarios(
      db,
      databasePath,
      options,
      sessionArtifactModule.searchPublishedArtifactCapsules
    );
    const requestedMeasurement = selectionMeasurements.combined[String(requestedLimit)];
    const report = {
      generatedAt: new Date().toISOString(),
      databasePath: "[local database path omitted]",
      probeMode: "selection-comparison-consistent-read-snapshot; capsule-cold-runs-use-fresh-read-snapshots; replacement-comparison-requires-steady-state-eligibility",
      policyVersion,
      corpus: corpusDistribution(db),
      filters: {
        qPresent: Boolean(options.q),
        projectPresent: Boolean(options.project),
        dateFromPresent: Boolean(options.dateFrom),
        dateToPresent: Boolean(options.dateTo)
      },
      requestedLimit,
      measuredLimits: limits,
      scenarioCoverage: measureScenarioCoverage(db, scenarios),
      capsules,
      plans: measuredSelectionPlans(selectionMeasurements, requestedLimit),
      current: requestedMeasurement.current,
      replacement: requestedMeasurement.replacement,
      selectionMeasurements,
      diagnostics: eligibilityDiagnostics(db, policyVersion),
      structuralInvariants: structuralInvariants(scenarios.combined, policyVersion),
      visibleDelay: visibleDelayAssessment(selectionMeasurements, capsules, options)
    };
    if (options.outputPath) {
      await writeFile(resolve(options.outputPath), `${JSON.stringify(report, null, 2)}
`, { mode: 0o600 });
      await chmod(resolve(options.outputPath), 0o600);
    }
    return report;
  } finally {
    if (snapshotOpen) db.exec("ROLLBACK");
    db.close();
  }
}

function selectionMeasurementScenarios(db, options) {
  const representative = representativeTargetRow(db);
  const q = options.q || representative.searchText;
  const project = options.project || representative.project;
  const dateFrom = options.dateFrom || representative.publishedAt;
  const dateTo = options.dateTo;
  return {
    noFilter: {},
    search: { q },
    project: { project },
    date: { dateFrom, dateTo },
    combined: { q, project, dateFrom, dateTo }
  };
}

function representativeTargetRow(db) {
  const count = Number(db.prepare(
    `SELECT COUNT(*) AS count
     FROM session_artifacts
     WHERE artifact_kind = 'session_dossier'
       AND schema_version = 'canonical-session-dossier-v1'
       AND status = 'current'
       AND publication_status = 'published'
       AND published_at IS NOT NULL
       AND project_label IS NOT NULL
       AND trim(project_label) <> ''
       AND COALESCE(NULLIF(trim(title), ''), NULLIF(trim(summary), '')) IS NOT NULL`
  ).get().count);
  if (count === 0) {
    throw new Error("Probe requires at least one current published canonical dossier with project, text, and published_at");
  }
  const row = db.prepare(
    `SELECT project_label AS project,
            COALESCE(NULLIF(trim(title), ''), NULLIF(trim(summary), '')) AS searchText,
            published_at AS publishedAt
     FROM session_artifacts
     WHERE artifact_kind = 'session_dossier'
       AND schema_version = 'canonical-session-dossier-v1'
       AND status = 'current'
       AND publication_status = 'published'
       AND published_at IS NOT NULL
       AND project_label IS NOT NULL
       AND trim(project_label) <> ''
       AND COALESCE(NULLIF(trim(title), ''), NULLIF(trim(summary), '')) IS NOT NULL
     ORDER BY published_at, artifact_id
     LIMIT 1 OFFSET ?`
  ).get(Math.floor(count / 2));
  return { project: row.project, searchText: row.searchText, publishedAt: row.publishedAt };
}

function measureScenarioCoverage(db, scenarios) {
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM session_artifacts
     WHERE artifact_kind = 'session_dossier'
       AND schema_version = 'canonical-session-dossier-v1'
       AND status = 'current'
       AND publication_status = 'published'`
  ).get().count);
  return Object.fromEntries(Object.entries(scenarios).map(([name, query]) => {
    const built = buildArtifactQuery(query);
    const matching = Number(db.prepare(
      `SELECT COUNT(*) AS count ${built.from} WHERE ${built.predicates.join(" AND ")}`
    ).get(...built.params).count);
    return [name, {
      matching,
      total,
      selectivity: total === 0 ? null : matching / total,
      representative: name === "noFilter" ? matching === total && total > 0 : matching > 0 && matching < total
    }];
  }));
}

async function measureSelectionScenarios(
  db,
  scenarios,
  limits,
  policyVersion,
  legacyResolver,
  materializedResolver,
  digest
) {
  const measurements = {};
  for (const [scenarioName, query] of Object.entries(scenarios)) {
    const readiness = materializedReadiness(db, query, policyVersion);
    measurements[scenarioName] = {};
    for (const limit of limits) {
      const current = await measurePath(() => runCurrentPath(db, query, limit, legacyResolver, digest));
      const replacement = readiness.status === "ready"
        ? await measurePath(() =>
            runReplacementPath(db, query, limit, materializedResolver, digest, readiness)
          )
        : {
            ...notComparableReplacement(readiness.reason, readiness.sqlStatementCount),
            missingCurrentPolicyRows: readiness.missingCurrentPolicyRows,
            errorCurrentPolicyRows: readiness.errorCurrentPolicyRows
          };
      measurements[scenarioName][String(limit)] = {
        current,
        replacement,
        parity:
          current.status === "complete" && replacement.status === "complete"
            ? current.orderedResultDigests.length === replacement.orderedResultDigests.length &&
              current.orderedResultDigests.every((value, index) => value === replacement.orderedResultDigests[index])
            : null
      };
    }
  }
  return measurements;
}

function corpusDistribution(db) {
  const groups = db.prepare(
    `SELECT
       CASE
         WHEN json_valid(content_json) = 0 OR json_valid(evidence_refs_json) = 0 OR json_valid(validation_json) = 0 THEN 'invalid_or_corrupt'
         WHEN status = 'invalid' OR publication_status = 'invalidated' THEN 'invalid_or_corrupt'
         WHEN artifact_kind = 'session_dossier' AND schema_version = 'canonical-session-dossier-v1'
              AND status = 'current' AND publication_status = 'published' THEN 'current_published_supported'
         WHEN artifact_kind = 'session_dossier' AND schema_version <> 'canonical-session-dossier-v1' THEN 'legacy_schema'
         WHEN status = 'superseded' THEN 'superseded'
         ELSE 'other'
       END AS corpusClass,
       COUNT(*) AS count,
       SUM(length(CAST(content_json AS BLOB))) AS totalBodyBytes
     FROM session_artifacts
     GROUP BY corpusClass
     ORDER BY corpusClass`
  ).all();
  const bodyBytes = db.prepare(
    `SELECT length(CAST(content_json AS BLOB)) AS bytes
     FROM session_artifacts
     WHERE artifact_kind = 'session_dossier'
       AND schema_version = 'canonical-session-dossier-v1'
       AND status = 'current'
       AND publication_status = 'published'
     ORDER BY bytes`
  ).all().map((row) => Number(row.bytes));
  const provenance = db.prepare(
    `SELECT CASE WHEN count = 0 THEN 'zero' WHEN count = 1 THEN 'single' ELSE 'multi' END AS provenanceClass,
            COUNT(*) AS artifacts
     FROM (
       SELECT session_artifacts.artifact_id, COUNT(session_artifact_provenance.session_id) AS count
       FROM session_artifacts
       LEFT JOIN session_artifact_provenance
         ON session_artifact_provenance.artifact_id = session_artifacts.artifact_id
       WHERE session_artifacts.artifact_kind = 'session_dossier'
       GROUP BY session_artifacts.artifact_id
     )
     GROUP BY provenanceClass
     ORDER BY provenanceClass`
  ).all();
  const populations = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(artifact_kind = 'session_dossier') AS sessionDossiers,
            SUM(schema_version = 'canonical-session-dossier-v1') AS canonicalSchema,
            SUM(status = 'current') AS currentArtifacts,
            SUM(status = 'superseded') AS supersededArtifacts,
            SUM(publication_status = 'published') AS publishedArtifacts,
            SUM(json_valid(content_json) = 0 OR json_valid(evidence_refs_json) = 0 OR json_valid(validation_json) = 0)
              AS invalidOrCorruptArtifacts
     FROM session_artifacts`
  ).get();
  const groupCounts = new Map(groups.map((row) => [row.corpusClass, Number(row.count)]));
  const provenanceCounts = new Map(provenance.map((row) => [row.provenanceClass, Number(row.artifacts)]));
  const bodyByteSummary = {
    count: bodyBytes.length,
    total: bodyBytes.reduce((sum, value) => sum + value, 0),
    p50: percentile(bodyBytes, 0.5),
    p90: percentile(bodyBytes, 0.9),
    p95: percentile(bodyBytes, 0.95),
    p99: percentile(bodyBytes, 0.99),
    maximum: bodyBytes.at(-1) || 0
  };
  return {
    groups,
    populations,
    provenance,
    bodyBytes: bodyByteSummary,
    representativeCoverage: {
      currentPublishedSupported: (groupCounts.get("current_published_supported") || 0) > 0,
      legacySchema: (groupCounts.get("legacy_schema") || 0) > 0,
      superseded: (groupCounts.get("superseded") || 0) > 0,
      invalidOrCorrupt: (groupCounts.get("invalid_or_corrupt") || 0) > 0,
      singleProvenance: (provenanceCounts.get("single") || 0) > 0,
      multiProvenance: (provenanceCounts.get("multi") || 0) > 0,
      bodySizeSpread: bodyByteSummary.maximum > bodyByteSummary.p50
    }
  };
}

async function measurePath(run, coldRun = run, coldCacheState = "existing_snapshot") {
  const cold = await measureInvocation(coldRun);
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  const samplesMs = [];
  const heapDeltas = [];
  const sampledAllocatedBytes = [];
  const warmResultSummaries = [];
  let result = cold.result;
  const heapUsedSamples = [cold.heapBefore, cold.heapAfter];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    const sample = await measureInvocation(run);
    result = sample.result;
    samplesMs.push(sample.durationMs);
    heapDeltas.push(sample.heapDeltaBytes);
    sampledAllocatedBytes.push(sample.sampledAllocatedBytes);
    warmResultSummaries.push(summarizeInvocationResult(sample.result));
    heapUsedSamples.push(sample.heapAfter);
  }
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  delay.disable();
  const coldResult = summarizeInvocationResult(cold.result);
  const resultQueryPlans = explainInvocationPlans(result);
  const coldQueryPlans = explainInvocationPlans(cold.result);
  return {
    ...result,
    resultSource: "final_warm_sample",
    queryPlans: resultQueryPlans,
    coldResult: { ...coldResult, queryPlans: coldQueryPlans },
    coldWarmResultConsistent: warmResultSummaries.every(
      (summary) => JSON.stringify(summary) === JSON.stringify(coldResult)
    ),
    coldMs: cold.durationMs,
    coldHeapDeltaBytes: cold.heapDeltaBytes,
    coldSampledAllocatedBytes: cold.sampledAllocatedBytes,
    coldCacheState,
    peakHeapUsedBytes: Math.max(...heapUsedSamples),
    warm: {
      samplesMs,
      resultSummaries: warmResultSummaries,
      p50Ms: percentile(samplesMs, 0.5),
      p95Ms: percentile(samplesMs, 0.95),
      maximumMs: Math.max(...samplesMs),
      sampledAllocatedBytes,
      maximumSampledAllocatedBytes: Math.max(...sampledAllocatedBytes),
      maximumHeapDeltaBytes: Math.max(...heapDeltas),
      eventLoopDelayMaximumMs: Number(delay.max) / 1_000_000
    }
  };
}

function summarizeInvocationResult(result) {
  const orderedResultDigests = result.orderedResultDigests || [];
  return {
    status: result.status,
    reason: result.reason,
    total: result.total,
    capsuleCount: result.capsuleCount,
    candidateCount: result.candidateCount,
    consideredCount: result.consideredCount,
    orderedResultCount: orderedResultDigests.length,
    orderedResultSequenceDigest: orderedResultDigests.length > 0
      ? createHmac("sha256", "masthead-local-probe-result-summary-v1")
          .update(JSON.stringify(orderedResultDigests))
          .digest("hex")
      : null
  };
}

function explainInvocationPlans(result) {
  return result[QUERY_PLAN_FACTORY] ? result[QUERY_PLAN_FACTORY]() : [];
}

async function measureInvocation(run) {
  const session = new Session();
  session.connect();
  try {
    await inspectorPost(session, "HeapProfiler.startSampling", { samplingInterval: 1024 });
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const result = run();
    const durationMs = performance.now() - started;
    const heapAfter = process.memoryUsage().heapUsed;
    const { profile } = await inspectorPost(session, "HeapProfiler.stopSampling");
    return {
      result,
      durationMs,
      heapBefore,
      heapAfter,
      heapDeltaBytes: heapAfter - heapBefore,
      sampledAllocatedBytes: sampledAllocationBytes(profile.head)
    };
  } finally {
    session.disconnect();
  }
}

function inspectorPost(session, method, params = {}) {
  return new Promise((resolvePost, rejectPost) => {
    session.post(method, params, (error, result) => {
      if (error) rejectPost(error);
      else resolvePost(result || {});
    });
  });
}

function sampledAllocationBytes(node) {
  return Number(node.selfSize || 0) +
    (node.children || []).reduce((sum, child) => sum + sampledAllocationBytes(child), 0);
}

async function measureCapsuleScenarios(db, databasePath, options, searchPublishedArtifactCapsules) {
  const representative = representativeTargetRow(db);
  const scenarios = {
    noSearch: {},
    fts: { q: options.q || representative.searchText },
    project: { project: options.project || representative.project },
    date: { dateFrom: options.dateFrom || representative.publishedAt, dateTo: options.dateTo }
  };
  const measurements = {};
  for (const [scenarioName, query] of Object.entries(scenarios)) {
    measurements[scenarioName] = {};
    for (const requestedLimit of [1, 10, 50, 100, 500]) {
      const repositoryQuery = { ...query, kind: "session_dossier", limit: requestedLimit };
      const coldDb = new DatabaseSync(databasePath, { readOnly: true });
      coldDb.exec("BEGIN");
      try {
        // measurePath resolves the deferred cold EXPLAIN plans before returning; keep this connection
        // open until the complete measurement, including out-of-band plan collection, has finished.
        measurements[scenarioName][requestedLimit] = {
          requestedLimit,
          effectiveLimit: Math.min(requestedLimit, 100),
          measurement: await measurePath(
            () => runCapsulePath(db, repositoryQuery, searchPublishedArtifactCapsules),
            () => runCapsulePath(coldDb, repositoryQuery, searchPublishedArtifactCapsules),
            "fresh_sqlite_connection; os_page_cache_not_evicted"
          )
        };
      } finally {
        coldDb.exec("ROLLBACK");
        coldDb.close();
      }
    }
  }
  return measurements;
}

function runCapsulePath(db, query, searchPublishedArtifactCapsules) {
  const instrumented = instrumentDatabase(db, { captureExecutions: true });
  try {
    const result = withJsonParseCount(instrumented.metrics, () =>
      searchPublishedArtifactCapsules(instrumented.database, query)
    );
    return attachQueryPlanFactory({
      status: "complete",
      total: result.total,
      capsuleCount: result.artifacts.length,
      ...instrumented.metrics
    }, db, instrumented.executions);
  } catch {
    return attachQueryPlanFactory({
      status: "error",
      reason: instrumented.metrics.jsonParseFailures > 0
        ? "capsule_json_parse_failed"
        : "capsule_repository_failed",
      total: 0,
      capsuleCount: 0,
      ...instrumented.metrics
    }, db, instrumented.executions);
  }
}

function explainCapturedQueries(db, executions) {
  const unique = new Map();
  executions.forEach(({ sql, args }, executionIndex) => {
    if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) return;
    const existing = unique.get(sql);
    if (existing) {
      existing.executionCount += 1;
    } else {
      unique.set(sql, { sql, args, firstExecutionIndex: executionIndex, executionCount: 1 });
    }
  });
  return [...unique.values()].map(({ sql, args, firstExecutionIndex, executionCount }) => {
    try {
      return {
        firstExecutionIndex,
        executionCount,
        status: "complete",
        plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)
      };
    } catch {
      return { firstExecutionIndex, executionCount, status: "unavailable", plan: [] };
    }
  });
}

function attachQueryPlanFactory(result, db, executions) {
  Object.defineProperty(result, QUERY_PLAN_FACTORY, {
    value: () => explainCapturedQueries(db, executions)
  });
  return result;
}

function runCurrentPath(db, query, limit, legacyResolver, digest) {
  const instrumented = instrumentDatabase(db, { captureExecutions: true });
  try {
    const artifactIds = withJsonParseCount(instrumented.metrics, () =>
      legacyResolver(instrumented.database, query, limit)
    );
    return attachQueryPlanFactory({
      status: "complete",
      candidateCount: instrumented.metrics.statementRows[0] ?? artifactIds.length,
      consideredCount: instrumented.metrics.detailHydrations,
      ...instrumented.metrics,
      orderedResultDigests: artifactIds.map(digest)
    }, db, instrumented.executions);
  } catch {
    return attachQueryPlanFactory({
      status: "error",
      reason: instrumented.metrics.jsonParseFailures > 0
        ? "legacy_json_parse_failed"
        : "legacy_resolver_failed",
      candidateCount: instrumented.metrics.statementRows[0] ?? 0,
      consideredCount: instrumented.metrics.detailHydrations,
      ...instrumented.metrics,
      orderedResultDigests: []
    }, db, instrumented.executions);
  }
}

function materializedReadiness(db, query, policyVersion) {
  if (!tableExists(db, "masthead_pages_artifact_eligibility")) {
    return {
      status: "not_comparable",
      reason: "eligibility_table_missing",
      sqlStatementCount: 1,
      missingCurrentPolicyRows: null,
      errorCurrentPolicyRows: null,
      eligibleCandidateCount: null
    };
  }
  const built = buildArtifactQuery(query);
  const missing = Number(db.prepare(
    `SELECT COUNT(*) AS count
     ${built.from}
     LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ?
     WHERE ${built.predicates.join(" AND ")} AND eligibility.artifact_id IS NULL`
  ).get(policyVersion, ...built.params).count);
  const errors = Number(db.prepare(
    `SELECT COUNT(*) AS count
     ${built.from}
     JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ? AND eligibility.status = 'error'
     WHERE ${built.predicates.join(" AND ")}`
  ).get(policyVersion, ...built.params).count);
  const eligibleCandidateCount = Number(db.prepare(
    `SELECT COUNT(*) AS count
     ${built.from}
     JOIN masthead_pages_artifact_eligibility AS eligibility
       ON eligibility.artifact_id = session_artifacts.artifact_id
      AND eligibility.policy_version = ? AND eligibility.status = 'eligible'
     WHERE ${built.predicates.join(" AND ")}`
  ).get(policyVersion, ...built.params).count);
  return missing > 0 || errors > 0
    ? {
        status: "not_comparable",
        reason: "materialized_eligibility_not_steady_state",
        sqlStatementCount: 4,
        missingCurrentPolicyRows: missing,
        errorCurrentPolicyRows: errors,
        eligibleCandidateCount
      }
    : {
        status: "ready",
        sqlStatementCount: 4,
        missingCurrentPolicyRows: 0,
        errorCurrentPolicyRows: 0,
        eligibleCandidateCount
      };
}

function runReplacementPath(db, query, limit, materializedResolver, digest, readiness) {
  const instrumented = instrumentDatabase(db, { captureExecutions: true });
  try {
    const result = withJsonParseCount(instrumented.metrics, () =>
      materializedResolver(instrumented.database, query, limit)
    );
    const { artifactIds, ...selectionResult } = result;
    return attachQueryPlanFactory({
      ...selectionResult,
      candidateCount: readiness.eligibleCandidateCount,
      consideredCount: readiness.eligibleCandidateCount,
      ...instrumented.metrics,
      readinessSqlStatementCount: readiness.sqlStatementCount,
      missingCurrentPolicyRows: readiness.missingCurrentPolicyRows,
      errorCurrentPolicyRows: readiness.errorCurrentPolicyRows,
      orderedResultDigests: artifactIds.map(digest)
    }, db, instrumented.executions);
  } catch {
    return attachQueryPlanFactory({
      status: "error",
      reason: instrumented.metrics.jsonParseFailures > 0
        ? "materialized_json_parse_failed"
        : "materialized_resolver_failed",
      candidateCount: readiness.eligibleCandidateCount,
      consideredCount: readiness.eligibleCandidateCount,
      ...instrumented.metrics,
      readinessSqlStatementCount: readiness.sqlStatementCount,
      missingCurrentPolicyRows: readiness.missingCurrentPolicyRows,
      errorCurrentPolicyRows: readiness.errorCurrentPolicyRows,
      orderedResultDigests: []
    }, db, instrumented.executions);
  }
}

function notComparableReplacement(reason, readinessSqlStatementCount) {
  return {
    status: "not_comparable",
    reason,
    candidateCount: 0,
    consideredCount: 0,
    detailHydrations: 0,
    jsonParses: 0,
    provenanceQueries: 0,
    selectedBytes: 0,
    selectedBodyBytes: 0,
    sqlDurationMs: 0,
    sqlStatementCount: 0,
    readinessSqlStatementCount,
    statementRows: [],
    bodyColumnsSelected: false,
    orderedResultDigests: []
  };
}

function instrumentDatabase(db, options = {}) {
  const metrics = {
    sqlStatementCount: 0,
    sqlDurationMs: 0,
    selectedBytes: 0,
    selectedBodyBytes: 0,
    detailHydrations: 0,
    jsonParses: 0,
    jsonParseFailures: 0,
    provenanceQueries: 0,
    bodyColumnsSelected: false,
    statementRows: []
  };
  const executions = [];
  const database = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => instrumentStatement(
          target.prepare(sql),
          String(sql),
          metrics,
          options.captureExecutions ? executions : null
        );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { database, metrics, executions };
}

function instrumentStatement(statement, sql, metrics, executions) {
  return new Proxy(statement, {
    get(target, property) {
      if (property === "all" || property === "get" || property === "run") {
        return (...args) => {
          metrics.sqlStatementCount += 1;
          if (executions) executions.push({ sql, args });
          const started = performance.now();
          let result;
          try {
            result = target[property](...args);
          } catch (error) {
            metrics.sqlDurationMs += performance.now() - started;
            throw error;
          }
          metrics.sqlDurationMs += performance.now() - started;
          const rows = Array.isArray(result)
            ? result
            : result && typeof result === "object" && !("changes" in result)
              ? [result]
              : [];
          metrics.statementRows.push(rows.length);
          metrics.selectedBytes += rows.reduce((sum, row) => sum + resultRowBytes(row), 0);
          if (/\b(content_json|evidence_refs_json|validation_json)\b/u.test(sql)) {
            metrics.bodyColumnsSelected = true;
            metrics.detailHydrations += rows.length;
            metrics.selectedBodyBytes += rows.reduce(
              (sum, row) =>
                sum +
                resultValueBytes(row.contentJson) +
                resultValueBytes(row.evidenceRefsJson) +
                resultValueBytes(row.validationJson),
              0
            );
          }
          if (/\bFROM session_artifact_provenance\b/u.test(sql)) metrics.provenanceQueries += 1;
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

function withJsonParseCount(metrics, action) {
  const originalParse = JSON.parse;
  JSON.parse = (...args) => {
    metrics.jsonParses += 1;
    try {
      return originalParse(...args);
    } catch (error) {
      metrics.jsonParseFailures += 1;
      throw error;
    }
  };
  try {
    return action();
  } finally {
    JSON.parse = originalParse;
  }
}

function resultRowBytes(row) {
  return Object.values(row).reduce((sum, value) => sum + resultValueBytes(value), 0);
}

function resultValueBytes(value) {
  return value === null || value === undefined ? 0 : Buffer.byteLength(String(value));
}

function measuredSelectionPlans(selectionMeasurements, requestedLimit) {
  return Object.fromEntries(Object.entries(selectionMeasurements).map(([scenario, limits]) => {
    const measurement = limits[String(requestedLimit)];
    return [scenario, {
      current: measurement.current.queryPlans || [],
      replacement: measurement.replacement.queryPlans || []
    }];
  }));
}

function eligibilityDiagnostics(db, policyVersion) {
  if (!tableExists(db, "masthead_pages_artifact_eligibility")) return { tablePresent: false };
  const scalar = (sql, ...params) => Number(db.prepare(sql).get(...params).count);
  return {
    tablePresent: true,
    reasonDistribution: db.prepare(
      `SELECT COALESCE(reason_code, 'eligible') AS reasonCode, COUNT(*) AS count
       FROM masthead_pages_artifact_eligibility
       WHERE policy_version = ?
       GROUP BY reasonCode
       ORDER BY reasonCode`
    ).all(policyVersion),
    missing: scalar(
      `SELECT COUNT(*) AS count FROM session_artifacts
       LEFT JOIN masthead_pages_artifact_eligibility AS eligibility
         ON eligibility.artifact_id = session_artifacts.artifact_id AND eligibility.policy_version = ?
       WHERE session_artifacts.status = 'current' AND session_artifacts.publication_status = 'published'
         AND session_artifacts.artifact_kind = 'session_dossier'
         AND session_artifacts.schema_version = 'canonical-session-dossier-v1'
         AND eligibility.artifact_id IS NULL`,
      policyVersion
    ),
    duplicate: scalar(
      `SELECT COUNT(*) AS count FROM (
         SELECT artifact_id, policy_version FROM masthead_pages_artifact_eligibility
         GROUP BY artifact_id, policy_version HAVING COUNT(*) > 1
       )`
    ),
    impossible: scalar(
      `SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility
       WHERE (status = 'eligible' AND reason_code IS NOT NULL)
          OR (status <> 'eligible' AND reason_code IS NULL)`
    ),
    stalePolicy: scalar(
      `SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility WHERE policy_version <> ?`,
      policyVersion
    ),
    orphaned: scalar(
      `SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility AS eligibility
       LEFT JOIN session_artifacts ON session_artifacts.artifact_id = eligibility.artifact_id
       WHERE session_artifacts.artifact_id IS NULL`
    ),
    error: scalar(
      `SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility
       WHERE policy_version = ? AND status = 'error'`,
      policyVersion
    )
  };
}

function visibleDelayAssessment(selectionMeasurements, capsules, options) {
  const selectionPaths = Object.values(selectionMeasurements).flatMap((scenario) =>
    Object.values(scenario)
      .flatMap(({ current, replacement }) => [current, replacement])
      .filter((measurement) => Number.isFinite(measurement.coldMs) && measurement.warm)
  );
  const capsuleMeasurements = Object.values(capsules).flatMap((scenario) =>
    Object.values(scenario).map(({ measurement }) => measurement)
  );
  const observedMaximumMs = Math.max(
    ...selectionPaths.flatMap((measurement) => [measurement.coldMs, measurement.warm.maximumMs]),
    ...capsuleMeasurements.flatMap((measurement) => [
      measurement.coldMs,
      measurement.warm.maximumMs
    ])
  );
  const classify = (threshold) =>
    Number.isFinite(threshold) && threshold > 0 ? observedMaximumMs >= threshold : null;
  return {
    observedMaximumMs,
    humanVisibleDelayThresholdMs: options.humanVisibleMs ?? null,
    humanVisibleDelayReproduced: classify(options.humanVisibleMs),
    agentVisibleDelayThresholdMs: options.agentVisibleMs ?? null,
    agentVisibleDelayReproduced: classify(options.agentVisibleMs),
    limitation:
      options.humanVisibleMs || options.agentVisibleMs
        ? undefined
        : "No owner-approved absolute human-visible or agent-visible delay threshold was supplied. Raw latency is reported without inventing one."
  };
}

function structuralInvariants(query, policyVersion) {
  const built = buildArtifactQuery(query);
  const replacementSql = `SELECT session_artifacts.artifact_id ${built.from}
    JOIN masthead_pages_artifact_eligibility AS eligibility
      ON eligibility.artifact_id = session_artifacts.artifact_id
     AND eligibility.policy_version = '${policyVersion}' AND eligibility.status = 'eligible'
    WHERE ${built.predicates.join(" AND ")} ORDER BY ${built.ordering} LIMIT ?`;
  return {
    bodyColumnsSelected: /content_json|evidence_refs_json|validation_json/u.test(replacementSql),
    detailHydrationPresent: /getLogbookArtifactDetail/u.test(replacementSql),
    jsonParsePresent: /JSON\.parse/u.test(replacementSql),
    provenanceReadPresent: /session_artifact_provenance/u.test(replacementSql),
    exactCurrentPolicy: replacementSql.includes(`policy_version = '${policyVersion}'`),
    liveAdmission:
      replacementSql.includes("status = 'current'") &&
      replacementSql.includes("publication_status = 'published'"),
    directFtsTableOperand:
      !query.q ||
      (replacementSql.includes("session_artifact_search MATCH") &&
        replacementSql.includes("bm25(session_artifact_search")),
    outputCap: MAX_SELECTION
  };
}

function buildArtifactQuery(query) {
  const predicates = [
    "session_artifacts.publication_status = 'published'",
    "session_artifacts.status = 'current'",
    "session_artifacts.artifact_kind = 'session_dossier'",
    "session_artifacts.schema_version = 'canonical-session-dossier-v1'"
  ];
  const params = [];
  let from = "FROM session_artifacts";
  let ordering = "session_artifacts.published_at DESC, session_artifacts.updated_at DESC, session_artifacts.artifact_id DESC";
  if (query.project) {
    predicates.push("session_artifacts.project_label = ?");
    params.push(query.project);
  }
  if (query.q) {
    from += " JOIN session_artifact_search ON session_artifact_search.artifact_id = session_artifacts.artifact_id";
    predicates.push("session_artifact_search MATCH ?");
    params.push(sanitizeSearchQuery(query.q));
    ordering = `bm25(session_artifact_search, ${FTS_WEIGHTS}) ASC, ${ordering}`;
  }
  if (query.dateFrom) {
    predicates.push("session_artifacts.published_at >= ?");
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    predicates.push("session_artifacts.published_at <= ?");
    params.push(query.dateTo);
  }
  return { from, predicates, params, ordering };
}

function sanitizeSearchQuery(value) {
  const tokens = value.replace(/["']/g, " ").split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !/^(AND|OR|NOT)$/i.test(token))
    .map((token) => `"${token.replace(/"/g, "")}"`);
  return tokens.length > 0 ? tokens.join(" ") : '""';
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

async function importBuiltModule(relativePath) {
  return import(pathToFileURL(resolve("dist/daemon", relativePath)).href);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--db") options.databasePath = argv[++index];
    else if (argument === "--output") options.outputPath = argv[++index];
    else if (argument === "--q") options.q = argv[++index];
    else if (argument === "--project") options.project = argv[++index];
    else if (argument === "--date-from") options.dateFrom = argv[++index];
    else if (argument === "--date-to") options.dateTo = argv[++index];
    else if (argument === "--limit") options.limit = Number(argv[++index]);
    else if (argument === "--human-visible-ms") options.humanVisibleMs = Number(argv[++index]);
    else if (argument === "--agent-visible-ms") options.agentVisibleMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm run probe:local-data-foundation -- --db <masthead.sqlite> [--q term] [--project name] [--date-from ISO] [--date-to ISO] [--limit 1..500] [--human-visible-ms number] [--agent-visible-ms number] [--output report.json]");
  } else {
    runLocalDataFoundationProbe(options)
      .then((report) => console.log(JSON.stringify(report, null, 2)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
