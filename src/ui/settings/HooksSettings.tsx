import { useState } from "react";
import {
  installCodexHooks,
  testCodexHooks,
  uninstallCodexHooks,
  type CodexHookSettingsDto,
  type HarnessCaptureIntegrationDto,
  type HarnessCaptureStatus
} from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type HooksSettingsProps = {
  baseUrl?: string;
  hooks?: CodexHookSettingsDto;
  readOnly?: boolean;
};

export function HooksSettings({ baseUrl, hooks, readOnly = false }: HooksSettingsProps) {
  const [localHooks, setLocalHooks] = useState<CodexHookSettingsDto>();
  const [repairError, setRepairError] = useState<string>();
  const [activeAction, setActiveAction] = useState<"install" | "test" | "uninstall">();
  const currentHooks = localHooks ?? hooks;
  const disabled = readOnly || Boolean(activeAction);

  async function runHookAction(action: "install" | "test" | "uninstall"): Promise<void> {
    setActiveAction(action);
    try {
      const nextHooks =
        action === "install"
          ? await installCodexHooks(baseUrl)
          : action === "test"
            ? await testCodexHooks(baseUrl)
            : await uninstallCodexHooks(baseUrl);
      setLocalHooks(nextHooks);
      setRepairError(undefined);
    } catch (error: unknown) {
      setRepairError(error instanceof Error ? error.message : String(error));
    } finally {
      setActiveAction(undefined);
    }
  }

  return (
    <SettingsSection
      eyebrow="Capture"
      title="Session capture"
      description="Configure how Masthead collects local session activity across supported harnesses."
    >
      <SettingsRow
        control={
          <div className="settings-inline-actions">
            <AppButton disabled={disabled} onClick={() => void runHookAction("install")} variant="quiet">
              {activeAction === "install" ? "Installing..." : "Install/repair hooks"}
            </AppButton>
            <AppButton disabled={disabled || !currentHooks?.installed} onClick={() => void runHookAction("test")} variant="quiet">
              {activeAction === "test" ? "Testing..." : "Test hooks"}
            </AppButton>
            <AppButton disabled={disabled || !currentHooks?.configExists} onClick={() => void runHookAction("uninstall")} variant="quiet">
              {activeAction === "uninstall" ? "Uninstalling..." : "Uninstall hooks"}
            </AppButton>
          </div>
        }
        description={hookStatusDescription(currentHooks, repairError)}
        label="Live hook status"
        value={<StatusBadge tone={hookStatusTone(currentHooks, repairError)}>{hookStatusLabel(currentHooks, repairError)}</StatusBadge>}
      />
      <SettingsRow
        description="Live local hook ingestion is currently available for Codex. Other supported harnesses are captured through Sources."
        label="Live events"
        value={<StatusBadge tone={currentHooks?.installed ? "active" : "neutral"}>{currentHooks?.installed ? "Enabled" : "Disabled"}</StatusBadge>}
      />
      <SettingsRow
        control={<HarnessCaptureList integrations={currentHooks?.integrations ?? []} />}
        description="Settings manages writable live hooks only where Masthead has a safe installer. Source-backed harnesses stay in Sources."
        label="Supported harnesses"
      />
      <SettingsRow label="Last hook test" value={lastTestLabel(currentHooks)} />
    </SettingsSection>
  );
}

function HarnessCaptureList({ integrations }: { integrations: HarnessCaptureIntegrationDto[] }) {
  if (integrations.length === 0) {
    return <p className="settings-harness-capture-empty">Harness capture support is loading.</p>;
  }

  return (
    <div className="settings-harness-capture-list">
      {integrations.map((integration) => (
        <div className="settings-harness-capture-row" key={integration.runtime}>
          <div className="settings-harness-capture-copy">
            <strong>{integration.label}</strong>
            <span>{integration.description}</span>
          </div>
          <StatusBadge tone={captureStatusTone(integration.status)}>{captureStatusLabel(integration)}</StatusBadge>
        </div>
      ))}
    </div>
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

function lastTestLabel(hooks?: CodexHookSettingsDto): string {
  if (!hooks) return "Loading";
  if (!hooks.lastTest) return "Not run";
  return `${hooks.lastTest.status} at ${hooks.lastTest.testedAt}`;
}

function captureStatusLabel(integration: HarnessCaptureIntegrationDto): string {
  if (integration.status === "managed_in_sources") return "Managed in Sources";
  if (integration.status === "discovery_only") return "Discovery only";
  if (integration.status === "needs_repair") return "Needs repair";
  if (integration.status === "installed") return integration.captureMode === "live_hook" ? "Live hook" : "Enabled";
  return integration.supportsActions ? "Installable" : "Not configured";
}

function captureStatusTone(status: HarnessCaptureStatus): StatusBadgeTone {
  if (status === "installed") return "active";
  if (status === "needs_repair") return "warning";
  if (status === "managed_in_sources") return "info";
  return "neutral";
}
