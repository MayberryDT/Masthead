import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LogbookExcerpt, LogbookSessionDetail, SessionTranscriptKindFilter, SessionTranscriptResult } from "../app/daemonClient";
import type { SessionDossierDto } from "../shared/sessionDossier";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { SessionDossier } from "./session-dossier/SessionDossier";

type Props = {
  session?: LogbookSessionDetail;
  excerpts?: LogbookExcerpt[];
  loading?: boolean;
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
  onClose: () => void;
};

export function SessionLibraryDetail({
  dossier,
  dossierError,
  dossierLoading,
  excerpts = [],
  loading = false,
  onClose,
  onOpenSources,
  onRetryDossier,
  onRetryTranscript,
  onTranscriptFilterChange,
  onTranscriptLoadMore,
  onTranscriptQueryChange,
  session,
  transcript,
  transcriptError,
  transcriptFilter,
  transcriptLoading,
  transcriptQuery
}: Props) {
  const modalRef = useRef<HTMLElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);
  const [modalState, setModalState] = useState<"opening" | "open" | "closing">("opening");
  const titleId = `${session?.sessionId ?? "logbook-loading"}-logbook-modal-title`;
  const modalClassName = [
    "session-detail-modal",
    "logbook-detail-modal",
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
  }, [session?.sessionId]);

  useEffect(() => {
    setModalState("opening");
    const frame = window.requestAnimationFrame(() => setModalState("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [session?.sessionId]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== undefined) window.clearTimeout(closeTimeoutRef.current);
      if (closeFrameRef.current !== undefined) window.cancelAnimationFrame(closeFrameRef.current);
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
    const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150;
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = undefined;
        closeTimeoutRef.current = window.setTimeout(onClose, closeMs);
      });
    });
  };

  if (!session && !loading) return null;

  return (
    <div className={backdropClassName} role="presentation" onClick={requestClose}>
      <article
        ref={modalRef}
        className={modalClassName}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleLogbookModalKeyDown(event, modalRef.current, requestClose)}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-session-meta" aria-label="Logbook session summary">
            <span>{session?.project ?? "Project not captured"}</span>
            <span>{session?.runtime ?? "Runtime not captured"}</span>
            <span>{session?.lifecycle ?? "Loading"}</span>
            <span>{session?.models.join(", ") || "Model not captured"}</span>
          </div>
          <div className="modal-title-row">
            <div>
              <p className="mono-label">Session detail</p>
              <h2 id={titleId}>{session?.title ?? "Loading session"}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close session detail" onClick={requestClose}>
              <Icon name="close" size="toolbar" weight={iconWeights.toolbar} />
            </button>
          </div>
        </header>
        <div className="modal-scroll-frame">
          <SessionDossier
            dossier={dossier}
            loading={loading || dossierLoading}
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
          />
          {!dossier && excerpts.length > 0 ? <span className="sr-only">{excerpts[0]?.text}</span> : null}
        </div>
      </article>
    </div>
  );
}

function handleLogbookModalKeyDown(event: KeyboardEvent, modal: HTMLElement | null, onClose: () => void): void {
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
