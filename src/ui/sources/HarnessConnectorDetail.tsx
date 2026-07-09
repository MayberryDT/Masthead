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
  actionStatus?: string;
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
  actionStatus,
  onClose,
  onEnable,
  onTest,
  onUninstall,
  onConfirm
}: Props) {
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

  const statusTone = statusBannerTone(connector, actionStatus);
  const statusText = primaryStatusText(connector, actionStatus);

  return (
    <aside className="sources-connector-detail sources-connection-detail-rich" aria-label={`${connector.label} connection detail`}>
      <header className="sources-connection-detail-hero">
        <div className="sources-connection-detail-hero-copy">
          <p className="mono-label">Connection</p>
          <h2>{connector.label}</h2>
          <div className="sources-connector-row-badges">
            <StatusBadge tone={presenceTone(connector.presence)}>{presenceLabel(connector.presence)}</StatusBadge>
            <StatusBadge tone={liveTone(connector.live)}>{liveLabel(connector)}</StatusBadge>
          </div>
        </div>
        <div className="sources-connection-detail-hero-actions">
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
          {onClose ? (
            <AppButton variant="quiet" onClick={onClose} aria-label="Close connection detail">
              Close
            </AppButton>
          ) : null}
        </div>
      </header>

      {statusText ? (
        <p className={`sources-connection-detail-status sources-connection-detail-status-${statusTone}`} role="status">
          {statusText}
        </p>
      ) : null}

      <section className="sources-connection-detail-section" aria-label="Snapshot">
        <h3>Snapshot</h3>
        <dl className="sources-connection-detail-grid">
          <div>
            <dt>Presence</dt>
            <dd>{presenceLabel(connector.presence)}</dd>
          </div>
          <div>
            <dt>Live capture</dt>
            <dd>{liveLabel(connector)}</dd>
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
        </dl>
      </section>

      <section className="sources-connection-detail-section" aria-label="Wiring">
        <h3>Wiring</h3>
        <dl className="sources-connection-detail-stack">
          <div>
            <dt>Config path</dt>
            <dd className="mono-path">{connector.configPath ?? "—"}</dd>
          </div>
          <div>
            <dt>Ingest endpoint</dt>
            <dd className="mono-path">{connector.endpoint ?? "—"}</dd>
          </div>
          <div>
            <dt>Live state endpoint</dt>
            <dd className="mono-path">{connector.stateEndpoint ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="sources-connection-detail-section" aria-label="Checked paths">
        <h3>Checked paths</h3>
        {(connector.checkedPaths?.length ?? 0) === 0 ? (
          <p className="sources-connection-detail-empty-line">No local paths checked for this harness.</p>
        ) : (
          <ul className="sources-connection-detail-path-list">
            {connector.checkedPaths!.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )}
      </section>

      {(connector.diagnostics?.length ?? 0) > 0 ? (
        <section className="sources-connection-detail-section" aria-label="Diagnostics">
          <h3>Diagnostics</h3>
          <ul className="sources-connection-detail-path-list">
            {connector.diagnostics!.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function primaryStatusText(connector: HarnessConnectorDto, actionStatus?: string): string | undefined {
  if (actionStatus?.trim()) return actionStatus.trim();
  if (connector.actionMessage && connector.live === "needs_action") return connector.actionMessage;
  if (connector.presence === "not_found") {
    return connector.live === "not_installed"
      ? "Harness not found on this machine."
      : "Harness not found on this machine. Live wiring may still exist from a previous install.";
  }
  if (connector.lastTest?.status === "passed") return `Test passed — ${connector.lastTest.message}`;
  if (connector.lastTest?.status === "failed") return `Test failed — ${connector.lastTest.message}`;
  if (connector.live === "ready") return "Live capture is ready for this harness.";
  return undefined;
}

function statusBannerTone(
  connector: HarnessConnectorDto,
  actionStatus?: string
): "neutral" | "pass" | "fail" | "warn" {
  const text = `${actionStatus ?? ""} ${connector.actionMessage ?? ""} ${connector.lastTest?.status ?? ""}`.toLowerCase();
  if (text.includes("fail") || connector.live === "error" || connector.lastTest?.status === "failed") return "fail";
  if (text.includes("pass") || text.includes("ready") || connector.lastTest?.status === "passed") return "pass";
  if (connector.live === "needs_action" || connector.presence === "not_found") return "warn";
  return "neutral";
}
