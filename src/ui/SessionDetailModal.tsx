import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SafeAction, SessionDetailView } from "../core/types";
import { SessionInspector } from "./SessionInspector";

type Props = {
  session: SessionDetailView;
  onClose: () => void;
  onAction?: (action: SafeAction, session: SessionDetailView) => void;
  actionStatus?: string;
};

export function SessionDetailModal({ session, onClose, onAction, actionStatus }: Props) {
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    modalRef.current?.focus();
  }, [session.sessionId]);

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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article
        ref={modalRef}
        className="session-detail-modal"
        aria-labelledby={`${session.sessionId}-modal-title`}
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => handleModalKeyDown(event, modalRef.current, onClose)}
        tabIndex={-1}
      >
        <header className="modal-head">
          <div className="modal-session-meta" aria-label="Session summary">
            <span>{session.project}</span>
            <span>{session.lifecycle}</span>
            <span>{session.durationLabel}</span>
          </div>
          <div className="modal-title-row">
            <div>
              <p className="mono-label">Session details</p>
              <h2 id={`${session.sessionId}-modal-title`}>{session.copy.headline}</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close session details" onClick={onClose}>
              x
            </button>
          </div>
        </header>
        <div className="modal-scroll-frame">
          <SessionInspector session={session} onAction={onAction} actionStatus={actionStatus} compactHeader />
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
