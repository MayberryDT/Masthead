import type { HarnessConnectorDto, HarnessConnectorsSnapshotDto } from "../../shared/harnessConnectors";
import { StatusBadge } from "../primitives/StatusBadge";
import { HarnessConnectorRow } from "./HarnessConnectorRow";

type Props = {
  snapshot: HarnessConnectorsSnapshotDto;
  selectedRuntime?: string;
  busy?: boolean;
  readOnly?: boolean;
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
  onSelect,
  onEnable,
  onTest,
  onConfirm
}: Props) {
  const { summary, connectors } = snapshot;

  return (
    <section className="sources-connector-list" aria-label="Harness connectors">
      <div className="sources-connector-list-head">
        <div>
          <p className="mono-label">Connectors</p>
          <h2>Live harness inventory</h2>
        </div>
        <div className="sources-connector-summary-chips" aria-label="Connector summary">
          <StatusBadge tone="active">{summary.ready} ready</StatusBadge>
          <StatusBadge tone="warning">{summary.needsAction} needs action</StatusBadge>
          <StatusBadge tone="neutral">{summary.notInstalled} not installed</StatusBadge>
          <StatusBadge tone="neutral">{summary.notFound} not found</StatusBadge>
          {summary.error > 0 ? <StatusBadge tone="danger">{summary.error} error</StatusBadge> : null}
        </div>
      </div>

      {connectors.length === 0 ? (
        <div className="empty-session-state surface-empty-state sources-connector-empty">
          <p className="mono-label">Sources</p>
          <h2>{busy ? "Loading connectors" : "No harness connectors"}</h2>
          <p>
            {busy
              ? "Masthead is reading local harness presence and live connector status."
              : "Run Discover to scan for supported local harnesses."}
          </p>
        </div>
      ) : (
        <div className="sources-connector-rows" role="list">
          {connectors.map((connector) => (
            <div key={connector.runtime} role="listitem">
              <HarnessConnectorRow
                connector={connector}
                selected={selectedRuntime === connector.runtime}
                busy={busy}
                readOnly={readOnly}
                onSelect={onSelect}
                onEnable={onEnable}
                onTest={onTest}
                onConfirm={onConfirm}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function hasDetectedNotReady(connectors: HarnessConnectorDto[]): boolean {
  return connectors.some((connector) => connector.presence === "found" && connector.live !== "ready");
}
