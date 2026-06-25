import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

export type SourceDiagnostic = {
  code?: string;
  details?: string;
  message?: string;
  path?: string;
  severity?: "info" | "warning" | "error" | string;
};

type SourceDiagnosticSource = {
  checkedPaths?: string[];
  detectedPath?: string;
  diagnostics?: SourceDiagnostic[];
  path?: string;
  sourceId: string;
};

type Props = {
  busy: boolean;
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
  onChooseLocation?: (runtime: string) => void;
  runtime: string;
  sources: SourceDiagnosticSource[];
  state: "connected" | "degraded" | "disabled" | "not_detected" | "planned";
};

export function SourceDiagnosticPanel({
  busy,
  checkedPaths,
  diagnostics,
  onChooseLocation,
  runtime,
  sources,
  state
}: Props) {
  const diagnosticRows = collectDiagnostics(diagnostics, sources);
  const checked = collectCheckedPaths(checkedPaths, sources);

  if (state !== "degraded" && state !== "not_detected" && diagnosticRows.length === 0) return null;

  return (
    <section className={`source-diagnostic-panel source-diagnostic-panel-${state}`} aria-label="Adapter diagnostics">
      <div className="source-diagnostic-summary">
        <div>
          <p className="mono-label">DIAGNOSTICS</p>
          <h3>{state === "not_detected" ? "No supported store detected" : "Adapter needs attention"}</h3>
          <p>
            {state === "not_detected"
              ? "Masthead checked the usual local paths for this runtime. Choose a location if the history store lives somewhere else."
              : "Masthead can still show discovered records, but these diagnostics explain what needs repair before the adapter is fully healthy."}
          </p>
        </div>
        {state === "not_detected" ? (
          <AppButton variant="quiet" disabled={busy || !onChooseLocation} onClick={() => onChooseLocation?.(runtime)}>
            Choose location
          </AppButton>
        ) : null}
      </div>

      {checked.length > 0 ? (
        <div className="source-checked-paths">
          <p className="mono-label">Checked paths</p>
          <ul>
            {checked.map((path) => (
              <li key={path} title={path}>
                {path}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diagnosticRows.length > 0 ? (
        <ul className="source-diagnostic-list">
          {diagnosticRows.map((diagnostic, index) => (
            <li key={`${diagnostic.code ?? diagnostic.message ?? "diagnostic"}-${index}`}>
              <StatusBadge tone={diagnosticTone(diagnostic.severity)}>{diagnostic.severity ?? "warning"}</StatusBadge>
              <div>
                <strong>{diagnostic.message ?? diagnostic.code ?? "Adapter diagnostic"}</strong>
                {diagnostic.details || diagnostic.path || diagnostic.code ? (
                  <p>
                    {[diagnostic.code, diagnostic.path, diagnostic.details].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function collectDiagnostics(diagnostics: SourceDiagnostic[] | undefined, sources: SourceDiagnosticSource[]): SourceDiagnostic[] {
  return [...(diagnostics ?? []), ...sources.flatMap((source) => source.diagnostics ?? [])].filter(
    (diagnostic) => diagnostic.message || diagnostic.code || diagnostic.details
  );
}

function collectCheckedPaths(checkedPaths: string[] | undefined, sources: SourceDiagnosticSource[]): string[] {
  return Array.from(
    new Set([
      ...(checkedPaths ?? []),
      ...sources.flatMap((source) => source.checkedPaths ?? []),
      ...sources.map((source) => source.detectedPath).filter(Boolean)
    ])
  ) as string[];
}

function diagnosticTone(severity: SourceDiagnostic["severity"]): StatusBadgeTone {
  if (severity === "error") return "danger";
  if (severity === "info") return "info";
  return "warning";
}
