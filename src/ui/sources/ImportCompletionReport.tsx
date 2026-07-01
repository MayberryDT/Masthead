import type { ImportCompletionReportDto } from "../../shared/sourceImport";

type Props = {
  report: ImportCompletionReportDto;
};

export function ImportCompletionReport({ report }: Props) {
  return (
    <section className="import-completion-report" aria-label="Import report">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">{report.runtime}</p>
          <h3>Import report</h3>
        </div>
        <span className="source-state ready">{report.status.replaceAll("_", " ")}</span>
      </div>
      <dl className="import-report-grid">
        <ReportMetric label="Sessions created" value={report.sessionsCreated} />
        <ReportMetric label="Sessions updated" value={report.sessionsUpdated} />
        <ReportMetric label="Transcripts" value={report.transcriptsImported} />
        <ReportMetric label="Logbook" value={report.logbookSearchableSessions} />
        <ReportMetric label="Dossiers" value={report.dossierReadySessions} />
        <ReportMetric label="MCP visible" value={report.mcpVisibleSessions} />
      </dl>
      {report.nextActions.length > 0 ? (
        <div className="import-report-actions">
          {report.nextActions.map((action) => (
            <span key={action}>{action.replaceAll("_", " ")}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReportMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
