import type { AdapterStatus } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";

type Props = {
  adapter: AdapterStatus;
  checked: boolean;
  disabled?: boolean;
  onToggle: (runtime: string, checked: boolean) => void;
};

export function HarnessImportCard({ adapter, checked, disabled = false, onToggle }: Props) {
  const harness = harnessForRuntime(adapter.runtime as RuntimeKind);
  const label = adapter.name ?? harness?.label ?? adapter.runtime;
  return (
    <label className={`harness-import-card adapter-card adapter-card-${adapter.state}`}>
      <span className="adapter-card-head">
        <span>
          <span className="mono-label">Coding harness</span>
          <strong>{label}</strong>
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(adapter.runtime, event.currentTarget.checked)}
        />
      </span>
      <span className="harness-import-card-description">{harness?.description ?? "Local session history detected by Masthead."}</span>
      <dl className="adapter-card-metrics">
        <div>
          <dt>Sessions</dt>
          <dd>{adapter.importedSessions || adapter.discoveredSessions || 0}</dd>
        </div>
        <div>
          <dt>Locations</dt>
          <dd>{adapter.sourceLocationCount ?? adapter.sourceLocations.length}</dd>
        </div>
      </dl>
    </label>
  );
}
