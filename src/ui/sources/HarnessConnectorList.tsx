import type { HarnessConnectorDto, HarnessConnectorsSnapshotDto } from "../../shared/harnessConnectors";
import { HarnessConnectorRow } from "./HarnessConnectorRow";

type Props = {
  snapshot: HarnessConnectorsSnapshotDto;
  selectedRuntime?: string;
  busy?: boolean;
  readOnly?: boolean;
  cardActionStatus?: Record<string, string>;
  actionRuntime?: string;
  onSelect?: (runtime: string | undefined) => void;
  onEnable?: (runtime: string) => void;
  onTest?: (runtime: string) => void;
  onConfirm?: (runtime: string) => void;
};

export function HarnessConnectorList({
  snapshot,
  selectedRuntime,
  busy = false,
  readOnly = false,
  cardActionStatus = {},
  actionRuntime,
  onSelect,
  onEnable,
  onTest,
  onConfirm
}: Props) {
  const { connectors } = snapshot;

  if (connectors.length === 0) {
    return (
      <div className="empty-session-state surface-empty-state sources-connector-empty">
        <h2>{busy ? "Loading connections" : "No connections"}</h2>
        <p>{busy ? "Checking local harnesses and live capture wiring." : "Press Refresh to scan for supported harnesses."}</p>
      </div>
    );
  }

  return (
    <div className="sources-connection-card-grid" role="list" aria-label="Connection cards">
      {connectors.map((connector) => (
        <div key={connector.runtime} role="listitem">
          <HarnessConnectorRow
            connector={connector}
            selected={selectedRuntime === connector.runtime}
            busy={busy}
            readOnly={readOnly}
            actionStatus={cardActionStatus[connector.runtime]}
            actionBusy={actionRuntime === connector.runtime}
            onSelect={onSelect}
            onEnable={onEnable}
            onTest={onTest}
            onConfirm={onConfirm}
          />
        </div>
      ))}
    </div>
  );
}

export function hasDetectedNotReady(connectors: HarnessConnectorDto[]): boolean {
  return connectors.some((connector) => connector.presence === "found" && connector.live !== "ready");
}
