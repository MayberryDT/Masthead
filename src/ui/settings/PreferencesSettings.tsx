import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsToggle } from "./SettingsToggle";

type PreferencesSettingsProps = {
  motionDisabled?: boolean;
  onMotionDisabledChange?: (disabled: boolean) => void;
  sessionEndedNotificationsEnabled?: boolean;
  onSessionEndedNotificationsEnabledChange?: (enabled: boolean) => void;
};

export function PreferencesSettings({
  motionDisabled = false,
  onMotionDisabledChange,
  sessionEndedNotificationsEnabled = true,
  onSessionEndedNotificationsEnabledChange
}: PreferencesSettingsProps) {
  return (
    <SettingsSection eyebrow="Interface" title="Preferences">
      <SettingsRow
        label="Motion"
        description="Turns off app animations and animated layout transitions on this device."
        control={
          <SettingsToggle
            checked={!motionDisabled}
            label="Enable motion"
            offLabel="Motion off"
            onChange={(motionEnabled) => onMotionDisabledChange?.(!motionEnabled)}
            onLabel="Motion on"
          />
        }
      />
      <SettingsRow
        label="Session transition notifications"
        description="Desktop only. Notify when a live session becomes idle, blocked, or ended."
        control={
          <SettingsToggle
            checked={sessionEndedNotificationsEnabled}
            label="Session transition notifications"
            offLabel="Notifications off"
            onChange={(enabled) => onSessionEndedNotificationsEnabledChange?.(enabled)}
            onLabel="Notifications on"
          />
        }
      />
    </SettingsSection>
  );
}
