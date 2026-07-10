import type { ReactNode } from "react";
import { AppButton } from "../primitives/AppButton";
import { SettingsToggle } from "./SettingsToggle";

export type SettingsSpineDetail = "data" | "agent-access" | "advanced" | "danger";

type Props = {
  activeDetail?: SettingsSpineDetail;
  children?: ReactNode;
  motionDisabled?: boolean;
  onDetailChange: (detail?: SettingsSpineDetail) => void;
  onMotionDisabledChange?: (disabled: boolean) => void;
  onSessionEndedNotificationsEnabledChange?: (enabled: boolean) => void;
  sessionEndedNotificationsEnabled?: boolean;
};

export function SettingsSpineCard({
  activeDetail,
  children,
  motionDisabled = false,
  onDetailChange,
  onMotionDisabledChange,
  onSessionEndedNotificationsEnabledChange,
  sessionEndedNotificationsEnabled = true
}: Props) {
  const toggleDetail = (detail: SettingsSpineDetail) => {
    onDetailChange(activeDetail === detail ? undefined : detail);
  };

  return (
    <section className="settings-spine-card secondary-tier-live" aria-labelledby="settings-spine-title">
      <header className="settings-spine-header">
        <h2 id="settings-spine-title">Settings</h2>
        <span>Local</span>
      </header>
      <div className="settings-spine-list">
        <SpineRow
          control={
            <SettingsToggle
              checked={!motionDisabled}
              label="Enable motion"
              offLabel="Motion off"
              onChange={(motionEnabled) => onMotionDisabledChange?.(!motionEnabled)}
              onLabel="Motion on"
            />
          }
          label="Motion"
        />
        <SpineRow
          control={
            <SettingsToggle
              checked={sessionEndedNotificationsEnabled}
              label="Session transition notifications"
              offLabel="Notifications off"
              onChange={(enabled) => onSessionEndedNotificationsEnabledChange?.(enabled)}
              onLabel="Notifications on"
            />
          }
          label="Session notifications"
        />
        <DetailRow activeDetail={activeDetail} detail="data" label="Data" onToggle={toggleDetail} />
        <DetailRow activeDetail={activeDetail} detail="agent-access" label="Agent access" onToggle={toggleDetail} />
        <DetailRow activeDetail={activeDetail} detail="advanced" label="Advanced" onToggle={toggleDetail} />
        <DetailRow activeDetail={activeDetail} danger detail="danger" label="Danger zone" onToggle={toggleDetail} />
      </div>
      {activeDetail && children ? (
        <div className="settings-spine-detail" data-settings-detail={activeDetail} id="settings-spine-detail">
          {children}
        </div>
      ) : null}
      <p className="settings-spine-note">Configuration is stored on this machine.</p>
    </section>
  );
}

function DetailRow({
  activeDetail,
  danger = false,
  detail,
  label,
  onToggle
}: {
  activeDetail?: SettingsSpineDetail;
  danger?: boolean;
  detail: SettingsSpineDetail;
  label: string;
  onToggle: (detail: SettingsSpineDetail) => void;
}) {
  const expanded = activeDetail === detail;
  return (
    <SpineRow
      control={
        <AppButton
          aria-controls="settings-spine-detail"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Close" : "Open"} ${label}`}
          onClick={() => onToggle(detail)}
          variant={danger ? "danger" : "quiet"}
        >
          {expanded ? "Close" : "Open"}
        </AppButton>
      }
      danger={danger}
      label={label}
    />
  );
}

function SpineRow({
  control,
  danger = false,
  label
}: {
  control: ReactNode;
  danger?: boolean;
  label: string;
}) {
  return (
    <div className={`settings-spine-row ${danger ? "danger" : ""}`.trim()}>
      <span className="settings-spine-copy">
        <strong>{label}</strong>
      </span>
      <span className="settings-spine-control">{control}</span>
    </div>
  );
}
