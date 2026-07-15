#!/usr/bin/env node

import { access, lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { grokAdapter } from "../src/adapters/grok/adapter.ts";
import { hermesAdapter } from "../src/adapters/hermes/adapter.ts";
import { createImportJob } from "../src/daemon/db/importJobRepository.ts";
import { listAllImportWorkUnits } from "../src/daemon/db/importLedgerRepository.ts";
import { migrateDatabase } from "../src/daemon/db/schema.ts";
import { setSourcePolicy } from "../src/daemon/db/sourcePolicyRepository.ts";
import { openMastheadDatabase } from "../src/daemon/db/sqlite.ts";
import { buildImportCompletionReport, settleImportSessionClassifications } from "../src/daemon/import/importCompletionReport.ts";
import { createManifestForJob } from "../src/daemon/import/importManifestService.ts";
import { previewImportRepair } from "../src/daemon/import/importRepair.ts";
import { runImportWorkUnit } from "../src/daemon/import/importWorkUnitRunner.ts";
import { reconcileImportedTranscript } from "../src/workbench/transcriptQualityReconciler.ts";

const GENERATED_AT = "2026-07-15T12:00:00.000Z";
const RECENT_SCOPE = { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };

export async function replayImportTrustCorpus(input) {
  const sourceRoot = await validatedCorpusRoot(input?.sourceRoot);
  const databasePath = await validateImportTrustDatabasePath(input?.databasePath);
  const runtimes = [
    {
      adapter: grokAdapter,
      runtime: "grok",
      sources: [{
        confidence: "authoritative",
        path: join(sourceRoot, "grok", "019f42f6-8ada-7001-afff-c722e75faf45", "chat_history.jsonl"),
        runtime: "grok",
        schemaVersion: "grok-jsonl-tree",
        sourceId: "acceptance:grok",
        sourceKind: "jsonl"
      }]
    },
    {
      adapter: hermesAdapter,
      runtime: "hermes",
      sources: [{
        confidence: "authoritative",
        path: join(sourceRoot, "hermes", "session.jsonl"),
        runtime: "hermes",
        schemaVersion: "hermes-transcript-jsonl",
        sourceId: "acceptance:hermes",
        sourceKind: "jsonl",
        sourceSessionId: "20260710_100000_fixture"
      }, {
        confidence: "authoritative",
        path: join(sourceRoot, "hermes", "old-session.jsonl"),
        runtime: "hermes",
        schemaVersion: "hermes-transcript-jsonl",
        sourceId: "acceptance:hermes",
        sourceKind: "jsonl",
        sourceSessionId: "20260501_100000_old_fixture"
      }]
    }
  ];

  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    const importReports = [];
    const importJobIds = [];
    for (const [index, entry] of runtimes.entries()) {
      await Promise.all(entry.sources.map((source) => access(source.path)));
      const updatedAt = new Date(Date.parse(GENERATED_AT) + index * 1_000).toISOString();
      const sourceId = entry.sources[0].sourceId;
      registerSanitizedSource(db, entry.sources[0], updatedAt);
      const job = createImportJob(db, { importKind: "transcript", sourceId, updatedAt });
      importJobIds.push(job.importJobId);
      setSourcePolicy(db, {
        decidedAt: updatedAt,
        enabled: true,
        policyKind: "transcript_import",
        reason: "sanitized isolated acceptance replay",
        sourceId
      });
      const transcriptUnits = (await Promise.all(
        entry.sources.map((source) => entry.adapter.planTranscriptUnits(source))
      )).flat();
      const manifest = await createManifestForJob(db, {
        generatedAt: GENERATED_AT,
        importJobId: job.importJobId,
        importKind: "transcript",
        runtime: entry.runtime,
        scope: RECENT_SCOPE,
        sourceId,
        sources: entry.sources,
        transcriptUnits
      });

      for (const unit of manifest.units) {
        await runImportWorkUnit({
          approvedSourceIds: [sourceId],
          db,
          hostId: "host:isolated-import-trust-acceptance",
          hostname: "isolated-import-trust-acceptance",
          now: () => GENERATED_AT,
          onSessionHydrated: (sessionId) => reconcileImportedTranscript(db, sessionId, { finalizeNoise: false }),
          parseTranscriptUnit: async (fallbackPlan, cursor) => {
            const planned = transcriptUnits.find((candidate) =>
              candidate.source.path === fallbackPlan.source.path ||
              Boolean(fallbackPlan.sourceSessionId && candidate.sourceSessionId === fallbackPlan.sourceSessionId)
            );
            return entry.adapter.parseTranscriptUnit(planned ?? fallbackPlan, cursor);
          },
          runtimeKind: entry.runtime,
          workUnitId: unit.workUnitId
        });
      }

      const reportInput = completionInput(db, job.importJobId, entry.runtime);
      const preliminary = buildImportCompletionReport(db, reportInput);
      settleImportSessionClassifications(db, {
        anomalies: preliminary.anomalies,
        finalizeNoise: true,
        importJobId: job.importJobId
      });
      importReports.push(buildImportCompletionReport(db, reportInput));
    }

    const repairPreview = previewImportRepair(db, {
      importJobIds,
      sourceMappings: runtimes.map((entry) => ({
        adapterRuntime: entry.runtime,
        available: true,
        correctedSourceId: entry.sources[0].sourceId,
        sourceId: entry.sources[0].sourceId
      }))
    });
    return {
      productionAccessed: false,
      databasePath,
      perRuntime: runtimeCounts(db),
      importReports,
      workbenchCounts: workbenchCounts(db),
      anomalies: importReports.flatMap((report) => report.anomalies),
      repairPreview,
      scopeEvidence: scopeEvidence(db, importJobIds, importReports)
    };
  } finally {
    db.close();
  }
}

