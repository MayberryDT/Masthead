import { AppButton } from "../primitives/AppButton";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type OnboardingSettingsProps = {
  onOpenOnboarding?: () => void;
  readOnly?: boolean;
};

export function OnboardingSettings({ onOpenOnboarding, readOnly = false }: OnboardingSettingsProps) {
  return (
    <SettingsSection
      title="Onboarding"
      description="Reopen first-run setup for source detection, live capture, imports, and enrichment configuration."
    >
      <SettingsRow
        control={
          <AppButton disabled={readOnly || !onOpenOnboarding} onClick={onOpenOnboarding}>
            Run onboarding again
          </AppButton>
        }
        description="The wizard uses the same setup controls as Sources harness details."
        label="Setup wizard"
      />
    </SettingsSection>
  );
}
