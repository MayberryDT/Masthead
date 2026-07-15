import type { ImportCompletionReportDto } from "../../shared/sourceImport";
import { AppButton } from "../primitives/AppButton";

type Props = {
  report: ImportCompletionReportDto;
  onPreviewRepair?: (importJobId: string) => void;
};

export function ImportCompletionReport({ report, onPreviewRepair }: Props) {
  const needsRepair = report.sessionsRepairRequired > 0 || report.anomalies.some((anomaly) => anomaly.severity === "error");
  const importedUnits = report.sourceUnitsHydrated ?? report.recordsRecognized;
  const deferredUnits = report.sourceUnitsDeferred ?? report.cappedUnits;
  return (
    <section className={`import-completion-report${needsRepair ? " needs-repair" : ""}`} aria-label={`${report.runtime} import report`}>
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">{report.runtime}</p>
          <h3>{needsRepair ? "Needs import repair" : "Import report"}</h3>
        </div>
        <span className={`source-state ${needsRepair ? "warning" : "ready"}`}>
          {needsRepair ? "Needs import repair" : importStatusLabel(report.status)}
        </span>
      </div>
      <p className="import-report-scope-summary">
        {importedUnits.toLocaleString()} {report.cappedUnits > 0 ? "recent" : "source"} units imported
        {deferredUnits > 0 ? ` · ${deferredUnits.toLocaleString()} recent units deferred by the safety cap` : ""}
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

function importStatusLabel(status: ImportCompletionReportDto["status"]): string {
  if (status === "succeeded") return "Completed";
  if (status === "succeeded_with_issues") return "Completed with issues";
  return status.replaceAll("_", " ");
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
