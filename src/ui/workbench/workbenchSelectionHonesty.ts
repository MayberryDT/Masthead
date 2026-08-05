/**
 * Compact Workbench copy for selection vs compile-ready handoff.
 * Review sessions may stay selected for pipeline actions but never enter Copy Agent Prompt.
 * Keep toolbar labels minimal — detail belongs in titles/tooltips only.
 */

/** Primary Copy Agent Prompt label — always short; counts live in the title. */
export function formatCopyAgentPromptLabel(_args?: {
  ready?: number;
  excluded?: number;
}): string {
  return "Copy Agent Prompt";
}

/** Tooltip / title for Copy Agent Prompt (ready vs non-ready selection). */
export function formatCopyAgentPromptTitle(args: {
  selectionCount: number;
  ready: number;
  excluded: number;
  defaultTitle: string;
}): string {
  if (args.selectionCount === 0) return args.defaultTitle;
  if (args.ready === 0) {
    return (
      `No selected sessions are compile-ready for dossier authoring. ` +
      `Copy still processes the selection: definitive noise is dismissed to Not Added; ` +
      `${args.excluded} non-ready session${args.excluded === 1 ? "" : "s"} will be excluded from the pack.`
    );
  }
  if (args.excluded > 0) {
    return (
      `Copy for ${args.ready} ready session${args.ready === 1 ? "" : "s"}. ` +
      `${args.excluded} non-ready session${args.excluded === 1 ? "" : "s"} will be excluded from the pack ` +
      `(noise dismissed from Workbench; mid-import rows keep their pipeline action).`
    );
  }
  return args.defaultTitle;
}

/** Optional toast after select-all — keep short. */
export function formatSelectAllSummary(selected: number): string {
  if (selected === 0) return "No package-path sessions to select";
  return `Selected all ${selected} package-path sessions`;
}
