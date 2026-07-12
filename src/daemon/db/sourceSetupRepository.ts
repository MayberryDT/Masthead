import type { SourcesOnboardingScanDto, SourcesSetupDto } from "../../shared/sourcesSetup.ts";
import { type MastheadDatabase, withImmediateTransaction } from "./sqlite.ts";

type SourceScanRunRow = {
  result_json: string;
};

type SourceSetupStateRow = {
  state_json: string;
};

export function saveSourceScanRun(db: MastheadDatabase, scan: SourcesOnboardingScanDto): void {
  db.prepare(
    `INSERT INTO source_scan_runs (scan_id, generated_at, result_json, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scan_id) DO UPDATE SET
      generated_at = excluded.generated_at,
      result_json = excluded.result_json,
      status = excluded.status`
  ).run(scan.scanId, scan.generatedAt, JSON.stringify(scan), scan.status);
}

export function getLatestSourceScanRun(db: MastheadDatabase): SourcesOnboardingScanDto | undefined {
  const row = db
    .prepare(
      `SELECT result_json
      FROM source_scan_runs
      ORDER BY generated_at DESC, scan_id DESC
      LIMIT 1`
    )
    .get() as SourceScanRunRow | undefined;
  return row ? (JSON.parse(row.result_json) as SourcesOnboardingScanDto) : undefined;
}

export function saveSourceSetupState(db: MastheadDatabase, setup: SourcesSetupDto): void {
  withImmediateTransaction(db, () => {
    db.prepare(
      `INSERT INTO source_setup_state (setup_id, updated_at, state_json)
      VALUES ('current', ?, ?)
      ON CONFLICT(setup_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        state_json = excluded.state_json`
    ).run(setup.updatedAt, JSON.stringify(setup));
    db.prepare("DELETE FROM source_setup_state WHERE setup_id <> 'current'").run();
  });
}

export function getLatestSourceSetupState(db: MastheadDatabase): SourcesSetupDto | undefined {
  const row = db
    .prepare(
      `SELECT state_json
      FROM source_setup_state
      ORDER BY updated_at DESC, setup_id DESC
      LIMIT 1`
    )
    .get() as SourceSetupStateRow | undefined;
  return row ? (JSON.parse(row.state_json) as SourcesSetupDto) : undefined;
}
