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
    <SettingsSection title="Preferences">
      <SettingsRow
        label="Motion"
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
        label="Session notifications"
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