function registerSanitizedSource(db, source, discoveredAt) {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, schema_version, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    source.sourceId,
    source.runtime,
    source.sourceKind,
    source.path,
    source.schemaVersion,
    source.confidence,
    discoveredAt,
    discoveredAt
  );
}

function completionInput(db, importJobId, runtime) {
  const units = listAllImportWorkUnits(db, { importJobId });
  const recordsImported = units.reduce((total, unit) => total + unit.importedRecords, 0);
  const recordsFailed = units.reduce((total, unit) => total + unit.failedRecords, 0);
  const failedUnits = units.filter((unit) => unit.status === "failed").length;
  const skippedUnits = units.filter((unit) => unit.status === "skipped").length;
  return {
    failedUnits,
    generatedAt: GENERATED_AT,
    importJobId,
    recordsFailed,
    recordsImported,
    recordsSkipped: skippedUnits,
    runtime,
    skippedUnits,
    sourceUnitsDiscovered: units.length,
    sourceUnitsHydrated: units.filter((unit) => ["succeeded", "succeeded_with_issues"].includes(unit.status)).length,
    sourceUnitsRemaining: units.filter((unit) => ["queued", "running"].includes(unit.status)).length,
    status: failedUnits > 0 || recordsFailed > 0 ? "succeeded_with_issues" : "succeeded",
    transcriptsImported: recordsImported
  };
}

function runtimeCounts(db) {
  const rows = db.prepare(
    `SELECT runtimes.runtime_kind AS runtime,
      COUNT(DISTINCT sessions.session_id) AS sessions,
      COUNT(DISTINCT tool_calls.tool_call_id) AS structuredToolCalls,
      COUNT(DISTINCT tool_results.tool_result_id) AS structuredToolResults
    FROM sessions
    JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
    LEFT JOIN tool_calls ON tool_calls.session_id = sessions.session_id
    LEFT JOIN tool_results ON tool_results.session_id = sessions.session_id
    WHERE runtimes.runtime_kind IN ('grok', 'hermes')
      AND sessions.deleted_at IS NULL
    GROUP BY runtimes.runtime_kind`
  ).all();
  return Object.fromEntries(rows.map((row) => [row.runtime, {
    evidence: runtimeEvidence(db, row.runtime),
    sessions: Number(row.sessions),
    sourceSessionIds: db.prepare(
      `SELECT source_session_id AS sourceSessionId FROM sessions
       JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
       WHERE runtimes.runtime_kind = ? AND sessions.deleted_at IS NULL
       ORDER BY source_session_id`
    ).all(row.runtime).map((session) => session.sourceSessionId),
    structuredToolCalls: Number(row.structuredToolCalls),
    structuredToolResults: Number(row.structuredToolResults),
    reasoningFragmentPseudoSessions: Number(db.prepare(
      `SELECT COUNT(*) AS count FROM sessions
       JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
       WHERE runtimes.runtime_kind = ? AND sessions.source_session_id LIKE 'rs\\_%' ESCAPE '\\'`
    ).get(row.runtime)?.count ?? 0)
  }]));
}

function runtimeEvidence(db, runtime) {
  const roleRows = db.prepare(
    `SELECT messages.role, COUNT(*) AS count FROM messages
     JOIN sessions ON sessions.session_id = messages.session_id
     JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
     WHERE runtimes.runtime_kind = ? AND sessions.deleted_at IS NULL
     GROUP BY messages.role ORDER BY messages.role`
  ).all(runtime);
  const count = (table, predicate = "1 = 1") => Number(db.prepare(
    `SELECT COUNT(*) AS count FROM ${table}
     JOIN sessions ON sessions.session_id = ${table}.session_id
     JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
     WHERE runtimes.runtime_kind = ? AND sessions.deleted_at IS NULL AND ${predicate}`
  ).get(runtime)?.count ?? 0);
  return {
    messagesByRole: Object.fromEntries(roleRows.map((row) => [row.role, Number(row.count)])),
    reasoningCheckpoints: count("checkpoints", "checkpoints.checkpoint_kind = 'reasoning'"),
    toolCalls: count("tool_calls"),
    toolResults: count("tool_results")
  };
}

