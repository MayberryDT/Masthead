import { onboardingHarnesses, type HarnessCatalogEntry } from "../../adapters/harnessCatalog";
import type { FoundSourceDto } from "../../shared/sourcesSetup";

export type HistoryImportScopeChoice = "recent" | "full";

type HarnessSetupControlsProps = {
  availableSources: FoundSourceDto[];
  importScope: HistoryImportScopeChoice;
  selectedSourceIds: Set<string>;
  onImportScopeChange: (scope: HistoryImportScopeChoice) => void;
  onToggleSourceGroup: (sourceIds: string[], checked: boolean) => void;
};

export function HarnessSetupControls({
  availableSources,
  importScope,
  onImportScopeChange,
  onToggleSourceGroup,
  selectedSourceIds
}: HarnessSetupControlsProps) {
  const groups = groupSourcesByRuntime(availableSources, onboardingHarnesses());

  return (
    <div className="harness-setup-controls">
      <section className="sources-history-section" aria-label="Session history sources">
        <div className="source-detail-section-head">
          <div>
            <p className="mono-label">Session history</p>
            <h3>Which harnesses' session history do you want to import?</h3>
          </div>
        </div>
        <p className="surface-status">Select the harness history Masthead should add to the local session library.</p>
        <div className="source-adapter-grid sources-history-harness-grid">
          {groups.map((group) => {
            const checked = group.sourceIds.some((sourceId) => selectedSourceIds.has(sourceId));
            return (
              <label className={`adapter-card source-select-card sources-history-harness-card${checked ? " is-selected" : ""}`} key={group.runtime}>
                <span className="adapter-card-head">
                  <span>
                    <strong>{group.label}</strong>
                    <small>{group.sessionCount} sessions across {formatLocationCount(group.paths.length)}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onToggleSourceGroup(group.sourceIds, event.currentTarget.checked)}
                  />
                </span>
                {group.paths[0] ? <span className="surface-status source-card-path">{formatSourceHomePath(group.paths[0])}</span> : null}
              </label>
            );
          })}
        </div>
      </section>

      <section className="sources-history-section" aria-label="History import range">
        <div className="source-detail-section-head">
          <div>
            <p className="mono-label">Import range</p>
            <h3>How much history?</h3>
          </div>
        </div>
        <div className="source-choice-list sources-import-range-list sources-history-range-list">
          <label className="source-choice">
            <input type="radio" name="sources-onboarding-import-range" checked={importScope === "recent"} onChange={() => onImportScopeChange("recent")} />
            <span>
              <strong>Last 30 days</strong>
              <small>Start with recent sessions from the selected harnesses.</small>
            </span>
          </label>
          <label className="source-choice">
            <input type="radio" name="sources-onboarding-import-range" checked={importScope === "full"} onChange={() => onImportScopeChange("full")} />
            <span>
              <strong>Everything</strong>
              <small>Import all detected local history for the selected harnesses.</small>
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}

type HarnessSourceGroup = {
  label: string;
  paths: string[];
  runtime: string;
  sessionCount: number;
  sourceIds: string[];
};

function groupSourcesByRuntime(sources: FoundSourceDto[], harnesses: HarnessCatalogEntry[]): HarnessSourceGroup[] {
  const harnessLabels = new Map<string, string>(harnesses.map((harness) => [harness.runtime, harness.label]));
  const groups = new Map<string, HarnessSourceGroup>();

  for (const source of sources) {
    const existing = groups.get(source.runtime);
    const group = existing ?? {
      label: harnessLabels.get(source.runtime) ?? source.label ?? source.runtime,
      paths: [],
      runtime: source.runtime,
      sessionCount: 0,
      sourceIds: []
    };

    group.sourceIds.push(source.sourceId);
    group.sessionCount += source.discoveredSessions ?? source.sessions ?? 0;
    if (source.path && !group.paths.includes(source.path)) group.paths.push(source.path);
    groups.set(source.runtime, group);
  }

  return Array.from(groups.values());
}

function formatLocationCount(count: number): string {
  return `${count} ${count === 1 ? "location" : "locations"}`;
}

function formatSourceHomePath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments[0] === "home" && segments[1]) {
    if (segments[2] === ".config" && segments[3]) return `/${segments.slice(0, 4).join("/")}`;
    if (segments[2] === ".local" && segments[3] === "share" && segments[4]) return `/${segments.slice(0, 5).join("/")}`;
    if (segments[2]?.startsWith(".")) return `/${segments.slice(0, 3).join("/")}`;
  }

  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized;
}
