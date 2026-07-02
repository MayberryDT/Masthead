import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsToggle } from "./SettingsToggle";

type PreferencesSettingsProps = {
  motionDisabled?: boolean;
  onMotionDisabledChange?: (disabled: boolean) => void;
};

export function PreferencesSettings({ motionDisabled = false, onMotionDisabledChange }: PreferencesSettingsProps) {
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
    </SettingsSection>
  );
}
