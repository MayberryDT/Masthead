import type { LogbookSession } from "../HistoryPanel";
import { logbookColumns } from "./logbookColumns";
import { LogbookRow } from "./LogbookRow";

type Props = {
  density: "comfortable" | "compact";
  sessions: LogbookSession[];
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
};

export function LogbookTable({ density, onSelect, selectedSessionId, sessions }: Props) {
  return (
    <div className="logbook-table-wrap">
      <table className={`logbook-table ${density === "compact" ? "compact" : ""}`.trim()}>
        <thead>
          <tr>
            {logbookColumns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <LogbookRow
              key={session.sessionId}
              density={density}
              session={session}
              selected={session.sessionId === selectedSessionId}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
