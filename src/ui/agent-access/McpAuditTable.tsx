import type { McpAuditRowDto } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";

type McpAuditTableProps = {
  audit: McpAuditRowDto[];
};

export function McpAuditTable({ audit }: McpAuditTableProps) {
  return (
    <section className="agent-access-section agent-access-details-section agent-access-audit-section" aria-labelledby="mcp-audit-title">
      <div className="agent-access-section-head">
        <div>
          <p className="mono-label">Recent queries</p>
          <h2 id="mcp-audit-title">MCP query audit</h2>
        </div>
        <StatusBadge tone="neutral">{audit.length} shown</StatusBadge>
      </div>

      <div className="agent-access-table-wrap">
        <table className="agent-access-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tool</th>
              <th>Results</th>
              <th>Bounded bytes</th>
              <th>Status</th>
              <th>Referenced sessions</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row) => (
              <tr key={row.mcpQueryId}>
                <td>{formatDate(row.requestedAt)}</td>
                <td>
                  <code>{row.toolName}</code>
                </td>
                <td>{row.resultCount}</td>
                <td>{row.boundedBytes ?? "unbounded"}</td>
                <td>
                  <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                </td>
                <td>{row.sessionIds.length > 0 ? row.sessionIds.join(", ") : "None"}</td>
              </tr>
            ))}
            {audit.length === 0 ? (
              <tr>
                <td colSpan={6}>No MCP queries have been recorded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function statusTone(status: McpAuditRowDto["status"]): "active" | "danger" | "warning" {
  if (status === "succeeded") return "active";
  if (status === "failed") return "danger";
  return "warning";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
