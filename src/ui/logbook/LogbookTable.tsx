import { useEffect, useMemo, useRef, useState } from "react";
import type { LogbookSession } from "../HistoryPanel";
import { prefersReducedMotion } from "../motionPreference";
import { logbookColumns } from "./logbookColumns";
import { LogbookRow } from "./LogbookRow";

type Props = {
  animateOnMount?: boolean;
  density: "comfortable" | "compact";
  sessions: LogbookSession[];
  selectedSessionId?: string;
  updating?: boolean;
  onSelect: (sessionId: string) => void;
};

export function LogbookTable({ animateOnMount = false, density, onSelect, selectedSessionId, sessions, updating = false }: Props) {
  const incomingSignature = useMemo(() => sessions.map((session) => session.sessionId).join("|"), [sessions]);
  const [displayedSessions, setDisplayedSessions] = useState(sessions);
  const [outgoingSessions, setOutgoingSessions] = useState<LogbookSession[]>();
  const [mountAnimation, setMountAnimation] = useState(animateOnMount);
  const [swapState, setSwapState] = useState<"idle" | "switching">("idle");
  const displayedRef = useRef(displayedSessions);
  const signatureRef = useRef(incomingSignature);

  useEffect(() => {
    displayedRef.current = displayedSessions;
  }, [displayedSessions]);

  useEffect(() => {
    if (!mountAnimation) return undefined;
    const timer = window.setTimeout(() => setMountAnimation(false), 460);
    return () => window.clearTimeout(timer);
  }, [mountAnimation]);

  useEffect(() => {
    if (incomingSignature === signatureRef.current) return undefined;

    signatureRef.current = incomingSignature;
    const previousSessions = displayedRef.current;

    if (prefersReducedMotion() || previousSessions.length === 0) {
      setDisplayedSessions(sessions);
      setOutgoingSessions(undefined);
      setSwapState("idle");
      return undefined;
    }

    setOutgoingSessions(previousSessions);
    setDisplayedSessions(sessions);
    setSwapState("switching");

    const timer = window.setTimeout(() => {
      setOutgoingSessions(undefined);
      setSwapState("idle");
    }, 300);

    return () => window.clearTimeout(timer);
  }, [incomingSignature, sessions]);

  const wrapClassName = ["logbook-table-wrap", updating ? "is-refreshing" : "", swapState === "switching" ? "is-switching" : "", mountAnimation ? "is-entering" : ""].filter(Boolean).join(" ");

  return (
    <div className={wrapClassName} aria-busy={updating ? "true" : undefined}>
      {outgoingSessions ? (
        <LogbookTableLayer
          ariaHidden
          className="logbook-table-outgoing"
          density={density}
          sessions={outgoingSessions}
          selectedSessionId={selectedSessionId}
          onSelect={onSelect}
        />
      ) : null}
      <LogbookTableLayer
        className="logbook-table-current"
        density={density}
        sessions={displayedSessions}
        selectedSessionId={selectedSessionId}
        onSelect={onSelect}
      />
    </div>
  );
}

function LogbookTableLayer({
  ariaHidden,
  className,
  density,
  onSelect,
  selectedSessionId,
  sessions
}: {
  ariaHidden?: boolean;
  className: string;
  density: "comfortable" | "compact";
  sessions: LogbookSession[];
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <table aria-hidden={ariaHidden} className={`logbook-table ${density === "compact" ? "compact" : ""} ${className}`.trim()}>
      <thead>
        <tr>
          {logbookColumns.map((column) => (
            <th key={column.key} scope="col" className={column.className}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sessions.map((session, rowIndex) => (
          <LogbookRow
            key={session.sessionId}
            density={density}
            rowIndex={rowIndex}
            session={session}
            selected={session.sessionId === selectedSessionId}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}
