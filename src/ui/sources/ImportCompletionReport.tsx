import type { ImportCompletionReportDto } from "../../shared/sourceImport";
import { AppButton } from "../primitives/AppButton";

type Props = {
  report: ImportCompletionReportDto;
  onPreviewRepair?: (importJobId: string) => void;
};

export function ImportCompletionReport({ report, onPreviewRepair }: Props) {
  const needsRepair = report.sessionsRepairRequired > 0 || report.anomalies.some((anomaly) => anomaly.severity === "error");
  const badge = importStatusBadge(report.status, needsRepair);
  const importedUnits = report.sourceUnitsHydrated ?? report.recordsRecognized;
  const otherDeferredUnits = Math.max(0, (report.sourceUnitsDeferred ?? report.cappedUnits) - report.cappedUnits);
  const visibleNextActions = report.nextActions.filter((action) => action !== "repair_import");
  return (
    <section className={`import-completion-report${needsRepair ? " needs-repair" : ""}`} aria-label={`${report.runtime} import report`}>
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">{report.runtime}</p>
          <h3>{needsRepair ? "Needs import repair" : "Import report"}</h3>
        </div>
        <span className={`source-state ${badge.tone}`}>{badge.label}</span>
      </div>
      <p className="import-report-scope-summary">
        {importedUnits.toLocaleString()} {report.cappedUnits > 0 ? "recent" : "source"} units imported
        {report.cappedUnits > 0 ? ` · ${report.cappedUnits.toLocaleString()} recent units deferred by the safety cap` : ""}
        {otherDeferredUnits > 0 ? ` · ${otherDeferredUnits.toLocaleString()} units deferred for other scope reasons` : ""}
      </p>
      <dl className="import-report-grid">
        <ReportMetric label="Recognized records" value={report.recordsRecognized} />
        <ReportMetric label="Rejected records" value={report.recordsRejected} tone={report.recordsRejected ? "warning" : "neutral"} />
        <ReportMetric label="Canonical sessions" value={report.sessionsFinalized} />
        <ReportMetric label="Package path" value={report.sessionsOnPackagePath} />
        <ReportMetric label="Import repair" value={report.sessionsRepairRequired} tone={report.sessionsRepairRequired ? "warning" : "neutral"} />
        <ReportMetric label="Confirmed noise" value={report.sessionsSuppressed} />
        <ReportMetric label="Deferred by cap" value={report.cappedUnits} />
      </dl>
      <div className="import-report-evidence">
        {report.sessionsRepairRequired > 0 ? <p>{report.sessionsRepairRequired.toLocaleString()} sessions need import repair</p> : null}
        {report.recordsRejected > 0 ? <p>Parser rejected {report.recordsRejected.toLocaleString()} source records</p> : null}
        <p>Timestamp basis: {timestampBasisLabel(report.timestampBasis)}</p>
      </div>
      {report.anomalies.length > 0 ? (
        <ul className="import-report-anomalies" aria-label="Import anomalies">
          {report.anomalies.map((anomaly) => (
            <li className={`is-${anomaly.severity}`} key={`${anomaly.code}:${anomaly.message}`}>
              <strong>{anomaly.count.toLocaleString()}</strong> {anomaly.message}
            </li>
          ))}
        </ul>
      ) : null}
      {visibleNextActions.length > 0 ? (
        <div className="import-report-actions">
          {visibleNextActions.map((action) => <span key={action}>{action.replaceAll("_", " ")}</span>)}
        </div>
      ) : null}
      {needsRepair && onPreviewRepair ? (
        <div className="import-report-actions">
          <AppButton variant="quiet" onClick={() => onPreviewRepair(report.importJobId)}>Preview import repair</AppButton>
        </div>
      ) : null}
    </section>
  );
}

function ReportMetric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warning" }) {
  return (
    <div className={tone === "warning" ? "is-warning" : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function importStatusBadge(
  status: ImportCompletionReportDto["status"],
  needsRepair: boolean
): { label: string; tone: "error" | "importing" | "ready" | "warning" } {
  if (status === "failed") return { label: "Failed", tone: "error" };
  if (status === "succeeded_with_issues") {
    return { label: needsRepair ? "Needs import repair" : "Completed with issues", tone: "warning" };
  }
  if (status === "succeeded") {
    return needsRepair ? { label: "Needs import repair", tone: "warning" } : { label: "Completed", tone: "ready" };
  }
  if (status === "stalled") return { label: "Stalled", tone: "warning" };
  return { label: status.replaceAll("_", " "), tone: "importing" };
}

function timestampBasisLabel(timestampBasis: ImportCompletionReportDto["timestampBasis"]): string {
  const labels: Array<[keyof typeof timestampBasis, string]> = [
    ["semantic", "semantic"],
    ["source_path", "source path"],
    ["file_modified", "file modified"],
    ["unknown", "unknown"]
  ];
  return labels
    .filter(([basis]) => timestampBasis[basis] > 0)
    .map(([basis, label]) => `${timestampBasis[basis].toLocaleString()} ${label}`)
    .join(" · ");
}
