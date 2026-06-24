import { installMastheadHookConfig, verifyMastheadHookConfig } from "../core/hookAdmin";

const hookCommand = "node scripts/masthead-hook.js";
const plannedHookConfig = installMastheadHookConfig({}, { command: hookCommand });
const hookStatus = verifyMastheadHookConfig(plannedHookConfig);

export type LocalDataStatus = {
  state: "idle" | "confirm_delete" | "confirm_prune" | "busy" | "exported" | "deleted" | "pruned" | "error";
  message?: string;
};

type Props = {
  localDataStatus?: LocalDataStatus;
  onExportLocalData?: () => void;
  onRequestPruneLocalData?: () => void;
  onConfirmPruneLocalData?: () => void;
  onRequestDeleteLocalData?: () => void;
  onConfirmDeleteLocalData?: () => void;
};

export function OperationsPanel({
  localDataStatus = { state: "idle" },
  onExportLocalData,
  onRequestPruneLocalData,
  onConfirmPruneLocalData,
  onRequestDeleteLocalData,
  onConfirmDeleteLocalData
}: Props) {
  const busy = localDataStatus.state === "busy";
  const confirmingDelete = localDataStatus.state === "confirm_delete";
  const confirmingPrune = localDataStatus.state === "confirm_prune";

  return (
    <section id="operations" className="operations-panel" aria-label="Masthead operations">
      <article className="ops-card" id="local">
        <header className="ops-head">
          <p className="mono-label">Admin</p>
          <h2>Codex hook</h2>
        </header>
        <dl className="ops-list">
          <div>
            <dt>Install plan</dt>
            <dd>Add {Object.keys(plannedHookConfig.hooks).length} Masthead-managed hooks</dd>
          </div>
          <div>
            <dt>Config handling</dt>
            <dd>Backup, merge, verify, rollback</dd>
          </div>
          <div>
            <dt>Hook status</dt>
            <dd>{hookStatus.installed ? "Managed hook shape verified" : "Missing hook entries"}</dd>
          </div>
        </dl>
      </article>

      <article className="ops-card">
        <header className="ops-head">
          <p className="mono-label">Privacy</p>
          <h2>Local by default</h2>
        </header>
        <ul className="ops-checks">
          <li>Remote LLM off</li>
          <li>Raw prompts off</li>
          <li>Full diffs off</li>
          <li>Payload preview required</li>
          <li>Redaction before persistence</li>
        </ul>
      </article>

      <article className="ops-card">
        <header className="ops-head">
          <p className="mono-label">History</p>
          <h2>Local records</h2>
        </header>
        <dl className="ops-list">
          <div>
            <dt>Search keys</dt>
            <dd>Project, file, command, status, branch, alert, outcome</dd>
          </div>
          <div>
            <dt>Retention</dt>
            <dd>Manual 30-day prune, latest 500 records kept</dd>
          </div>
          <div>
            <dt>Pinned and active</dt>
            <dd>Pinned records and unresolved attention stay until delete</dd>
          </div>
          <div>
            <dt>Deletion</dt>
            <dd>Clears Masthead app-store and live collector history only</dd>
          </div>
        </dl>
        <div className="ops-actions">
          <button type="button" className="ghost-pill" disabled={busy} onClick={onExportLocalData}>
            Export local data
          </button>
          <button
            type="button"
            className="ghost-pill"
            disabled={busy}
            onClick={confirmingPrune ? onConfirmPruneLocalData : onRequestPruneLocalData}
          >
            {confirmingPrune ? "Confirm retention" : "Apply retention"}
          </button>
          <button
            type="button"
            className="ghost-pill danger-pill"
            disabled={busy}
            onClick={confirmingDelete ? onConfirmDeleteLocalData : onRequestDeleteLocalData}
          >
            {confirmingDelete ? "Confirm delete" : "Delete Masthead data"}
          </button>
        </div>
        {localDataStatus.message ? (
          <p className={`ops-status ${localDataStatus.state === "error" ? "error" : ""}`}>{localDataStatus.message}</p>
        ) : null}
      </article>
    </section>
  );
}