function workbenchCounts(db) {
  const rows = db.prepare(
    `SELECT publication_status AS publicationStatus, non_publication_reason AS nonPublicationReason, COUNT(*) AS count
     FROM workbench_session_state
     GROUP BY publication_status, non_publication_reason`
  ).all();
  return {
    importRepair: Number(db.prepare("SELECT COUNT(DISTINCT session_id) AS count FROM session_import_health WHERE status = 'repair_required'").get()?.count ?? 0),
    importFailuresClassifiedAsNotAdded: Number(db.prepare(
      `SELECT COUNT(DISTINCT health.session_id) AS count
       FROM session_import_health health
       JOIN workbench_session_state state ON state.session_id = health.session_id
       WHERE health.status <> 'complete' AND state.publication_status = 'not_added_to_logbook'`
    ).get()?.count ?? 0),
    notAdded: rows.filter((row) => row.publicationStatus === "not_added_to_logbook").reduce((total, row) => total + Number(row.count), 0),
    notAddedReasons: rows
      .filter((row) => row.publicationStatus === "not_added_to_logbook" && row.nonPublicationReason)
      .map((row) => ({ count: Number(row.count), reason: row.nonPublicationReason })),
    packagePath: rows.filter((row) => row.publicationStatus === "publish_path").reduce((total, row) => total + Number(row.count), 0)
  };
}

function scopeEvidence(db, importJobIds, importReports) {
  const units = importJobIds.flatMap((importJobId) => listAllImportWorkUnits(db, { importJobId }));
  const oldUnit = units.find((unit) => unit.sourceSessionId === "20260501_100000_old_fixture");
  return {
    currentUnitsAdmitted: units.filter((unit) =>
      unit.scopeReason === "inside_recent_range" && ["succeeded", "succeeded_with_issues"].includes(unit.status)
    ).length,
    oldSemanticUnit: {
      canonicalSessions: Number(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE source_session_id = ?").get(
        "20260501_100000_old_fixture"
      )?.count ?? 0),
      scopeReason: oldUnit?.scopeReason,
      status: oldUnit?.status,
      timestampBasis: oldUnit?.timestampBasis
    },
    recentScope: RECENT_SCOPE,
    reportDeferredUnits: importReports.reduce((total, report) => total + report.sourceUnitsDeferred, 0)
  };
}

async function validatedCorpusRoot(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("A sanitized corpus is required via --source-root.");
  const requestedRoot = resolve(value);
  let root;
  try {
    root = await realpath(requestedRoot);
    if (productionLike(requestedRoot) || productionLike(root)) {
      throw new Error("The sanitized corpus path must not reference production data.");
    }
    await Promise.all([
      access(join(root, "grok", "019f42f6-8ada-7001-afff-c722e75faf45", "chat_history.jsonl")),
      access(join(root, "hermes", "session.jsonl")),
      access(join(root, "hermes", "old-session.jsonl"))
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not reference production")) throw error;
    throw new Error("The sanitized corpus must contain the expected Grok and Hermes acceptance fixtures.");
  }
  return root;
}

export async function validateImportTrustDatabasePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("A safe isolated database path is required via --database.");
  const requestedPath = resolve(value);
  const temporaryRoot = await realpath("/tmp");
  let databasePath;
  try {
    databasePath = join(await realpath(dirname(requestedPath)), basename(requestedPath));
  } catch {
    throw new Error("A safe isolated database path requires an existing parent directory under /tmp.");
  }
  const rel = relative(temporaryRoot, databasePath);
  if (
    !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ||
    productionLike(requestedPath) || productionLike(databasePath)
  ) {
    throw new Error("A safe isolated database path must be under /tmp and must not be production-like.");
  }
  let leaf;
  try {
    leaf = await lstat(requestedPath);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
      throw new Error("A safe isolated database path could not be inspected.");
    }
  }
  if (leaf?.isSymbolicLink()) {
    throw new Error("A safe isolated database path must not be a symlink.");
  }
  if (leaf) {
    const existingPath = await realpath(requestedPath);
    const existingRelative = relative(temporaryRoot, existingPath);
    if (
      !existingRelative || existingRelative === ".." || existingRelative.startsWith(`..${sep}`) ||
      isAbsolute(existingRelative) || productionLike(existingPath)
    ) {
      throw new Error("A safe isolated database path must be under /tmp and must not be production-like.");
    }
    throw new Error("A safe isolated database path must not already exist.");
  }
  return databasePath;
}

function productionLike(path) {
  return path.toLowerCase().includes("masthead-production");
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source-root") values.sourceRoot = args[++index];
    else if (args[index] === "--database") values.databasePath = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return values;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await replayImportTrustCorpus(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
