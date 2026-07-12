#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) {
  console.error("Usage: node scripts/rebuild-production-database.mjs SOURCE DESTINATION");
  process.exit(2);
}

const sourcePath = resolve(sourceArg);
const destinationPath = resolve(destinationArg);
if (!existsSync(sourcePath)) throw new Error(`Source database does not exist: ${sourcePath}`);
if (existsSync(destinationPath)) throw new Error(`Destination already exists: ${destinationPath}`);

const db = new DatabaseSync(destinationPath);
try {
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = OFF;");
  db.prepare("ATTACH DATABASE ? AS source").run(sourcePath);

  const schema = db.prepare(
    `SELECT type, name, tbl_name AS tableName, sql
     FROM source.sqlite_master
     WHERE sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, name`
  ).all();
  const virtualTables = new Set(
    schema.filter((row) => row.type === "table" && /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(row.sql))).map((row) => String(row.name))
  );
  const shadowPrefixes = [...virtualTables].map((name) => `${name}_`);
  const isShadow = (name) => shadowPrefixes.some((prefix) => name.startsWith(prefix));

  for (const row of schema.filter((candidate) => candidate.type === "table" && !isShadow(String(candidate.name)))) {
    db.exec(String(row.sql));
  }

  const tableReports = [];
  const normalizedInterruptedUnits = [];
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of schema.filter((candidate) => candidate.type === "table" && !isShadow(String(candidate.name)))) {
      const table = String(row.name);
      const columns = db.prepare(`PRAGMA main.table_info(${quoteIdentifier(table)})`).all().map((column) => String(column.name));
      if (columns.length === 0) continue;
      const columnSql = columns.map(quoteIdentifier).join(", ");
      if (table === "source_setup_state") {
        // This table is a derived Sources cache. Copying even one row can force a full scan of a
        // severely bloated source table, and GET /sources/setup now rebuilds it without persistence.
      } else {
        db.exec(
          `INSERT INTO main.${quoteIdentifier(table)} (${columnSql})
           SELECT ${columnSql} FROM source.${quoteIdentifier(table)}`
        );
      }
      const sourceCount = table === "source_setup_state"
        ? 0
        : countRows(db, "source", table);
      const destinationCount = countRows(db, "main", table);
      const expectedCount = sourceCount;
      if (destinationCount !== expectedCount) {
        throw new Error(`${table}: expected ${expectedCount} rows, copied ${destinationCount}`);
      }
      tableReports.push({ destinationCount, sourceCount, table });
    }

    const interruptedWithoutCursor = db.prepare(
      `SELECT unit.work_unit_id AS workUnitId,
        unit.import_job_id AS importJobId,
        unit.source_id AS sourceId,
        unit.processed_records AS processedRecords,
        unit.imported_records AS importedRecords,
        unit.failed_records AS failedRecords
       FROM main.import_work_units unit
       JOIN main.import_jobs job ON job.import_job_id = unit.import_job_id
       LEFT JOIN main.ingest_cursors cursor
         ON cursor.source_id = unit.source_id
        AND cursor.source_path IS unit.source_path
       WHERE job.status IN ('queued', 'running', 'cancelling')
         AND unit.status IN ('queued', 'running', 'failed')
         AND unit.processed_records > 0
         AND unit.cursor_after_json IS NULL
         AND COALESCE(cursor.byte_offset, 0) = 0`
    ).all();
    const normalizedJobIds = new Set();
    for (const unit of interruptedWithoutCursor) {
      normalizedInterruptedUnits.push(unit);
      normalizedJobIds.add(String(unit.importJobId));
      db.prepare("DELETE FROM main.import_session_impacts WHERE import_job_id = ? AND source_id = ?")
        .run(unit.importJobId, unit.sourceId);
      db.prepare(
        `UPDATE main.import_work_units
         SET status = 'queued',
           status_reason = 'Restarting interrupted unit from the beginning after cursor repair.',
           processed_records = 0,
           imported_records = 0,
           skipped_records = 0,
           failed_records = 0,
           heartbeat_at = NULL,
           started_at = NULL,
           finished_at = NULL,
           failure_group_id = NULL,
           cursor_after_json = NULL
         WHERE work_unit_id = ?`
      ).run(unit.workUnitId);
    }
    const repairedAt = new Date().toISOString();
    for (const importJobId of normalizedJobIds) {
      db.prepare(
        `UPDATE main.import_jobs
         SET status = 'queued',
           processed_count = COALESCE((SELECT SUM(processed_records) FROM main.import_work_units WHERE import_job_id = ?), 0),
           imported_count = COALESCE((SELECT SUM(imported_records) FROM main.import_work_units WHERE import_job_id = ?), 0),
           failure_count = COALESCE((SELECT SUM(failed_records) FROM main.import_work_units WHERE import_job_id = ?), 0),
           completed_work_units = (SELECT COUNT(*) FROM main.import_work_units WHERE import_job_id = ? AND status IN ('succeeded', 'succeeded_with_issues')),
           failed_work_units = (SELECT COUNT(*) FROM main.import_work_units WHERE import_job_id = ? AND status = 'failed'),
           skipped_work_units = (SELECT COUNT(*) FROM main.import_work_units WHERE import_job_id = ? AND status = 'skipped'),
           current_path = NULL,
           failure_message = NULL,
           heartbeat_at = ?,
           updated_at = ?
         WHERE import_job_id = ?`
      ).run(importJobId, importJobId, importJobId, importJobId, importJobId, importJobId, repairedAt, repairedAt, importJobId);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  for (const row of schema.filter((candidate) => candidate.type !== "table")) {
    db.exec(String(row.sql));
  }

  const foreignKeyFailures = db.prepare("PRAGMA main.foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`Foreign key check failed: ${JSON.stringify(foreignKeyFailures.slice(0, 10))}`);
  for (const table of virtualTables) {
    db.prepare(`INSERT INTO ${quoteIdentifier(table)}(${quoteIdentifier(table)}) VALUES ('integrity-check')`).run();
  }
  const quickCheck = db.prepare("PRAGMA main.quick_check").all().flatMap((row) => Object.values(row));
  if (quickCheck.some((value) => value !== "ok")) throw new Error(`Quick check failed: ${quickCheck.join("; ")}`);
  db.exec("DETACH DATABASE source; PRAGMA foreign_keys = ON; PRAGMA optimize;");

  console.log(JSON.stringify({
    destinationBytes: statSync(destinationPath).size,
    destinationPath,
    sourceBytes: statSync(sourcePath).size,
    sourcePath,
    tables: tableReports,
    normalizedInterruptedUnits
  }, null, 2));
} finally {
  db.close();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function countRows(db, schema, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`).get().count);
}
