import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SourcePolicyKind = "metadata_import" | "transcript_import" | "mcp_access" | "enrichment";

export type SourcePolicyInput = {
  sourceId?: string;
  policyKind: SourcePolicyKind;
  enabled: boolean;
  decidedAt: string;
  reason?: string;
};

export function setSourcePolicy(db: MastheadDatabase, input: SourcePolicyInput): void {
  if (input.sourceId === "global") throw new Error("global is a reserved source id.");
  const sourceKey = input.sourceId ? `source:${input.sourceId}` : "global";
  db.prepare(
    `INSERT INTO source_policies (
      source_policy_id,
      source_id,
      policy_kind,
      enabled,
      decided_at,
      reason
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_policy_id) DO UPDATE SET
      source_id = excluded.source_id,
      policy_kind = excluded.policy_kind,
      enabled = excluded.enabled,
      decided_at = excluded.decided_at,
      reason = excluded.reason`
  ).run(
    stableRecordId("source_policy", [sourceKey, input.policyKind]),
    input.sourceId ?? null,
    input.policyKind,
    input.enabled ? 1 : 0,
    input.decidedAt,
    input.reason ?? null
  );
}

export function sourcePolicyEnabled(db: MastheadDatabase, policyKind: SourcePolicyKind, sourceId?: string): boolean {
  if (sourceId === "global") return false;
  const row = db
    .prepare(
      `SELECT enabled
      FROM source_policies
      WHERE policy_kind = ?
        AND ${sourceId ? "(source_id = ? OR source_id IS NULL)" : "source_id IS NULL"}
      ORDER BY source_id IS NOT NULL DESC, decided_at DESC
      LIMIT 1`
    )
    .get(...(sourceId ? [policyKind, sourceId] : [policyKind])) as { enabled: number } | undefined;
  return row?.enabled === 1;
}
