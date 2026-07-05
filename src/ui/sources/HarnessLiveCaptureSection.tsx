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
  const isCodex = runtime === "codex";
  const actionable = isCodex && Boolean(integration?.supportsActions) && Boolean(onAction);
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
          <dd>{isCodex && integration?.captureMode === "live_hook" ? "Live hook" : "Not wired yet"}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>{isCodex ? hooks?.configPath ?? integration?.configPath ?? "No writable hook config" : "No live hook adapter"}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>{isCodex ? hooks?.endpoint ?? "No live endpoint" : "Not available"}</dd>
        </div>
        <div>
          <dt>Last test</dt>
          <dd>{isCodex ? hooks?.lastTest ? `${hooks.lastTest.status} at ${hooks.lastTest.testedAt}` : "Not run" : "Not available"}</dd>
        </div>
        <div>
          <dt>Last event</dt>
          <dd>{isCodex ? hooks?.lastEventAt ?? "Not observed" : "Not observed"}</dd>
        </div>
        <div>
          <dt>Backup</dt>
          <dd>{isCodex ? hooks?.latestBackupPath ?? "No Masthead backup recorded" : "Not available"}</dd>
        </div>
      </dl>
      {status.message ? <p className="surface-status">{status.message}</p> : null}
      {actionable ? (
        <div className="source-detail-action-buttons">
          <AppButton disabled={busy} onClick={() => void onAction?.("install")}>
            Install/repair hooks
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.installed} onClick={() => void onAction?.("test")}>
            Test hooks
          </AppButton>
          <AppButton variant="quiet" disabled={busy || !hooks?.configExists} onClick={() => void onAction?.("uninstall")}>
            Uninstall hooks
          </AppButton>
        </div>
      ) : null}
    </section>
  );
}

function liveCaptureStatus(
  hooks: CodexHookSettingsDto | undefined,
  integration: HarnessCaptureIntegrationDto | undefined,
  runtime: string,
  label: string
): { label: string; message?: string; tone: StatusBadgeTone } {
  if (runtime !== "codex") {
    const importNote = integration?.description ?? "Detected history remains available through Sources.";
    return {
      label: "Not wired yet",
      message: `Live capture for ${label} is not wired yet. ${importNote}`,
      tone: "warning"
    };
  }
  if (!hooks) return { label: "Loading", tone: "neutral" };
  if (hooks.error) return { label: "Needs repair", message: hooks.error, tone: "danger" };
  if (hooks.installed && hooks.missingEvents.length === 0 && hooks.mismatchedEvents.length === 0) {
    return { label: "Installed", tone: "active" };
  }
  if (hooks.configExists) {
    return {
      label: "Needs repair",
      message: "Hook configuration is present but does not match Masthead's expected capture events.",
      tone: "warning"
    };
  }
  return { label: "Not installed", message: "Codex hook configuration is not installed yet.", tone: "warning" };
}
