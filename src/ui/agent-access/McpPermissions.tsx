import type { McpPermissionsDto, McpStatusDto } from "../../app/daemonClient";
import { FieldRow } from "../primitives/FieldRow";
import { StatusBadge } from "../primitives/StatusBadge";

type McpPermissionsProps = {
  status: McpStatusDto;
};

const defaultAllowed = ["Search session summaries", "Read bounded historical excerpts", "Read project history"];
const defaultBlocked = ["Execute shell commands", "Mutate files or Git", "Modify harness sessions"];

export function McpPermissions({ status }: McpPermissionsProps) {
  const permissions = normalizedPermissions(status);
  return (
    <section className="agent-access-section" aria-labelledby="mcp-permissions-title">
      <div className="agent-access-section-head">
        <div>
          <p className="mono-label">Permissions</p>
          <h2 id="mcp-permissions-title">Read-only access policy</h2>
        </div>
        <StatusBadge tone={permissions.globalAccessEnabled ? "active" : "danger"}>
          {permissions.globalAccessEnabled ? "Enabled" : "Disabled"}
        </StatusBadge>
      </div>

      <div className="agent-access-policy-list">
        {permissions.allowed.map((item) => (
          <span className="agent-access-policy agent-access-policy-allowed" key={item}>
            {item}
          </span>
        ))}
        {permissions.blocked.map((item) => (
          <span className="agent-access-policy agent-access-policy-blocked" key={item}>
            {item}
          </span>
        ))}
      </div>

      <div className="agent-access-settings">
        <FieldRow
          description="Controls whether read-only MCP retrieval can return any indexed session data."
          label="Global MCP access"
          value={<StatusBadge tone={permissions.globalAccessEnabled ? "active" : "danger"}>{permissions.globalAccessEnabled ? "Enabled" : "Disabled"}</StatusBadge>}
        />
        <FieldRow
          description="Active source_exclusions patterns are enforced before sessions leave Masthead."
          label="Excluded projects and sessions"
          value={permissions.exclusions.length > 0 ? permissions.exclusions.map((item) => item.pattern).join(", ") : "None"}
        />
        <FieldRow
          description="Per-source MCP policy overrides the global policy for discovered adapter sources."
          label="Source-level MCP policy"
          value={sourcePolicySummary(permissions)}
        />
      </div>
    </section>
  );
}

function normalizedPermissions(status: McpStatusDto): McpPermissionsDto {
  return {
    allowed: status.permissions?.allowed ?? defaultAllowed,
    blocked: status.permissions?.blocked ?? defaultBlocked,
    exclusions: status.permissions?.exclusions ?? [],
    globalAccessEnabled: status.permissions?.globalAccessEnabled ?? status.globalAccessEnabled,
    sourcePolicies: status.permissions?.sourcePolicies ?? []
  };
}

function sourcePolicySummary(permissions: McpPermissionsDto): string {
  if (permissions.sourcePolicies.length === 0) return "No discovered adapter sources yet";
  const disabled = permissions.sourcePolicies.filter((policy) => !policy.enabled).length;
  if (disabled === 0) return `${permissions.sourcePolicies.length} source policies allow MCP access`;
  return `${disabled} of ${permissions.sourcePolicies.length} source policies disable MCP access`;
}
