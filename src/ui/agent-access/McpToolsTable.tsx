import type { McpToolDto } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";

type McpToolsTableProps = {
  tools: McpToolDto[];
};

export function McpToolsTable({ tools }: McpToolsTableProps) {
  return (
    <section className="agent-access-section" aria-labelledby="mcp-tools-title">
      <div className="agent-access-section-head">
        <div>
          <p className="mono-label">Tools</p>
          <h2 id="mcp-tools-title">Exposed retrieval tools</h2>
        </div>
        <StatusBadge tone="info">{tools.length} tools</StatusBadge>
      </div>

      <div className="agent-access-table-wrap">
        <table className="agent-access-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Purpose</th>
              <th>Arguments</th>
              <th>Data returned</th>
              <th>Permission</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name}>
                <td>
                  <code>{tool.name}</code>
                </td>
                <td>{tool.purpose}</td>
                <td>{tool.arguments}</td>
                <td>{tool.dataReturned}</td>
                <td>
                  <StatusBadge tone="active">{tool.permission}</StatusBadge>
                </td>
              </tr>
            ))}
            {tools.length === 0 ? (
              <tr>
                <td colSpan={5}>No MCP tools reported by the local daemon.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
