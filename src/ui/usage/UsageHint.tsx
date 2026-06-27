import { useViewportTooltip } from "../primitives/ViewportTooltip";

type Props = {
  label: string;
  tip: string;
};

export function UsageHint({ label, tip }: Props) {
  const { anchorRef, tooltip, tooltipId, tooltipHandlers } = useViewportTooltip(tip);

  return (
    <>
      <span ref={anchorRef} className="usage-hint" aria-describedby={tooltipId} tabIndex={0} {...tooltipHandlers}>
        {label}
      </span>
      {tooltip}
    </>
  );
}
