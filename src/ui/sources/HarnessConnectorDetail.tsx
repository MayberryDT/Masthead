import { useState } from "react";
import type { HarnessConnectorDto } from "../../shared/harnessConnectors";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import {
  formatLastEvent,
  liveLabel,
  liveTone,
  presenceLabel,
  presenceTone
} from "./HarnessConnectorRow";

type Props = {
  connector: HarnessConnectorDto;
  busy?: boolean;
  readOnly?: boolean;
  onClose?: () => void;
  onEnable?: (runtime: string) => void;
  onTest?: (runtime: string) => void;
  onUninstall?: (runtime: string) => void;
  onConfirm?: (runtime: string) => void;
};

export function HarnessConnectorDetail({
  connector,
  busy = false,
  readOnly = false,
  onClose,
  onEnable,
  onTest,
  onUninstall,
  onConfirm
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const disabled = busy || readOnly || !connector.supportsActions;
  const showConfirm =
    connector.live === "needs_action" &&
    (connector.actionRequired === "trust_hooks" || connector.actionRequired === "confirm_activation");
  const showRepair =
    connector.live === "error" ||
    (connector.live === "needs_action" && connector.actionRequired === "repair");
  const showEnable =
    connector.live === "not_installed" ||
    (connector.live === "needs_action" && connector.actionRequired === "enable_plugin") ||
    showRepair;

  return (
    <aside className="sources-connector-detail" aria-label={`${connector.label} connection detail`}>
      <header className="sources-connector-detail-head">
        <div>
          <p className="mono-label">Connection</p>
          <h2>{connector.label}</h2>
        </div>
        <div className="sources-connector-row-badges">
          <StatusBadge tone={presenceTone(connector.presence)}>{presenceLabel(connector.presence)}</StatusBadge>
          <StatusBadge tone={liveTone(connector.live)}>{liveLabel(connector)}</StatusBadge>
          {onClose ? (
            <AppButton variant="quiet" onClick={onClose} aria-label="Close connection detail">
              Close
            </AppButton>
          ) : null}
        </div>
      </header>

      <p className="sources-connector-honest-copy">
        Live capture only. Presence means the harness is installed on this machine. Ready means Masthead is wired to
        receive live signals. Deeper transcript work is in Workbench.
      </p>

      {connector.actionMessage ? (
        <p className="surface-status sources-connector-action-message" role="status">
          {connector.actionMessage}
        </p>
      ) : null}

      <dl className="sources-connector-detail-facts" aria-label="Connector paths and endpoints">
        <div>
          <dt>Config path</dt>
          <dd className="mono-path">{connector.configPath ?? "—"}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd className="mono-path">{connector.endpoint ?? "—"}</dd>
        </div>
        <div>
          <dt>State endpoint</dt>
          <dd className="mono-path">{connector.stateEndpoint ?? "—"}</dd>
        </div>
        <div>
          <dt>Last live event</dt>
          <dd>{formatLastEvent(connector.lastLiveEventAt)}</dd>
        </div>
        <div>
          <dt>Last test</dt>
          <dd>
            {connector.lastTest
              ? `${connector.lastTest.status} · ${formatLastEvent(connector.lastTest.testedAt)}`
              : "Not run"}
          </dd>
        </div>
        {connector.historyFound != null ? (
          <div>
            <dt>Local history</dt>
            <dd>
              {connector.historyFound
                ? `Found${connector.historySessionCount != null ? ` · ${connector.historySessionCount} sessions` : ""}`
                : "Not found"}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="source-detail-action-buttons sources-connector-detail-actions">
        {showEnable ? (
          <AppButton variant="primary" disabled={disabled || !onEnable} onClick={() => onEnable?.(connector.runtime)}>
            {showRepair ? "Repair" : "Enable"}
          </AppButton>
        ) : null}
        {showConfirm ? (
          <AppButton
            variant="primary"
            disabled={disabled || !onConfirm}
            onClick={() => onConfirm?.(connector.runtime)}
          >
            Confirm trusted
          </AppButton>
        ) : null}
        <AppButton
          variant="default"
          disabled={disabled || !onTest || connector.live === "not_installed"}
          onClick={() => onTest?.(connector.runtime)}
        >
          Test
        </AppButton>
        <AppButton
          variant="quiet"
          disabled={disabled || !onUninstall || connector.live === "not_installed"}
          onClick={() => onUninstall?.(connector.runtime)}
        >
          Uninstall
        </AppButton>
      </div>

      <section className="sources-connector-advanced" aria-label="Advanced diagnostics">
        <button
          type="button"
          className="sources-connector-advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span className="mono-label">Advanced</span>
          <span>{advancedOpen ? "Hide paths & diagnostics" : "Show paths & diagnostics"}</span>
        </button>
        {advancedOpen ? (
          <div className="sources-connector-advanced-body">
            <div>
              <p className="mono-label">Checked paths</p>
              {(connector.checkedPaths?.length ?? 0) === 0 ? (
                <p className="sources-connector-advanced-empty">No checked paths recorded.</p>
              ) : (
                <ul className="sources-connector-mono-list">
                  {connector.checkedPaths!.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mono-label">Diagnostics</p>
              {(connector.diagnostics?.length ?? 0) === 0 ? (
                <p className="sources-connector-advanced-empty">No diagnostics.</p>
              ) : (
                <ul className="sources-connector-mono-list">
                  {connector.diagnostics!.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
