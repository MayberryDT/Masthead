import { useState } from "react";
import {
  installCodexHooks,
  type CodexHookSettingsDto
} from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import { SettingsToggle } from "./SettingsToggle";

type HooksSettingsProps = {
  baseUrl?: string;
  hooks?: CodexHookSettingsDto;
  readOnly?: boolean;
};

export function HooksSettings({ baseUrl, hooks, readOnly = false }: HooksSettingsProps) {
  const [localHooks, setLocalHooks] = useState<CodexHookSettingsDto>();
  const [repairError, setRepairError] = useState<string>();
  const [repairing, setRepairing] = useState(false);
  const currentHooks = localHooks ?? hooks;
  const disabled = readOnly || repairing;

  async function repairHooks(): Promise<void> {
    setRepairing(true);
    try {
      setLocalHooks(await installCodexHooks(baseUrl));
      setRepairError(undefined);
    } catch (error: unknown) {
      setRepairError(error instanceof Error ? error.message : String(error));
    } finally {
      setRepairing(false);
    }
  }

  return (
    <SettingsSection
      eyebrow="Hooks"
      title="Codex hooks"
      description="Local shell hooks keep active sessions visible without changing harness files."
    >
      <SettingsRow
        control={
          <AppButton disabled={disabled} onClick={() => void repairHooks()} variant="quiet">
            {repairing ? "Repairing..." : "Repair hooks"}
          </AppButton>
        }
        description={hookStatusDescription(currentHooks, repairError)}
        label="Hook status"
        value={<StatusBadge tone={hookStatusTone(currentHooks, repairError)}>{hookStatusLabel(currentHooks, repairError)}</StatusBadge>}
      />
      <SettingsRow
        control={<SettingsToggle label="Capture mode" checked={Boolean(currentHooks?.installed)} />}
        description="Session metadata and redacted command events only."
        label="Capture mode"
      />
    </SettingsSection>
  );
}

function hookStatusLabel(hooks?: CodexHookSettingsDto, error?: string): string {
  if (error) return "Needs repair";
  if (!hooks) return "Loading";
  if (hooks.installed && hooks.missingEvents.length === 0 && hooks.mismatchedEvents.length === 0) return "Installed";
  if (hooks.configExists) return "Needs repair";
  return "Not installed";
}

function hookStatusTone(hooks?: CodexHookSettingsDto, error?: string): StatusBadgeTone {
  if (error) return "danger";
  if (!hooks) return "neutral";
  if (hooks.installed && hooks.missingEvents.length === 0 && hooks.mismatchedEvents.length === 0) return "active";
  return "warning";
}

function hookStatusDescription(hooks?: CodexHookSettingsDto, error?: string): string {
  if (error) return error;
  if (!hooks) return "Loading project hook integration for the active Masthead database.";
  if (hooks.installed && hooks.missingEvents.length === 0 && hooks.mismatchedEvents.length === 0) {
    return "Project hook integration for the active Masthead database.";
  }
  if (!hooks.configExists) return "Codex hook configuration is not installed yet.";
  return "Hook configuration is present but does not match Masthead's expected capture events.";
}
