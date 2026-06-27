import type { SourceStatus } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";

type Props = {
  sources: SourceStatus[];
  busy: boolean;
  onExcludePath: (path: string) => void;
};

export function SourcePathTable({ busy, onExcludePath, sources }: Props) {
  return (
    <div className="source-path-table-frame">
      <table className="source-path-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Kind</th>
            <th>Sessions</th>
            <th>Records</th>
            <th>Queued</th>
            <th>Failures</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const path = source.path ?? source.detectedPath ?? source.sourceId;
            return (
              <tr key={source.sourceId}>
                <td>{path}</td>
                <td>{source.sourceKind}</td>
                <td>{source.importedSessions ?? source.sessionCount ?? 0}</td>
                <td>{source.importedRecords ?? source.importedCount ?? 0}</td>
                <td>{source.queuedRecords ?? source.queuedCount ?? 0}</td>
                <td>{source.failureCount ?? source.failures ?? 0}</td>
                <td>
                  {source.path ? (
                    <AppButton variant="quiet" disabled={busy} onClick={() => onExcludePath(source.path ?? "")}>
                      Exclude path
                    </AppButton>
                  ) : (
                    <span className="timestamp">{shortId(source.sourceId)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}
