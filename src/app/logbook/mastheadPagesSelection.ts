export const MASTHEAD_PAGES_BATCH_CAP = 500;

export type MastheadPagesSelectionScope = "none" | "manual" | "current_page" | "matching";

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
  pagesSelectionMode: boolean;
  selectedArtifactIds: ReadonlySet<string> | readonly string[];
  sessionId: string;
  kind?: string;
}): LogbookRowSelectionState | undefined {
  if (!input.pagesSelectionMode) return undefined;
  const selectedIds = input.selectedArtifactIds;
  const selected =
    selectedIds instanceof Set ? selectedIds.has(input.sessionId) : [...selectedIds].includes(input.sessionId);
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

export function selectEligibleCurrentPageIds(
  sessions: Array<{ sessionId: string; runtime?: string; lifecycle?: string }>,
  existing: readonly string[],
  cap = MASTHEAD_PAGES_BATCH_CAP
): string[] {
  const next = new Set(existing);
  for (const session of sessions) {
    if (next.size >= cap) break;
    if (!isMastheadPagesListEligibleKind(rowKind(session))) continue;
    next.add(session.sessionId);
  }
  return [...next].slice(0, cap);
}
