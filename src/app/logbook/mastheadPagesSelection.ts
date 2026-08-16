export const MASTHEAD_PAGES_BATCH_CAP = 500;



export type LogbookRowSelectionState = {
  selectable: boolean;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
};

export function isMastheadPagesListEligibleKind(kind: string | undefined): boolean {
  return kind === "session_dossier";
}

export function rowKind(session: { runtime?: string; lifecycle?: string }): string {
  return session.runtime ?? session.lifecycle ?? "artifact";
}

export function selectionStateForRow(input: {
  selectedArtifactIds: ReadonlySet<string> | readonly string[];
  sessionId: string;
  kind?: string;
}): LogbookRowSelectionState {
  const selectedIds = input.selectedArtifactIds;
  const selected = "has" in selectedIds
    ? selectedIds.has(input.sessionId)
    : selectedIds.includes(input.sessionId);
  const eligible = isMastheadPagesListEligibleKind(input.kind);
  if (!eligible) {
    return {
      selectable: true,
      selected: false,
      disabled: true,
      disabledReason: "Only session dossier Pages are eligible for Masthead Pages"
    };
  }
  return {
    selectable: true,
    selected,
    disabled: false
  };
}

export function toggleSelectedId(ids: readonly string[], artifactId: string, selected: boolean, cap = MASTHEAD_PAGES_BATCH_CAP): string[] {
  const set = new Set(ids);
  if (selected) {
    if (set.size >= cap && !set.has(artifactId)) return [...ids];
    set.add(artifactId);
  } else {
    set.delete(artifactId);
  }
  return [...set];
}
