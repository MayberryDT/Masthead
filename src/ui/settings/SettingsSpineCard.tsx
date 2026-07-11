import type { ReactNode } from "react";
import { SettingsToggle } from "./SettingsToggle";

type Props = {
  children?: ReactNode;
  motionDisabled?: boolean;
  onMotionDisabledChange?: (disabled: boolean) => void;
  onSessionEndedNotificationsEnabledChange?: (enabled: boolean) => void;
  sessionEndedNotificationsEnabled?: boolean;
};

export function SettingsSpineCard({
  children,
  motionDisabled = false,
  onMotionDisabledChange,
  onSessionEndedNotificationsEnabledChange,
  sessionEndedNotificationsEnabled = true
}: Props) {
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
      </div>
      {children ? <div className="settings-spine-sections">{children}</div> : null}
      <p className="settings-spine-note">Configuration is stored on this machine.</p>
    </section>
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
