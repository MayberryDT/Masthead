import type { HarnessConnectorDto } from "../../shared/harnessConnectors";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

export type HarnessConnectorRowActions = {
  onEnable?: (runtime: string) => void;
  onTest?: (runtime: string) => void;
  onConfirm?: (runtime: string) => void;
};

type Props = {
  connector: HarnessConnectorDto;
  selected?: boolean;
  busy?: boolean;
  readOnly?: boolean;
  /** Footer status for this card's Enable/Test action (not toolbar refresh). */
  actionStatus?: string;
  actionBusy?: boolean;
  onSelect?: (runtime: string) => void;
} & HarnessConnectorRowActions;

export function HarnessConnectorRow({
  connector,
  selected = false,
  busy = false,
  readOnly = false,
  actionStatus,
  actionBusy = false,
  onSelect,
  onEnable,
  onTest,
  onConfirm
}: Props) {
  const cta = resolvePrimaryCta(connector, { onEnable: Boolean(onEnable), onTest: Boolean(onTest), onConfirm: Boolean(onConfirm) });
  const disabled = busy || readOnly || !connector.supportsActions;
  const footerStatus =
    actionStatus ||
    (connector.lastTest
      ? connector.lastTest.status === "passed"
        ? `Last test passed`
        : `Last test failed`
      : undefined);

  return (
    <article
      className={`adapter-card sources-connection-card${selected ? " is-selected" : ""}${connector.presence === "not_found" ? " adapter-card-not_detected" : ""}`}
      aria-label={`${connector.label} connection`}
      aria-current={selected ? "true" : undefined}
      data-runtime={connector.runtime}
      onClick={() => onSelect?.(connector.runtime)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(connector.runtime);
      }}
      tabIndex={0}
    >
      <div className="adapter-card-head">
        <div className="adapter-card-title-row">
          <div className="adapter-card-select">
            <h2>{connector.label}</h2>
          </div>
          <div className="sources-connector-row-badges">
            <StatusBadge tone={presenceTone(connector.presence)}>{presenceLabel(connector.presence)}</StatusBadge>
            <StatusBadge tone={liveTone(connector.live)}>{liveLabel(connector)}</StatusBadge>
          </div>
        </div>
      </div>

      <dl className="adapter-card-metrics">
        <div>
          <dt>Last event</dt>
          <dd>{formatLastEvent(connector.lastLiveEventAt)}</dd>
        </div>
        <div>
          <dt>Live capture</dt>
          <dd>{liveLabel(connector)}</dd>
        </div>
      </dl>

      {connector.actionMessage && connector.live === "needs_action" ? (
        <p className="sources-connector-row-message">{connector.actionMessage}</p>
      ) : null}

      <div className="adapter-card-footer sources-connection-card-footer" onClick={(event) => event.stopPropagation()}>
        {cta.kind === "message" ? (
          <span className="sources-connector-cta-message">{cta.label}</span>
        ) : (
          <AppButton
            variant={cta.variant}
            disabled={disabled}
            onClick={() => {
              if (cta.action === "enable") onEnable?.(connector.runtime);
              else if (cta.action === "test") onTest?.(connector.runtime);
              else if (cta.action === "confirm") onConfirm?.(connector.runtime);
            }}
          >
            {actionBusy ? <span className="sources-refresh-spinner" aria-hidden="true" /> : null}
            {cta.label}
          </AppButton>
        )}
        <span
          className={`sources-connection-open-hint${footerStatus ? " has-status" : ""}${
            connector.lastTest?.status === "failed" || (actionStatus && /fail/i.test(actionStatus)) ? " is-fail" : ""
          }${connector.lastTest?.status === "passed" || (actionStatus && /passed|ready/i.test(actionStatus)) ? " is-pass" : ""}`}
          title={footerStatus ?? "Open detail"}
        >
          {footerStatus ?? "Details"}
        </span>
      </div>
    </article>
  );
}

type CtaSpec =
  | {
      kind: "button";
      label: string;
      action: "enable" | "test" | "confirm";
      variant: "primary" | "default" | "quiet";
    }
  | { kind: "message"; label: string };

export function resolvePrimaryCta(
  connector: HarnessConnectorDto,
  handlers: { onEnable: boolean; onTest: boolean; onConfirm: boolean }
): CtaSpec {
  if (connector.live === "not_installed") {
    return handlers.onEnable
      ? { kind: "button", label: "Enable", action: "enable", variant: "primary" }
      : { kind: "message", label: "Enable unavailable" };
  }

  if (connector.live === "error") {
    return handlers.onEnable
      ? { kind: "button", label: "Repair", action: "enable", variant: "primary" }
      : { kind: "message", label: connector.actionMessage ?? "Repair unavailable" };
  }

  if (connector.live === "ready") {
    return handlers.onTest
      ? { kind: "button", label: "Test", action: "test", variant: "default" }
      : { kind: "message", label: "Ready" };
  }

  const required = connector.actionRequired;
  if (required === "repair") {
    return handlers.onEnable
      ? { kind: "button", label: "Repair", action: "enable", variant: "primary" }
      : { kind: "message", label: connector.actionMessage ?? "Repair unavailable" };
  }
  if (required === "enable_plugin") {
    return handlers.onEnable
      ? { kind: "button", label: "Enable", action: "enable", variant: "primary" }
      : { kind: "message", label: connector.actionMessage ?? "Enable unavailable" };
  }
  if (required === "trust_hooks" || required === "confirm_activation") {
    if (handlers.onConfirm) {
      return { kind: "button", label: "Confirm trusted", action: "confirm", variant: "primary" };
    }
    return { kind: "message", label: connector.actionMessage ?? "Confirm activation in the host harness" };
  }

  return {
    kind: "message",
    label: connector.actionMessage ?? "Host action required"
  };
}

export function presenceLabel(presence: HarnessConnectorDto["presence"]): string {
  return presence === "found" ? "Found" : "Not found";
}

export function presenceTone(presence: HarnessConnectorDto["presence"]): StatusBadgeTone {
  return presence === "found" ? "info" : "neutral";
}

export function liveLabel(connector: HarnessConnectorDto): string {
  if (connector.live === "ready") return "Ready";
  if (connector.live === "not_installed") return "Not installed";
  if (connector.live === "error") return "Error";
  return "Needs action";
}

export function liveTone(live: HarnessConnectorDto["live"]): StatusBadgeTone {
  if (live === "ready") return "active";
  if (live === "error") return "danger";
  if (live === "needs_action") return "warning";
  return "neutral";
}

export function formatLastEvent(value: string | undefined): string {
  if (!value) return "None observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  });
}
