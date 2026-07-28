/**
 * Durable selection honesty for Workbench: package-path total vs compile-ready vs quality review.
 * Review sessions stay selected for pipeline actions but are never included in Copy Agent Prompt.
 */
export function formatWorkbenchSelectionHonesty(args: {
  selected: number;
  ready: number;
  needQualityReview: number;
}): string {
  const { selected, ready, needQualityReview } = args;
  return `Selected ${selected} package-path · ${ready} ready · ${needQualityReview} need quality review`;
}

/** Primary Copy Agent Prompt label; discloses ready count when review sessions are excluded. */
export function formatCopyAgentPromptLabel(args: {
  ready: number;
  excluded: number;
}): string {
  if (args.ready > 0 && args.excluded > 0) {
    return `Copy Agent Prompt (${args.ready} ready)`;
  }
  return "Copy Agent Prompt";
}

/** Tooltip / title for Copy Agent Prompt, always reflecting ready vs left-out review counts. */
export function formatCopyAgentPromptTitle(args: {
  selectionCount: number;
  ready: number;
  excluded: number;
  defaultTitle: string;
}): string {
  if (args.selectionCount === 0) return args.defaultTitle;
  if (args.ready === 0) {
    return (
      `0 of ${args.selectionCount} selected session${args.selectionCount === 1 ? " is" : "s are"} ` +
      `ready for agent enrichment. ${args.excluded} need quality review and will not be included in the handoff.`
    );
  }
  if (args.excluded > 0) {
    return (
      `Copy a plain-language request for ${args.ready} ready session${args.ready === 1 ? "" : "s"}. ` +
      `${args.excluded} selected session${args.excluded === 1 ? " needs" : "s need"} ` +
      `quality review and will be left out of the handoff.`
    );
  }
  return args.defaultTitle;
}
