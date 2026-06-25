import type { AdapterStatus } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";
import { SourcePathTable } from "./SourcePathTable";
import { SourcePolicyControls } from "./SourcePolicyControls";

type Props = {
  adapter: AdapterStatus;
  busy: boolean;
  onExcludePath: (path: string) => void;
};

export function AdapterRow({ adapter, busy, onExcludePath }: Props) {
  return (
    <article className="adapter-row">
      <header className="adapter-row-head">
        <div>
          <h2>{runtimeLabel(adapter.runtime)}</h2>
          <StatusBadge tone={adapter.state === "connected" ? "active" : adapter.state === "degraded" ? "warning" : "neutral"}>
            {adapter.state.replaceAll("_", " ")}
          </StatusBadge>
        </div>
        <dl>
          <div>
            <dt>Sessions</dt>
            <dd>{adapter.importedSessions}</dd>
          </div>
          <div>
            <dt>Synced</dt>
            <dd>{formatLastSync(adapter.lastSyncAt)}</dd>
          </div>
        </dl>
        <div className="adapter-row-actions">
          <AppButton disabled={busy}>Sync</AppButton>
          <AppButton variant="quiet">Configure</AppButton>
        </div>
      </header>
      <SourcePolicyControls policies={adapter.policies} />
      <SourcePathTable sources={adapter.sourceLocations} busy={busy} onExcludePath={onExcludePath} />
    </article>
  );
}

function runtimeLabel(runtime: string): string {
  return runtime === "codex" ? "Codex" : runtime;
}

function formatLastSync(value: string | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" });
}
