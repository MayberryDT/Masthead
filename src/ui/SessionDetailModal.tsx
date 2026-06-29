import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SessionTranscriptKindFilter, SessionTranscriptResult } from "../app/daemonClient";
import type { SafeAction, SessionDetailView } from "../core/types";
import type { SessionDossierDto } from "../shared/sessionDossier";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { SessionDossier } from "./session-dossier/SessionDossier";

type Props = {
  session: SessionDetailView;
  onClose: () => void;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
  dossier?: SessionDossierDto;
  dossierLoading?: boolean;
  dossierError?: string;
  onRetryDossier?: () => void;
  transcript?: SessionTranscriptResult;
  transcriptLoading?: boolean;
  transcriptError?: string;
  transcriptFilter?: SessionTranscriptKindFilter;
  transcriptQuery?: string;
  onTranscriptFilterChange?: (filter: SessionTranscriptKindFilter) => void;
  onTranscriptQueryChange?: (query: string) => void;
  onTranscriptLoadMore?: () => void;
  onRetryTranscript?: () => void;
  onOpenSources?: () => void;
};

export function SessionDetailModal({
  actionStatus,
  dossier,
  dossierError,
  dossierLoading,
  onAction,
  onClose,
  onOpenSources,
  onRetryDossier,
  onRetryTranscript,
  onTranscriptFilterChange,
  onTranscriptLoadMore,
  onTranscriptQueryChange,
  transcript,
  transcriptError,
  transcriptFilter,
  transcriptLoading,
  transcriptQuery,
  session
}: Props) {
  const modalRef = useRef<HTMLElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);
  const [modalState, setModalState] = useState<"opening" | "open" | "closing">("opening");
  const modalClassName = [
    "session-detail-modal",
    "t-modal",
    modalState === "closing" ? "is-closing" : "",
    modalState === "open" ? "is-open" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const backdropClassName = [
    "modal-backdrop",
    "t-modal-backdrop",
    modalState === "closing" ? "is-closing" : "",
    modalState === "open" ? "is-open" : "",
    modalState === "opening" ? "is-opening" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    modalRef.current?.focus();
  }, [session.sessionId]);

  useEffect(() => {
    setModalState("opening");
    const frame = window.requestAnimationFrame(() => setModalState("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [session.sessionId]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== undefined) {
        window.clearTimeout(closeTimeoutRef.current);
      }
      if (closeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(closeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  const requestClose = () => {
    if (modalState === "closing") return;
    setModalState("closing");
    const closeMs =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150;
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = undefined;
        closeTimeoutRef.current = window.setTimeout(onClose, closeMs);
      });
    });
  };

  return (
    <div className={backdropClassName} role="presentation" onClick={requestClose}>
      <article
        ref={modalRef}
        className={modalClassName}
        aria-labelledby={`${session.sessionId}-modal-title`}
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, modalRef.current, requestClose)}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-session-meta" aria-label="Session summary">
            <span>{session.project}</span>
            <span>{session.lifecycle}</span>
            <span>{session.durationLabel}</span>
            <span>Thinking {session.thinkingLevel ?? "Not captured"}</span>
          </div>
          <div className="modal-title-row">
            <div>
              <p className="mono-label">Session details</p>
              <h2 id={`${session.sessionId}-modal-title`}>{session.copy.headline}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close session details" onClick={requestClose}>
              <Icon name="close" size="toolbar" weight={iconWeights.toolbar} />
            </button>
          </div>
        </header>
        <div className="modal-scroll-frame">
          <SessionDossier
            live={session}
            dossier={dossier}
            loading={dossierLoading}
            error={dossierError}
            onRetry={onRetryDossier}
            transcript={transcript}
            transcriptLoading={transcriptLoading}
            transcriptError={transcriptError}
            transcriptFilter={transcriptFilter}
            transcriptQuery={transcriptQuery}
            onTranscriptFilterChange={onTranscriptFilterChange}
            onTranscriptQueryChange={onTranscriptQueryChange}
            onTranscriptLoadMore={onTranscriptLoadMore}
            onTranscriptRetry={onRetryTranscript}
            onOpenSources={onOpenSources}
            onAction={onAction}
            actionStatus={actionStatus}
          />
        </div>
      </article>
    </div>
  );
}

function handleModalKeyDown(event: KeyboardEvent, modal: HTMLElement | null, onClose: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab" || !modal) return;

  const focusable = [
    ...modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((element) => element.offsetParent !== null || element === document.activeElement);
  if (focusable.length === 0) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
