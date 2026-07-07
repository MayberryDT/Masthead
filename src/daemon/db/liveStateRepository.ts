import type { RuntimeKind } from "../../adapters/types.ts";
import { liveStateKey, type LiveStateReport, reportIsFresh } from "../../core/liveState.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type UpsertLiveStateResult =
  | { status: "accepted"; report: LiveStateReport }
  | { status: "ignored_stale"; report: LiveStateReport; previous: LiveStateReport }
  | { status: "ignored_expired"; report: LiveStateReport };

type LiveStateRow = {
  report_id: string;
  runtime: RuntimeKind;
  source: string;
  source_session_id: string | null;
  canonical_session_id: string | null;
  source_event_id: string | null;
  state: LiveStateReport["state"];
  authority: LiveStateReport["authority"];
  message: string | null;
  custom_status: string | null;
  seq: number | null;
  observed_at: string;
  expires_at: string | null;
  cwd: string | null;
  repo_root: string | null;
  branch: string | null;
  pid: number | null;
  process_name: string | null;
  session_ref_kind: "id" | "path" | null;
  session_ref_value: string | null;
  payload_json: string | null;
};

export function upsertLiveStateReport(
  db: MastheadDatabase,
  report: LiveStateReport,
  options: { now?: Date } = {}
): UpsertLiveStateResult {
  const now = options.now ?? new Date();
  if (!reportIsFresh(report, now)) return { status: "ignored_expired", report };

  const previous = previousReportForKey(db, report);
  if (previous && isStale(report, previous)) {
    return { status: "ignored_stale", report, previous };
  }

  db.prepare(
    `INSERT INTO live_state_reports (
      report_id, runtime, source, source_session_id, canonical_session_id, source_event_id,
      state, authority, message, custom_status, seq, observed_at, expires_at,
      cwd, repo_root, branch, pid, process_name, session_ref_kind, session_ref_value,
      payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(report_id) DO NOTHING`
  ).run(
    report.reportId,
    report.runtime,
    report.source,
    report.sourceSessionId ?? null,
    report.canonicalSessionId ?? null,
    report.sourceEventId ?? null,
    report.state,
    report.authority,
    report.message ?? null,
    report.customStatus ?? null,
    report.seq ?? null,
    report.observedAt,
    report.expiresAt ?? null,
    report.cwd ?? null,
    report.repoRoot ?? null,
    report.branch ?? null,
    report.pid ?? null,
    report.processName ?? null,
    report.sessionRef?.kind ?? null,
    report.sessionRef?.value ?? null,
    report.payload ? JSON.stringify(report.payload) : null,
    now.toISOString()
  );
  return { status: "accepted", report };
}

export function latestLiveStateReports(
  db: MastheadDatabase,
  options: {
    runtime?: RuntimeKind;
    sourceSessionIds?: Set<string>;
    canonicalSessionIds?: Set<string>;
    freshOnly?: boolean;
    now?: Date;
    limit?: number;
  } = {}
): LiveStateReport[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (options.runtime) {
    where.push("runtime = ?");
    params.push(options.runtime);
  }
  const identityClauses: string[] = [];
  if (options.sourceSessionIds) {
    if (options.sourceSessionIds.size === 0) return [];
    const placeholders = [...options.sourceSessionIds].map(() => "?").join(", ");
    identityClauses.push(`source_session_id IN (${placeholders})`);
    params.push(...options.sourceSessionIds);
  }
  if (options.canonicalSessionIds) {
    if (options.canonicalSessionIds.size === 0) return [];
    const placeholders = [...options.canonicalSessionIds].map(() => "?").join(", ");
    identityClauses.push(`canonical_session_id IN (${placeholders})`);
    params.push(...options.canonicalSessionIds);
  }
  if (identityClauses.length > 0) where.push(`(${identityClauses.join(" OR ")})`);
  const sql = `SELECT * FROM live_state_reports${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY observed_at DESC, rowid DESC
    LIMIT ?`;
  const rows = db.prepare(sql).all(...params, Math.max(options.limit ?? 500, 1) * 4) as LiveStateRow[];
  const seen = new Set<string>();
  const reports: LiveStateReport[] = [];
  for (const row of rows) {
    const report = rowToReport(row);
    if (options.freshOnly && !reportIsFresh(report, options.now)) continue;
    const key = liveStateKey(report);
    if (seen.has(key)) continue;
    seen.add(key);
    reports.push(report);
    if (reports.length >= (options.limit ?? 100)) break;
  }
  return reports;
}

