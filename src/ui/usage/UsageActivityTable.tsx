import type { UsageActivityPointDto } from "../../app/daemonClient";
import { formatBucket, formatCompactUsage, formatUsageNumber } from "./formatUsage";
import { UsageHint } from "./UsageHint";

export function UsageActivityTable({ rows }: { rows: UsageActivityPointDto[] }) {
  return (
    <section className="usage-table-card activity">
      <h2>Activity</h2>
      <div className="usage-table-wrap">
        <table className="usage-table">
          <thead>
            <tr>
              <th><UsageHint label="Bucket" tip="Hour or day bucket inside the selected usage window." /></th>
              <th><UsageHint label="Sessions" tip="Sessions active in this time bucket." /></th>
              <th><UsageHint label="Tokens" tip="Imported token total for this time bucket." /></th>
              <th><UsageHint label="Tools" tip="Tool calls captured in this time bucket." /></th>
              <th><UsageHint label="Files" tip="Observed file effects in this time bucket." /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bucketStart}>
                <td>{formatBucket(row.bucketStart)}</td>
                <td>{formatUsageNumber(row.sessions)}</td>
                <td>{formatCompactUsage(row.totalTokens)}</td>
                <td>{formatUsageNumber(row.toolCalls)}</td>
                <td>{formatUsageNumber(row.fileEffects)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
