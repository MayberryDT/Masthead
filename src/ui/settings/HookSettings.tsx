import { useState } from "react";
import type { CodexHookSettingsDto } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

type HookSettingsProps = {
  hooks?: CodexHookSettingsDto;
  busy?: boolean;
  onInstall?: () => void;
  onTest?: () => void;
  onUninstall?: () => void;
};

export function HookSettings({ busy = false, hooks, onInstall, onTest, onUninstall }: HookSettingsProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed" | "unavailable">("idle");

  async function copyEndpoint(): Promise<void> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!hooks?.endpoint || !clipboard?.writeText) {
      setCopyState("unavailable");
      return;
    }
    try {
      await Promise.race([
        clipboard.writeText(hooks.endpoint),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("Clipboard write timed out")), 1000);
        })
      ]);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <SettingsSection eyebrow="Everyday" title="Everyday setup">
      <SettingsRow
        control={
          <div className="settings-inline-actions">
            <AppButton disabled={busy} onClick={hooks?.installed ? onUninstall : onInstall}>
              {hooks?.installed ? "Uninstall" : "Install"}
            </AppButton>
            <AppButton disabled={busy || !hooks?.configExists} onClick={onTest} variant="quiet">
              Test
            </AppButton>
          </div>
        }
        description={hooks?.configPath ?? "Waiting for local settings state."}
        label="Lifecycle hooks"
        value={<StatusBadge tone={hooks?.installed ? "active" : "warning"}>{hooks?.installed ? "Installed" : "Missing"}</StatusBadge>}
      />
      <SettingsRow
        control={
          <AppButton disabled={!hooks?.endpoint} onClick={() => void copyEndpoint()} variant="quiet">
            Copy endpoint
          </AppButton>
        }
        description={
          copyState === "copied"
            ? "Endpoint copied."
            : copyState === "failed"
              ? "Endpoint copy failed."
              : copyState === "unavailable"
                ? "Endpoint copy unavailable."
                : "Codex hooks post sanitized lifecycle events to this local endpoint."
        }
        label="Hook endpoint"
        value={hooks?.endpoint ?? "Unavailable"}
      />
      <SettingsRow
        description={hooks?.lastTest?.message ?? hooks?.error ?? "No hook test has been run from this daemon."}
        label="Last test"
        value={hooks?.lastTest ? `${hooks.lastTest.status} at ${formatDate(hooks.lastTest.testedAt)}` : "Not run"}
      />
      <SettingsRow label="Last event" value={hooks?.lastEventAt ? formatDate(hooks.lastEventAt) : "No events recorded"} />
    </SettingsSection>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
