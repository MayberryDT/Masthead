import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";

type TooltipPlacement = "top" | "bottom";

type TooltipState = {
  placement: TooltipPlacement;
  style: CSSProperties;
  visible: boolean;
};

const tooltipMaxWidth = 240;
const viewportPadding = 8;
const offset = 8;

export function useViewportTooltip(label: string) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<TooltipState>({ placement: "top", style: {}, visible: false });

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") return;

    const rect = anchor.getBoundingClientRect();
    const halfMaxWidth = tooltipMaxWidth / 2;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, viewportPadding + halfMaxWidth),
      window.innerWidth - viewportPadding - halfMaxWidth
    );
    const placeBelow = rect.top < 52;
    const top = placeBelow ? rect.bottom + offset : rect.top - offset;

    setState({
      placement: placeBelow ? "bottom" : "top",
      style: { left, top },
      visible: true
    });
  }, []);

  const showTooltip = useCallback(() => {
    updatePlacement();
  }, [updatePlacement]);

  const hideTooltip = useCallback(() => {
    setState((current) => ({ ...current, visible: false }));
  }, []);

  useEffect(() => {
    if (!state.visible) return undefined;

    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [state.visible, updatePlacement]);

  const tooltip =
    state.visible && typeof document !== "undefined"
      ? createPortal(
          <div id={tooltipId} className={`viewport-tooltip ${state.placement}`} role="tooltip" style={state.style}>
            {label}
          </div>,
          document.body
        )
      : null;

  return {
    anchorRef,
    tooltip,
    tooltipId,
    tooltipHandlers: {
      onBlur: hideTooltip,
      onFocus: showTooltip,
      onMouseEnter: showTooltip,
      onMouseLeave: hideTooltip
    }
  };
}