export function latestLiveStateForSourceSession(
  db: MastheadDatabase,
  input: {
    runtime: RuntimeKind;
    sourceSessionId: string;
    freshOnly?: boolean;
    now?: Date;
  }
): LiveStateReport | undefined {
  return latestLiveStateReports(db, {
    runtime: input.runtime,
    sourceSessionIds: new Set([input.sourceSessionId]),
    freshOnly: input.freshOnly,
    now: input.now,
    limit: 1
  })[0];
}

export function latestLiveStateForSession(
  db: MastheadDatabase,
  input: {
    runtime?: RuntimeKind;
    sourceSessionId?: string;
    canonicalSessionId?: string;
    freshOnly?: boolean;
    now?: Date;
  }
): LiveStateReport | undefined {
  return latestLiveStateReports(db, {
    runtime: input.runtime,
    sourceSessionIds: input.sourceSessionId ? new Set([input.sourceSessionId]) : undefined,
    canonicalSessionIds: input.canonicalSessionId ? new Set([input.canonicalSessionId]) : undefined,
    freshOnly: input.freshOnly,
    now: input.now,
    limit: 10
  })[0];
}

function previousReportForKey(db: MastheadDatabase, report: LiveStateReport): LiveStateReport | undefined {
  const row = db
    .prepare(
      `SELECT * FROM live_state_reports
      WHERE runtime = ?
        AND source = ?
        AND (source_session_id = ? OR (source_session_id IS NULL AND ? IS NULL))
        AND (session_ref_kind = ? OR (session_ref_kind IS NULL AND ? IS NULL))
        AND (session_ref_value = ? OR (session_ref_value IS NULL AND ? IS NULL))
        AND (cwd = ? OR (cwd IS NULL AND ? IS NULL))
      ORDER BY observed_at DESC, rowid DESC
      LIMIT 1`
    )
    .get(
      report.runtime,
      report.source,
      report.sourceSessionId ?? null,
      report.sourceSessionId ?? null,
      report.sessionRef?.kind ?? null,
      report.sessionRef?.kind ?? null,
      report.sessionRef?.value ?? null,
      report.sessionRef?.value ?? null,
      report.cwd ?? null,
      report.cwd ?? null
    ) as LiveStateRow | undefined;
  return row ? rowToReport(row) : undefined;
}

function isStale(report: LiveStateReport, previous: LiveStateReport): boolean {
  if (report.seq !== undefined && previous.seq !== undefined && report.seq <= previous.seq) return true;
  if (Date.parse(report.observedAt) < Date.parse(previous.observedAt)) {
    return !(report.seq !== undefined && previous.seq !== undefined && report.seq > previous.seq);
  }
  return false;
}

function rowToReport(row: LiveStateRow): LiveStateReport {
  const report: LiveStateReport = {
    reportId: row.report_id,
    runtime: row.runtime,
    source: row.source,
    state: row.state,
    authority: row.authority,
    observedAt: row.observed_at
  };
  assign(report, "sourceSessionId", row.source_session_id);
  assign(report, "canonicalSessionId", row.canonical_session_id);
  assign(report, "sourceEventId", row.source_event_id);
  assign(report, "message", row.message);
  assign(report, "customStatus", row.custom_status);
  assign(report, "expiresAt", row.expires_at);
  assign(report, "cwd", row.cwd);
  assign(report, "repoRoot", row.repo_root);
  assign(report, "branch", row.branch);
  assign(report, "processName", row.process_name);
  if (row.seq !== null) report.seq = row.seq;
  if (row.pid !== null) report.pid = row.pid;
  if (row.session_ref_kind && row.session_ref_value) report.sessionRef = { kind: row.session_ref_kind, value: row.session_ref_value };
  if (row.payload_json) report.payload = parsePayload(row.payload_json);
  return report;
}

function assign<T extends Record<string, unknown>>(target: T, key: keyof T, value: string | null): void {
  if (value !== null) target[key] = value as T[keyof T];
}

function parsePayload(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
