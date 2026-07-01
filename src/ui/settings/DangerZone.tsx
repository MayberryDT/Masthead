import type { SettingsOptionDto } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { AppSelect } from "../primitives/AppSelect";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";
import type { DeletionScopeKind } from "../OperationsPanel";

type DangerZoneProps = {
  busy?: boolean;
  databaseId?: string;
  databasePath?: string;
  deletionScopeKind: DeletionScopeKind;
  deletionScopeTarget: string;
  targets?: {
    projects: SettingsOptionDto[];
    runtimes: SettingsOptionDto[];
    hosts: SettingsOptionDto[];
  };
  onDeletionScopeKindChange?: (kind: DeletionScopeKind) => void;
  onDeletionScopeTargetChange?: (target: string) => void;
  onRequestScopedDelete?: () => void;
  onRequestDeleteAll?: () => void;
};

const scopeOptions: Array<{ label: string; value: DeletionScopeKind }> = [
  { label: "Project", value: "project" },
  { label: "Session", value: "session" },
  { label: "Runtime", value: "runtime" },
  { label: "Host", value: "host" }
];

export function DangerZone({
  busy = false,
  databaseId,
  databasePath,
  deletionScopeKind,
  deletionScopeTarget,
  onDeletionScopeKindChange,
  onDeletionScopeTargetChange,
  onRequestDeleteAll,
  onRequestScopedDelete,
  targets
}: DangerZoneProps) {
  const targetOptions = optionsForScope(deletionScopeKind, targets);
  return (
    <SettingsSection
      danger
      description="These actions only mutate Masthead's local database and generated indexes. Original harness files are untouched."
      eyebrow="Danger zone"
      title="Danger zone"
    >
      <SettingsRow
        description={databasePath ?? "Waiting for the active Masthead database path."}
        label="Target database"
        value={databaseId ?? "Loading"}
      />
      <SettingsRow
        control={
          <div className="settings-delete-controls">
            <AppSelect
              icon="source"
              label="Delete scope"
              onChange={(value) => onDeletionScopeKindChange?.(value as DeletionScopeKind)}
              options={scopeOptions}
              value={deletionScopeKind}
            />
            {deletionScopeKind === "session" || targetOptions.length === 0 ? (
              <input
                aria-label="Delete target"
                disabled={busy}
                onChange={(event) => onDeletionScopeTargetChange?.(event.currentTarget.value)}
                placeholder={scopePlaceholder(deletionScopeKind)}
                value={deletionScopeTarget}
              />
            ) : (
              <AppSelect
                icon="source"
                label="Delete target"
                onChange={(value) => onDeletionScopeTargetChange?.(value)}
                options={[{ label: `Choose ${deletionScopeKind}`, value: "" }, ...targetOptions]}
                value={deletionScopeTarget}
              />
            )}
            <AppButton disabled={busy || deletionScopeTarget.trim().length === 0} onClick={onRequestScopedDelete} variant="danger">
              Delete selected records
            </AppButton>
          </div>
        }
        description="Project, runtime, and host deletion targets are populated from canonical session data."
        label="Delete scoped records"
      />
      <SettingsRow
        control={
          <AppButton disabled={busy} onClick={onRequestDeleteAll} variant="danger">
            Delete all Masthead data
          </AppButton>
        }
        description="Clears Masthead-owned canonical sessions, enrichments, source policies, indexes, and MCP audit rows. Original source harness files are not modified."
        label="Delete all"
      />
    </SettingsSection>
  );
}

function optionsForScope(kind: DeletionScopeKind, targets: DangerZoneProps["targets"]): SettingsOptionDto[] {
  if (!targets) return [];
  if (kind === "project") return targets.projects;
  if (kind === "runtime") return targets.runtimes;
  if (kind === "host") return targets.hosts;
  return [];
}

function scopePlaceholder(kind: DeletionScopeKind): string {
  if (kind === "session") return "session id";
  if (kind === "runtime") return "runtime id or kind";
  if (kind === "host") return "host id or hostname";
  return "project label";
}
