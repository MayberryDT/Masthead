import { useEffect, useMemo, useRef, useState } from "react";
import { canImportHarness, harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import type { AdapterStatus, SourcesImportPreview } from "../../app/daemonClient";
import type { ImportCompletionReportDto, ImportScopeDto } from "../../shared/sourceImport";
import type { SourcesSetupRunInput } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";
import { HarnessImportCard } from "./HarnessImportCard";
import { ImportCompletionReport } from "./ImportCompletionReport";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  open: boolean;
  previews?: SourcesImportPreview[];
  completionReports?: ImportCompletionReportDto[];
  onClose: () => void;
  onPreviewImport?: (input: SourcesSetupRunInput) => Promise<SourcesImportPreview[]> | SourcesImportPreview[];
  onRunSetup?: (input: SourcesSetupRunInput) => Promise<unknown> | unknown;
  onPreviewRepair?: (importJobId: string) => void;
  receiptError?: string;
  receiptJobId?: string;
  receiptLoading?: boolean;
  receiptOnly?: boolean;
};

type ScopeChoice = "recent" | "full";

export function SourcesImportModal({
  adapters,
  busy = false,
  completionReports = [],
  onClose,
  onPreviewImport,
  onPreviewRepair,
  onRunSetup,
  open,
  previews: externalPreviews,
  receiptError,
  receiptJobId,
  receiptLoading = false,
  receiptOnly = false
}: Props) {
  const modalRef = useRef<HTMLElement>(null);
  const closeTimeoutRef = useRef<number | undefined>(undefined);
  const closeFrameRef = useRef<number | undefined>(undefined);
  const autoPreviewRequestedRef = useRef(false);
  const [modalState, setModalState] = useState<"opening" | "open" | "closing">("opening");
  const [modalSettled, setModalSettled] = useState(false);
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("recent");
  const [localPreviews, setLocalPreviews] = useState<SourcesImportPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previews = externalPreviews ?? localPreviews;
  const importableAdapters = useMemo(() => adapters.filter((adapter) => adapter.state !== "not_detected" && adapter.state !== "planned" && runtimeCanImport(adapter.runtime)), [adapters]);
  const importableChoices = useMemo(() => choicesFromAdaptersAndPreviews(importableAdapters, previews), [importableAdapters, previews]);
  const choiceRuntimes = useMemo(() => importableChoices.map((choice) => choice.adapter.runtime), [importableChoices]);
  const choiceRuntimeSet = useMemo(() => new Set(choiceRuntimes), [choiceRuntimes]);
  const choiceRuntimeKey = choiceRuntimes.join("\u0000");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(choiceRuntimes));
  const selectedRuntimes = Array.from(selected).filter((runtime) => choiceRuntimeSet.has(runtime));
  const scope = scopeForChoice(scopeChoice);
  const modalClassName = [
    "session-detail-modal",
    "sources-import-modal",
    "t-modal",
    modalSettled ? "is-settled" : "",
    modalState === "closing" ? "is-closing" : "",
    modalState === "open" ? "is-open" : "",
    modalState === "opening" ? "is-opening" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const backdropClassName = [
    "modal-backdrop",
    "sources-import-backdrop",
    "t-modal-backdrop",
    modalState === "closing" ? "is-closing" : "",
    modalState === "open" ? "is-open" : "",
    modalState === "opening" ? "is-opening" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!open) return undefined;
    setModalState("opening");
    setModalSettled(false);
    const frame = window.requestAnimationFrame(() => setModalState("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    modalRef.current?.focus();
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== undefined) window.clearTimeout(closeTimeoutRef.current);
      if (closeFrameRef.current !== undefined) window.cancelAnimationFrame(closeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (choiceRuntimes.length === 0) return;
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((runtime) => choiceRuntimeSet.has(runtime)));
      let changed = next.size !== current.size;
      for (const runtime of choiceRuntimes) {
        if (next.has(runtime)) continue;
        next.add(runtime);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [choiceRuntimeKey, choiceRuntimes, choiceRuntimeSet]);

  useEffect(() => {
    if (!open) {
      autoPreviewRequestedRef.current = false;
      return undefined;
    }
    if (externalPreviews || localPreviews.length > 0 || !onPreviewImport || autoPreviewRequestedRef.current) return undefined;

    let cancelled = false;
    autoPreviewRequestedRef.current = true;
    setPreviewLoading(true);
    void Promise.resolve(onPreviewImport(buildPreviewInput(scopeChoice, importableAdapters.map((adapter) => adapter.runtime))))
      .then((result) => {
        if (!cancelled && result) setLocalPreviews(result);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [externalPreviews, importableAdapters, localPreviews.length, onPreviewImport, open, scopeChoice]);

  if (!open) return null;

  const requestClose = () => {
    if (modalState === "closing") return;
    setModalSettled(false);
    setModalState("closing");
    const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur")) || 150;
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = window.requestAnimationFrame(() => {
        closeFrameRef.current = undefined;
        closeTimeoutRef.current = window.setTimeout(onClose, closeMs);
      });
    });
  };

  const updateSelected = (runtime: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(runtime);
      else next.delete(runtime);
      return next;
    });
  };

  const preview = async (choice = scopeChoice) => {
    setPreviewLoading(true);
    try {
      const result = await onPreviewImport?.(buildPreviewInput(choice, selectedRuntimes));
      if (result) setLocalPreviews(result);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runImport = async () => {
    await onRunSetup?.({
      importMetadata: true,
      importScope: scope,
      queueEnrichment: true,
      runtimes: selectedRuntimes
    });
    onClose();
  };

  return (
    <div className={backdropClassName} role="presentation" onClick={requestClose}>
      <section
        ref={modalRef}
        className={modalClassName}
        role="dialog"
        aria-modal="true"
        aria-label={receiptOnly ? "Import receipt" : "Import history"}
        onAnimationEnd={() => {
          if (modalState === "open") setModalSettled(true);
        }}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <header className="modal-head sources-import-head">
          <div className="modal-title-row">
            <div>
              <div className="modal-session-meta" aria-label={receiptOnly ? "Import receipt selection" : "Import selection"}>
                {receiptOnly ? <span>{receiptJobId ?? "Receipt"}</span> : <>
                  <span>{importableChoices.length} harnesses</span>
                  <span>{selectedRuntimes.length} selected</span>
                </>}
              </div>
              <h2>{receiptOnly ? "Import receipt" : "Import history"}</h2>
            </div>
            <div className="modal-head-actions">
              <AppButton type="button" variant="quiet" onClick={requestClose}>Close</AppButton>
            </div>
          </div>
        </header>
        <div className="modal-scroll-frame sources-import-scroll">
          <div className="modal-content sources-import-content">
            {receiptOnly ? (
              <section className="sources-import-panel" aria-label="Requested import receipt">
                {receiptLoading ? <p className="sources-import-empty" role="status">Loading import receipt {receiptJobId}…</p> : null}
                {receiptError ? <p className="surface-status status-error" role="alert">{receiptError}</p> : null}
                {completionReports.map((report) => (
                  <ImportCompletionReport report={report} onPreviewRepair={onPreviewRepair} key={report.importJobId} />
                ))}
              </section>
            ) : <>
            <section className="sources-import-panel">
              <div className="sources-import-section-head">
                <h3>Harnesses</h3>
                <span>{selectedRuntimes.length} selected</span>
              </div>
              {importableChoices.length > 0 ? (
                <div className="source-adapter-grid sources-import-harness-grid">
                  {importableChoices.map(({ adapter, preview }) => (
                    <HarnessImportCard
                      adapter={adapter}
                      checked={selected.has(adapter.runtime)}
                      disabled={busy}
                      loading={previewLoading && !preview}
                      metrics={preview ? previewMetrics(preview) : undefined}
                      key={adapter.runtime}
                      onToggle={updateSelected}
                    />
                  ))}
                </div>
              ) : (
                <p className="sources-import-empty">{previewLoading ? "Checking harnesses..." : "No importable harnesses found."}</p>
              )}
            </section>

            <section className="sources-import-panel">
              <div className="sources-import-section-head">
                <h3>Range</h3>
              </div>
              <div className="source-choice-list sources-import-range-list">
                <label className="source-choice">
                  <input
                    type="radio"
                    name="sources-import-range"
                    checked={scopeChoice === "recent"}
                    onChange={() => {
                      setScopeChoice("recent");
                      void preview("recent");
                    }}
                  />
                  <span>
                    <strong>Recent</strong>
                    <small>Last 30 days</small>
                  </span>
                </label>
                <label className="source-choice">
                  <input
                    type="radio"
                    name="sources-import-range"
                    checked={scopeChoice === "full"}
                    onChange={() => {
                      setScopeChoice("full");
                      void preview("full");
                    }}
                  />
                  <span>
                    <strong>Full archive</strong>
                    <small>All detected history</small>
                  </span>
                </label>
              </div>
            </section>

            {completionReports.length > 0 ? (
              <section className="sources-import-panel" aria-label="Recent import receipts">
                <div className="sources-import-section-head">
                  <h3>Recent import receipts</h3>
                  <span>{completionReports.length} harness{completionReports.length === 1 ? "" : "es"}</span>
                </div>
                {completionReports.map((report) => (
                  <ImportCompletionReport report={report} onPreviewRepair={onPreviewRepair} key={report.importJobId} />
                ))}
              </section>
            ) : null}

            </>}
          </div>
        </div>
        {!receiptOnly ? <footer className="sources-import-footer">
          <AppButton type="button" variant="primary" onClick={() => void runImport()} disabled={busy || selectedRuntimes.length === 0}>
            Import data
          </AppButton>
        </footer> : null}
      </section>
    </div>
  );
}

function choicesFromAdaptersAndPreviews(adapters: AdapterStatus[], previews: SourcesImportPreview[]): Array<{ adapter: AdapterStatus; preview?: SourcesImportPreview }> {
  const byRuntime = new Map(adapters.map((adapter) => [adapter.runtime, { adapter, preview: previews.find((preview) => preview.runtime === adapter.runtime) }]));
  for (const preview of previews) {
    if (!runtimeCanImport(preview.runtime)) continue;
    if (byRuntime.has(preview.runtime)) continue;
    byRuntime.set(preview.runtime, { adapter: adapterFromPreview(preview), preview });
  }
  return Array.from(byRuntime.values());
}

function buildPreviewInput(choice: ScopeChoice, runtimes: string[]): SourcesSetupRunInput {
  return {
    importMetadata: true,
    importScope: scopeForChoice(choice),
    queueEnrichment: true,
    runtimes
  };
}

function adapterFromPreview(preview: SourcesImportPreview): AdapterStatus {
  return {
    discoveredSessions: preview.summary.estimatedRecords ?? 0,
    importedSessions: 0,
    policies: { enrichment: true, mcpAccess: true, metadataImport: true, transcriptImport: true },
    runtime: preview.runtime,
    sourceLocations: [],
    state: "connected"
  };
}

function previewMetrics(preview: SourcesImportPreview): Array<{ label: string; value: string | number }> {
  return [
    { label: "Sessions to import", value: preview.summary.estimatedRecords ?? "No sessions found" }
  ];
}

function runtimeCanImport(runtime: string): boolean {
  const harness = harnessForRuntime(runtime as RuntimeKind);
  return Boolean(harness && canImportHarness(harness));
}

function scopeForChoice(choice: ScopeChoice): ImportScopeDto {
  return choice === "full"
    ? { includeChangedSinceCursor: true, mode: "transcript_full" }
    : { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 };
}
