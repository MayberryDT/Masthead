import type { AdapterStatus, SourceStatus } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";
import { SourceDiagnosticPanel, type SourceDiagnostic } from "./SourceDiagnosticPanel";
import { SourcePathTable } from "./SourcePathTable";
import { SourcePolicyControls } from "./SourcePolicyControls";

type AdapterVisualState = AdapterStatus["state"] | "planned";

type SourceLocationWithDiagnostics = SourceStatus & {
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
};

type AdapterRowModel = Omit<AdapterStatus, "state" | "sourceLocations"> & {
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
  discoveredCount?: number;
  implementationState?: string;
  importedCount?: number;
  sourceLocations: SourceLocationWithDiagnostics[];
  state: AdapterVisualState;
};

type Props = {
  adapter: AdapterStatus;
  busy: boolean;
  onChooseLocation?: (runtime: string) => void;
  onEnableTranscriptImport?: (runtime: string) => void;
  onExcludePath: (path: string) => void;
  onImportMetadata?: (runtime: string) => void;
  onImportTranscripts?: (runtime: string) => void;
  onSyncAdapter?: (runtime: string) => void;
};

export function AdapterRow({
  adapter,
  busy,
  onChooseLocation,
  onEnableTranscriptImport,
  onExcludePath,
  onImportMetadata,
  onImportTranscripts,
  onSyncAdapter
}: Props) {
  const view = adapter as AdapterRowModel;
  const state = adapterState(view);
  const isCodexConnected = view.runtime === "codex" && state === "connected";
  const discoveredCount = view.discoveredCount ?? view.discoveredSessions;
  const importedCount = view.importedCount ?? view.importedSessions;

  return (
    <article className={`adapter-row adapter-row-${state}`}>
      <header className="adapter-row-head">
        <div>
          <h2>{runtimeLabel(view.runtime)}</h2>
          <StatusBadge tone={stateTone(state)}>{stateLabel(state)}</StatusBadge>
        </div>
        <dl>
          <div>
            <dt>Discovered</dt>
            <dd>{discoveredCount}</dd>
          </div>
          <div>
            <dt>Imported</dt>
            <dd>{importedCount}</dd>
          </div>
          <div>
            <dt>Synced</dt>
            <dd>{formatLastSync(view.lastSyncAt)}</dd>
          </div>
        </dl>
        <div className="adapter-row-actions">
          {state === "planned" ? (
            <AppButton disabled>Coming later</AppButton>
          ) : isCodexConnected ? (
            <>
              <AppButton
                onClick={() => onImportMetadata?.(view.runtime)}
                disabled={busy || !onImportMetadata}
              >
                Import metadata
              </AppButton>
              <AppButton
                variant="quiet"
                disabled={busy || view.policies.transcriptImport || !onEnableTranscriptImport}
                onClick={() => onEnableTranscriptImport?.(view.runtime)}
              >
                Enable transcript import
              </AppButton>
              <AppButton
                variant="quiet"
                disabled={busy || !view.policies.transcriptImport || !onImportTranscripts}
                onClick={() => onImportTranscripts?.(view.runtime)}
              >
                Import transcripts
              </AppButton>
              <AppButton
                variant="primary"
                disabled={busy || !onSyncAdapter}
                onClick={() => onSyncAdapter?.(view.runtime)}
              >
                Sync all
              </AppButton>
            </>
          ) : (
            <>
              <AppButton disabled={busy || !onSyncAdapter} onClick={() => onSyncAdapter?.(view.runtime)}>
                Sync
              </AppButton>
              <AppButton variant="quiet" disabled={state === "not_detected"}>
                Configure
              </AppButton>
            </>
          )}
        </div>
      </header>
      {state !== "planned" ? <SourcePolicyControls policies={view.policies} /> : null}
      <SourceDiagnosticPanel
        busy={busy}
        checkedPaths={view.checkedPaths}
        diagnostics={view.diagnostics}
        onChooseLocation={onChooseLocation}
        runtime={view.runtime}
        sources={view.sourceLocations}
        state={state}
      />
      {view.sourceLocations.length > 0 ? (
        <SourcePathTable sources={view.sourceLocations} busy={busy} onExcludePath={onExcludePath} />
      ) : null}
    </article>
  );
}

function adapterState(adapter: AdapterRowModel): AdapterVisualState {
  return adapter.implementationState === "planned" ? "planned" : adapter.state;
}

function stateLabel(state: AdapterVisualState): string {
  if (state === "planned") return "Adapter planned";
  if (state === "not_detected") return "Not detected";
  if (state === "degraded") return "Degraded";
  if (state === "disabled") return "Disabled";
  return "Connected";
}

function stateTone(state: AdapterVisualState): StatusBadgeTone {
  if (state === "connected") return "active";
  if (state === "degraded" || state === "not_detected") return "warning";
  if (state === "planned") return "info";
  return "neutral";
}

function runtimeLabel(runtime: string): string {
  const labels: Record<string, string> = {
    aider: "Aider",
    claude_code: "Claude Code",
    codex: "Codex",
    crush: "Crush",
    gemini_cli: "Gemini CLI",
    hermes: "Hermes",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    pi: "Pi"
  };
  return labels[runtime] ?? runtime;
}

function formatLastSync(value: string | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "short" });
}
