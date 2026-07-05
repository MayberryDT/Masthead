import type { CodexHookSettingsDto, HarnessCaptureIntegrationDto } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

type HookAction = "install" | "test" | "uninstall";

type HarnessLiveCaptureSectionProps = {
  busy?: boolean;
  hooks?: CodexHookSettingsDto;
  runtime: string;
  onAction?: (action: HookAction) => Promise<void> | void;
};

export function HarnessLiveCaptureSection({ busy = false, hooks, onAction, runtime }: HarnessLiveCaptureSectionProps) {
  const catalogEntry = harnessForRuntime(runtime as RuntimeKind);
  const integration = hooks?.integrations.find((item) => item.runtime === runtime);
  const label = integration?.label ?? catalogEntry?.label ?? runtime;
  const isLiveHook = integration?.captureMode === "live_hook";
  const actionable = Boolean(integration?.supportsActions) && Boolean(onAction);
  const status = liveCaptureStatus(hooks, integration, runtime, label);

  return (
    <section className="detail-section source-detail-section harness-live-capture" aria-label="Live capture">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">Live capture</p>
          <h3>{label}</h3>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <dl className="harness-live-capture-proof">
        <div>
          <dt>Mode</dt>
          <dd>{isLiveHook ? "Live hook" : "Not wired yet"}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>{isLiveHook ? integration?.configPath ?? hooks?.configPath ?? "No writable hook config" : "No live hook adapter"}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>{isLiveHook ? integration?.endpoint ?? hooks?.endpoint ?? "No live endpoint" : "Not available"}</dd>
        </div>
        <div>
          <dt>Last test</dt>
          <dd>{isLiveHook ? hooks?.lastTest ? `${hooks.lastTest.status} at ${hooks.lastTest.testedAt}` : "Not run" : "Not available"}</dd>
        </div>
        <div>
          <dt>Last event</dt>
          <dd>{isLiveHook ? hooks?.lastEventAt ?? "Not observed" : "Not observed"}</dd>
        </div>
        <div>
          <dt>Backup</dt>
          <dd>{isLiveHook ? hooks?.latestBackupPath ?? "No Masthead backup recorded" : "Not available"}</dd>
        </div>
      </dl>
      {status.message ? <p className="surface-status">{status.message}</p> : null}
      {actionable ? (
        <div className="source-detail-action-buttons">
          <AppButton disabled={busy} onClick={() => void onAction?.("install")}>
            Install/repair live connectors
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.installed} onClick={() => void onAction?.("test")}>
            Test live connectors
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.configExists} onClick={() => void onAction?.("uninstall")}>
            Uninstall live connectors
          </AppButton>
        </div>
      ) : null}
    </section>
  );
}

export function liveCaptureStatusForRuntime(
  hooks: CodexHookSettingsDto | undefined,
  runtime: string
): { label: string; message?: string; tone: StatusBadgeTone } {
  const catalogEntry = harnessForRuntime(runtime as RuntimeKind);
  const integration = hooks?.integrations.find((item) => item.runtime === runtime);
  const label = integration?.label ?? catalogEntry?.label ?? runtime;
  return liveCaptureStatus(hooks, integration, runtime, label);
}

function liveCaptureStatus(
  hooks: CodexHookSettingsDto | undefined,
  integration: HarnessCaptureIntegrationDto | undefined,
  runtime: string,
  label: string
): { label: string; message?: string; tone: StatusBadgeTone } {
  if (!hooks) return { label: "Loading", tone: "neutral" };
  if (integration?.captureMode !== "live_hook") {
    const importNote = integration?.description ?? "Detected history remains available through Sources.";
    return {
      label: "Not wired yet",
      message: `Live capture for ${label} is not wired yet. ${importNote}`,
      tone: "warning"
    };
  }
  if (integration.status === "needs_repair") return { label: "Needs repair", message: hooks.error, tone: hooks.error ? "danger" : "warning" };
  if (integration.status === "installed") {
    return { label: "Installed", tone: "active" };
  }
  return { label: "Not installed", message: `${label} live connector is not installed yet.`, tone: "warning" };
}
