import type { RuntimeKind } from "../../adapters/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type RuntimePolicyKind = "transcript_import" | "enrichment" | "mcp_access";

export function setRuntimePolicy(
  db: MastheadDatabase,
  input: {
    runtime: RuntimeKind;
    policyKind: RuntimePolicyKind;
    enabled: boolean;
    decidedAt: string;
    reason?: string;
  }
): void {
  const runtimePolicyId = stableRecordId("runtime_policy", [input.runtime, input.policyKind]);
  db.prepare(
    `INSERT INTO runtime_policies (
      runtime_policy_id,
      runtime_kind,
      policy_kind,
      enabled,
      decided_at,
      reason
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(runtime_kind, policy_kind) DO UPDATE SET
      enabled = excluded.enabled,
      decided_at = excluded.decided_at,
      reason = excluded.reason`
  ).run(runtimePolicyId, input.runtime, input.policyKind, input.enabled ? 1 : 0, input.decidedAt, input.reason ?? null);
}

export function getRuntimePolicy(
  db: MastheadDatabase,
  runtime: RuntimeKind,
  policyKind: RuntimePolicyKind,
  defaultValue = false
): boolean {
  const row = db
    .prepare(
      `SELECT enabled
      FROM runtime_policies
      WHERE runtime_kind = ?
        AND policy_kind = ?`
    )
    .get(runtime, policyKind) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : defaultValue;
}
