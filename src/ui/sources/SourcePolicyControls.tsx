import type { AdapterStatus } from "../../app/daemonClient";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  policies: AdapterStatus["policies"];
};

export function SourcePolicyControls({ policies }: Props) {
  return (
    <dl className="source-policy-controls" aria-label="Adapter policies">
      <Policy label="Metadata" enabled={policies.metadataImport} />
      <Policy label="Messages" enabled={policies.transcriptImport} />
      <Policy label="Enrichment" enabled={policies.enrichment} />
      <Policy label="MCP access" enabled={policies.mcpAccess} />
    </dl>
  );
}

function Policy({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <StatusBadge tone={enabled ? "active" : "neutral"}>{enabled ? "Enabled" : "Disabled"}</StatusBadge>
      </dd>
    </div>
  );
}
