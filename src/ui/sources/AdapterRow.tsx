import type { AdapterStatus, SourceStatus } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";
import type { SourceDiagnostic } from "./SourceDiagnosticPanel";

export type AdapterVisualState = AdapterStatus["state"] | "planned";

type SourceLocationWithDiagnostics = SourceStatus & {
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
};

export type AdapterRowModel = Omit<AdapterStatus, "state" | "sourceLocations"> & {
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
  discoveredCount?: number;
  implementationState?: string;
  importedCount?: number;
  failureCount?: number;
  sourceLocationCount?: number;
  sourceLocations: SourceLocationWithDiagnostics[];
  state: AdapterVisualState;
};

type Props = {
  adapter: AdapterStatus;
  busy: boolean;
  checked?: boolean;
  onOpenDetails?: (runtime: string) => void;
  onToggleSelected?: (runtime: string, checked: boolean) => void;
};

export function AdapterRow({
  adapter,
  busy,
  checked = false,
  onOpenDetails,
  onToggleSelected
}: Props) {
  const view = adapter as AdapterRowModel;
  const state = adapterState(view);
  const discoveredCount = view.discoveredCount ?? view.discoveredSessions;
  const importedCount = view.importedCount ?? view.importedSessions;
  const sourceCount = view.sourceLocationCount ?? view.sourceLocations.length;
  const diagnosticCount = [
    ...(view.diagnostics ?? []),
    ...view.sourceLocations.flatMap((source) => source.diagnostics ?? [])
  ].reduce((count, diagnostic) => count + (diagnostic.message || diagnostic.code || diagnostic.details ? diagnostic.count ?? 1 : 0), 0);
  const failureCount = view.failureCount ?? view.sourceLocations.reduce(
    (total, source) => total + (source.failureCount ?? source.failures ?? 0),
    0
  );

  return (
    <article
      className={`adapter-card adapter-card-${state}`}
      aria-label={`${runtimeLabel(view.runtime)} source adapter`}
      onClick={() => onOpenDetails?.(view.runtime)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenDetails?.(view.runtime);
      }}
      tabIndex={0}
    >
      <header className="adapter-card-head">
        <div className="adapter-card-title-row">
          <label className="adapter-card-select" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || state === "planned"}
              onChange={(event) => onToggleSelected?.(view.runtime, event.currentTarget.checked)}
              aria-label={`Select ${runtimeLabel(view.runtime)}`}
            />
            <h2>{runtimeLabel(view.runtime)}</h2>
          </label>
          <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
        </div>
      </header>

      <dl className="adapter-card-metrics">
        <div>
          <dt>Discovered</dt>
          <dd>{discoveredCount}</dd>
        </div>
        <div>
          <dt>Imported</dt>
          <dd>{importedCount}</dd>
        </div>
        <div>
          <dt>Locations</dt>
          <dd>{sourceCount}</dd>
        </div>
        <div>
          <dt>Issues</dt>
          <dd>{diagnosticCount + failureCount}</dd>
        </div>
        <div>
          <dt>Live</dt>
          <dd>{view.lastSyncAt ? "Observed" : "Idle"}</dd>
        </div>
      </dl>

      <footer className="adapter-card-footer">
        <span>{formatLastSync(view.lastSyncAt)}</span>
        <AppButton
          variant="quiet"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetails?.(view.runtime);
          }}
        >
          Details
        </AppButton>
      </footer>
    </article>
  );
}

export function adapterState(adapter: AdapterRowModel): AdapterVisualState {
  return adapter.implementationState === "planned" ? "planned" : adapter.state;
}

export function stateLabel(state: AdapterVisualState): string {
  if (state === "planned") return "Adapter planned";
  if (state === "not_detected") return "Not detected";
  if (state === "degraded") return "Degraded";
  if (state === "disabled") return "Disabled";
  return "Connected";
}

export function stateTone(state: AdapterVisualState): StatusBadgeTone {
  if (state === "connected") return "active";
  if (state === "degraded" || state === "not_detected") return "warning";
  if (state === "planned") return "info";
  return "neutral";
}

export function runtimeLabel(runtime: string): string {
  const labels: Record<string, string> = {
    aider: "Aider",
    claude_code: "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    gemini_cli: "Gemini CLI",
    hermes: "Hermes",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    pi: "Pi"
  };
  return labels[runtime] ?? runtime;
}

export function formatLastSync(value: string | undefined): string {
  if (!value) return "Never synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `Synced ${date.toLocaleString([], { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" })}`;
}
