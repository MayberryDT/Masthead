import { useEffect, useMemo, useRef, useState } from "react";
import type { LogbookSession } from "../HistoryPanel";
import { prefersReducedMotion } from "../motionPreference";
import { logbookColumns } from "./logbookColumns";
import { LogbookRow } from "./LogbookRow";
import {
  rowKind,
  selectionStateForRow,
} from "../../app/logbook/mastheadPagesSelection";

type Props = {
  animateOnMount?: boolean;
  density: "comfortable" | "compact";
  sessions: LogbookSession[];
  selectedSessionId?: string;
  updating?: boolean;
  onSelect: (sessionId: string) => void;
  selectedArtifactIds?: readonly string[];
  onArtifactSelectedChange?: (artifactId: string, selected: boolean) => void;
  onCurrentPageSelectedChange?: (
    artifactIds: readonly string[],
    selected: boolean,
  ) => void;
};

export function LogbookTable({
  animateOnMount = false,
  density,
  onArtifactSelectedChange,
  onCurrentPageSelectedChange,
  onSelect,
  selectedArtifactIds = [],
  selectedSessionId,
  sessions,
  updating = false,
}: Props) {
  const incomingSignature = useMemo(
    () => sessions.map((session) => session.sessionId).join("|"),
    [sessions],
  );
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
    if (incomingSignature === signatureRef.current) {
      setDisplayedSessions(sessions);
      setOutgoingSessions(undefined);
      setSwapState("idle");
      return undefined;
    }

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

  const wrapClassName = [
    "logbook-table-wrap",
    updating ? "is-refreshing" : "",
    swapState === "switching" ? "is-switching" : "",
    mountAnimation ? "is-entering" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClassName} aria-busy={updating ? "true" : undefined}>
      {outgoingSessions ? (
        <LogbookTableLayer
          ariaHidden
          className="logbook-table-outgoing"
          density={density}
          sessions={outgoingSessions}
          selectedSessionId={selectedSessionId}
          selectedArtifactIds={selectedArtifactIds}
          onArtifactSelectedChange={onArtifactSelectedChange}
          onCurrentPageSelectedChange={onCurrentPageSelectedChange}
          onSelect={onSelect}
        />
      ) : null}
      <LogbookTableLayer
        className="logbook-table-current"
        density={density}
        sessions={displayedSessions}
        selectedSessionId={selectedSessionId}
        selectedArtifactIds={selectedArtifactIds}
        onArtifactSelectedChange={onArtifactSelectedChange}
        onCurrentPageSelectedChange={onCurrentPageSelectedChange}
        onSelect={onSelect}
      />
    </div>
  );
}

function LogbookTableLayer({
  ariaHidden,
  className,
  density,
  onArtifactSelectedChange,
  onCurrentPageSelectedChange,
  onSelect,
  selectedArtifactIds = [],
  selectedSessionId,
  sessions,
}: {
  ariaHidden?: boolean;
  className: string;
  density: "comfortable" | "compact";
  sessions: LogbookSession[];
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
  selectedArtifactIds?: readonly string[];
  onArtifactSelectedChange?: (artifactId: string, selected: boolean) => void;
  onCurrentPageSelectedChange?: (
    artifactIds: readonly string[],
    selected: boolean,
  ) => void;
}) {
  const eligibleArtifactIds = sessions
    .filter(
      (session) =>
        !selectionStateForRow({
          selectedArtifactIds,
          sessionId: session.sessionId,
          kind: rowKind(session),
        }).disabled,
    )
    .map((session) => session.sessionId);
  const selectedIds = new Set(selectedArtifactIds);
  const selectedOnPage = eligibleArtifactIds.filter((artifactId) =>
    selectedIds.has(artifactId),
  ).length;
  const allOnPageSelected =
    eligibleArtifactIds.length > 0 &&
    selectedOnPage === eligibleArtifactIds.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  return (
    <table
      aria-hidden={ariaHidden}
      className={`logbook-table ${density === "compact" ? "compact" : ""} ${className}`.trim()}
    >
      <thead>
        <tr>
          <th scope="col" className="logbook-col-select">
            {ariaHidden ? (
              <span className="visually-hidden">Select</span>
            ) : (
              <label
                className="logbook-page-select-all masthead-checkbox-control"
                title="Select all eligible Pages on this page"
              >
                <input
                  ref={selectAllRef}
                  aria-label="Select all eligible Pages on this page"
                  checked={allOnPageSelected}
                  disabled={eligibleArtifactIds.length === 0}
                  type="checkbox"
                  onChange={(event) =>
                    onCurrentPageSelectedChange?.(
                      eligibleArtifactIds,
                      event.currentTarget.checked,
                    )
                  }
                />
                <span className="visually-hidden">
                  Select all eligible Pages on this page
                </span>
              </label>
            )}
          </th>
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
            selectedArtifactIds={selectedArtifactIds}
            onArtifactSelectedChange={onArtifactSelectedChange}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}
