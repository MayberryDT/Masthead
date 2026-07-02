import type { AdapterStatus } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";

type Props = {
  adapter: AdapterStatus;
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  metrics?: Array<{ label: string; value: string | number }>;
  onToggle: (runtime: string, checked: boolean) => void;
};

export function HarnessImportCard({ adapter, checked, disabled = false, loading = false, metrics, onToggle }: Props) {
  const harness = harnessForRuntime(adapter.runtime as RuntimeKind);
  const label = adapter.name ?? harness?.label ?? adapter.runtime;
  const cardMetrics = metrics ?? [
    { label: "Sessions to import", value: loading ? "Loading sessions" : adapter.discoveredSessions || adapter.importedSessions || "No sessions found" }
  ];
  return (
    <label className={`harness-import-card adapter-card adapter-card-${adapter.state}${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}>
      <span className="adapter-card-head">
        <strong>{label}</strong>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onToggle(adapter.runtime, event.currentTarget.checked)}
        />
      </span>
      <dl className="adapter-card-metrics">
        {cardMetrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
    </label>
  );
}
