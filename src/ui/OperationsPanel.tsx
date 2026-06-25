import { installMastheadHookConfig, verifyMastheadHookConfig } from "../core/hookAdmin";
import type { DataSummary } from "../app/daemonClient";

const hookCommand = "node scripts/masthead-hook.js";
const plannedHookConfig = installMastheadHookConfig({}, { command: hookCommand });
const hookStatus = verifyMastheadHookConfig(plannedHookConfig);
export type DeletionScopeKind = "project" | "session" | "runtime" | "host";

export type LocalDataStatus = {
  state:
    | "idle"
    | "confirm_delete"
    | "confirm_prune"
    | "confirm_scoped_delete"
    | "busy"
    | "exported"
    | "deleted"
    | "pruned"
    | "error";
  message?: string;
};

type Props = {
  dataSummary?: DataSummary;
  deletionScopeKind?: DeletionScopeKind;
  deletionScopeTarget?: string;
  localDataStatus?: LocalDataStatus;
  onDeletionScopeKindChange?: (kind: DeletionScopeKind) => void;
  onDeletionScopeTargetChange?: (target: string) => void;
  onExportLocalData?: () => void;
  onRequestPruneLocalData?: () => void;
  onConfirmPruneLocalData?: () => void;
  onRequestScopedDelete?: () => void;
  onConfirmScopedDelete?: () => void;
  onRequestDeleteLocalData?: () => void;
  onConfirmDeleteLocalData?: () => void;
};

export function OperationsPanel({
  dataSummary,
  deletionScopeKind = "project",
  deletionScopeTarget = "",
  localDataStatus = { state: "idle" },
  onDeletionScopeKindChange,
  onDeletionScopeTargetChange,
  onExportLocalData,
  onRequestPruneLocalData,
  onConfirmPruneLocalData,
  onRequestScopedDelete,
  onConfirmScopedDelete,
  onRequestDeleteLocalData,
  onConfirmDeleteLocalData
}: Props) {
  const busy = localDataStatus.state === "busy";
  const confirmingDelete = localDataStatus.state === "confirm_delete";
  const confirmingPrune = localDataStatus.state === "confirm_prune";
  const confirmingScopedDelete = localDataStatus.state === "confirm_scoped_delete";
  const scopeLocked = busy || confirmingScopedDelete;
  const scopedDeleteDisabled = busy || deletionScopeTarget.trim().length === 0;

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
            <dd>Canonical metadata and session capsules are kept indefinitely</dd>
          </div>
          <div>
            <dt>Delete raw source copies</dt>
            <dd>Keeps normalized session metadata, summaries, and search records.</dd>
          </div>
          <div>
            <dt>Delete one project</dt>
            <dd>Removes Masthead imported records for the selected project. Original harness files are untouched.</dd>
          </div>
          <div>
            <dt>Delete all Masthead data</dt>
            <dd>Removes the canonical Masthead database, enrichments, search index, policies, and MCP audit log. Original harness files remain untouched.</dd>
          </div>
        </dl>
        {dataSummary ? (
          <dl className="ops-list ops-preview" aria-label="Data deletion preview">
            <div>
              <dt>Preview sessions</dt>
              <dd>{formatCount(dataSummary.tables.sessions ?? dataSummary.sessions)}</dd>
            </div>
            <div>
              <dt>Preview raw source copies</dt>
              <dd>{formatCount(dataSummary.tables.raw_events ?? dataSummary.rawEvents)}</dd>
            </div>
            <div>
              <dt>Preview search records</dt>
              <dd>{formatCount(dataSummary.tables.session_search ?? 0)}</dd>
            </div>
            <div>
              <dt>Preview MCP audit</dt>
              <dd>{formatCount(dataSummary.tables.mcp_query_log ?? dataSummary.auditRows)}</dd>
            </div>
          </dl>
        ) : null}
        <div className="ops-scope-control" aria-label="Selective deletion">
          <label>
            <span className="mono-label">Selective deletion</span>
            <select
              aria-label="Delete scope"
              value={deletionScopeKind}
              disabled={scopeLocked}
              onChange={(event) => onDeletionScopeKindChange?.(event.currentTarget.value as DeletionScopeKind)}
            >
              <option value="project">Project</option>
              <option value="session">Session</option>
              <option value="runtime">Runtime</option>
              <option value="host">Host</option>
            </select>
          </label>
          <input
            aria-label="Delete target"
            value={deletionScopeTarget}
            disabled={scopeLocked}
            placeholder={scopePlaceholder(deletionScopeKind)}
            onChange={(event) => onDeletionScopeTargetChange?.(event.currentTarget.value)}
          />
          <button
            type="button"
            className="ghost-pill danger-pill"
            disabled={scopedDeleteDisabled}
            onClick={confirmingScopedDelete ? onConfirmScopedDelete : onRequestScopedDelete}
          >
            {confirmingScopedDelete ? "Confirm scoped delete" : "Delete selected records"}
          </button>
        </div>
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
            {confirmingPrune ? "Confirm raw copy delete" : "Delete raw source copies"}
          </button>
          <button
            type="button"
            className="ghost-pill danger-pill"
            disabled={busy}
            onClick={confirmingDelete ? onConfirmDeleteLocalData : onRequestDeleteLocalData}
          >
            {confirmingDelete ? "Confirm delete all" : "Delete all Masthead data"}
          </button>
        </div>
        {localDataStatus.message ? (
          <p className={`ops-status ${localDataStatus.state === "error" ? "error" : ""}`}>{localDataStatus.message}</p>
        ) : null}
      </article>
    </section>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function scopePlaceholder(kind: DeletionScopeKind): string {
  if (kind === "session") return "session id";
  if (kind === "runtime") return "runtime id or kind";
  if (kind === "host") return "host id or hostname";
  return "project label";
}
