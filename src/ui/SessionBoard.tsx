import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { LifecycleLaneView, SessionCardView } from "../core/types";
import type { CardDensity } from "./toolbarOptions";
import { sessionDemoTelemetry } from "./observabilityDemo";
import { SessionCard } from "./SessionCard";
import { prefersReducedMotion } from "./motionPreference";

type CardLayoutSnapshot = Map<string, DOMRect>;
type CardLayoutChangeKind = "reorder" | "shrinking" | "growing";
type InlineLayoutStyleSnapshot = {
  alignSelf: string;
  height: string;
  justifySelf: string;
  minHeight: string;
  transform: string;
  transformOrigin: string;
  transition: string;
  width: string;
};
type ActiveLayoutAnimation = {
  animation?: Animation;
  inlineStyle?: InlineLayoutStyleSnapshot;
  timers: number[];
};

export const SESSION_CARD_LAYOUT_DURATION_MS = 760;
export const SESSION_CARD_LAYOUT_COMPACT_PHASE_MS = 420;
export const SESSION_CARD_LAYOUT_EXPAND_DURATION_MS = 260;
export const SESSION_CARD_LAYOUT_LOCK_MS = 120;
export const SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS = 40;
export const SESSION_CARD_LAYOUT_STAGGER_MS = 32;
export const SESSION_CARD_LAYOUT_EASING = "cubic-bezier(0.24, 0.08, 0.18, 1)";

const activeLayoutAnimations = new WeakMap<HTMLElement, ActiveLayoutAnimation>();

type Props = {
  cards: SessionCardView[];
  lanes?: LifecycleLaneView[];
  onOpenSession?: (sessionId: string) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  variant?: "lanes" | "observability";
  showDemoTelemetry?: boolean;
  density?: CardDensity;
};

export function SessionBoard({
  cards,
  lanes,
  onOpenSession,
  emptyTitle = "No sessions",
  emptyMessage = "No sessions are available for the current view.",
  variant = "lanes",
  showDemoTelemetry = false,
  density = "comfortable"
}: Props) {
  const seenSessionIdsRef = useRef<Set<string> | null>(null);
  const semanticHeadlineSignaturesRef = useRef<Map<string, string> | null>(null);
  const newSessionOrder = useMemo(() => {
    const seenSessionIds = seenSessionIdsRef.current;
    if (!seenSessionIds) return new Map<string, number>();

    const newSessionIds = cards.map((card) => card.sessionId).filter((sessionId) => !seenSessionIds.has(sessionId));
    return new Map(newSessionIds.map((sessionId, index) => [sessionId, index]));
  }, [cards]);
  const headlineUpdateOrder = useMemo(() => {
    const previousSignatures = semanticHeadlineSignaturesRef.current;
    if (!previousSignatures) return new Map<string, number>();

    const updatedSessionIds = cards
      .filter(
        (card) =>
          shouldAnimateHeadlineChange(card) &&
          previousSignatures.has(card.sessionId) &&
          previousSignatures.get(card.sessionId) !== semanticHeadlineSignature(card)
      )
      .map((card) => card.sessionId);
    return new Map(updatedSessionIds.map((sessionId, index) => [sessionId, index]));
  }, [cards]);
  useEffect(() => {
    if (!seenSessionIdsRef.current) {
      seenSessionIdsRef.current = new Set(cards.map((card) => card.sessionId));
    }

    for (const card of cards) {
      seenSessionIdsRef.current.add(card.sessionId);
    }

    semanticHeadlineSignaturesRef.current = new Map(cards.map((card) => [card.sessionId, semanticHeadlineSignature(card)]));
  }, [cards]);

  if (variant === "observability") {
    return (
      <section id="sessions" className="session-board observability-session-board" aria-label="Session cards">
        {cards.length === 0 ? (
          <div className="empty-session-state">
            <p className="mono-label">Sessions</p>
            <h2>{emptyTitle}</h2>
            <p>{emptyMessage}</p>
          </div>
        ) : (
          <ObservabilityCardGrid cards={cards} density={density}>
            {cards.map((card, index) => (
              <SessionCard
                key={card.sessionId}
                session={card}
                onToggle={onOpenSession}
                demoTelemetry={showDemoTelemetry ? sessionDemoTelemetry(card.sessionId, index) : undefined}
                isNew={newSessionOrder.has(card.sessionId)}
                newCardIndex={newSessionOrder.get(card.sessionId)}
                headlineUpdateIndex={headlineUpdateOrder.get(card.sessionId)}
              />
            ))}
          </ObservabilityCardGrid>
        )}
      </section>
    );
  }

  const cardsById = new Map(cards.map((card) => [card.sessionId, card]));
  const visibleLanes = lanes?.map((lane) => ({
    ...lane,
    sessionIds: lane.sessionIds.filter((sessionId) => cardsById.has(sessionId))
  })) ?? [
    {
      laneId: "running" as const,
      title: "Sessions",
      count: cards.length,
      sessionIds: cards.map((card) => card.sessionId)
    }
  ];

  return (
    <section id="sessions" className="session-board" aria-label="Session cards">
      {cards.length === 0 ? (
        <div className="empty-session-state">
          <p className="mono-label">Sessions</p>
          <h2>{emptyTitle}</h2>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        visibleLanes.map((lane) => (
          <section key={lane.laneId} className={`session-lane lane-${lane.laneId}`} aria-label={lane.title}>
            <header className="lane-head">
              <div>
                <p className="mono-label">{laneDescription(lane.laneId)}</p>
                <h2>{lane.title}</h2>
              </div>
              <span className="lane-count">{lane.sessionIds.length}</span>
            </header>
            <div className="lane-grid">
              {lane.sessionIds.length === 0 ? (
                <p className="lane-empty">No sessions in this lane.</p>
              ) : (
                lane.sessionIds.map((sessionId) => {
                  const card = cardsById.get(sessionId);
                  return card ? (
                    <SessionCard
                      key={sessionId}
                      session={card}
                      onToggle={onOpenSession}
                      isNew={newSessionOrder.has(sessionId)}
                      newCardIndex={newSessionOrder.get(sessionId)}
                      headlineUpdateIndex={headlineUpdateOrder.get(sessionId)}
                    />
                  ) : null;
                })
              )}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function ObservabilityCardGrid({
  cards,
  children,
  density
}: {
  cards: SessionCardView[];
  children: ReactNode;
  density: CardDensity;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previousLayoutRef = useRef<CardLayoutSnapshot | null>(null);
  const previousLayoutSignatureRef = useRef<string | null>(null);
  const previousDensityRef = useRef<CardDensity | null>(null);
  const orderSignature = cards.map((card) => card.sessionId).join("\u0000");
  const layoutSignature = `${density}\u0000${orderSignature}`;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const previousLayout = previousLayoutRef.current;
    const previousLayoutSignature = previousLayoutSignatureRef.current;
    const previousDensity = previousDensityRef.current;
    const nextLayout = captureCardLayout(grid);
    const layoutChangeKind = previousDensity && previousDensity !== density ? (density === "compact" ? "shrinking" : "growing") : "reorder";

    previousLayoutRef.current = nextLayout;
    previousLayoutSignatureRef.current = layoutSignature;
    previousDensityRef.current = density;

    if (!previousLayout || previousLayoutSignature === null || previousLayoutSignature === layoutSignature || prefersReducedMotion()) {
      if (prefersReducedMotion()) cancelActiveCardLayoutAnimations(grid);
      return;
    }

    animateCardLayoutFrom(grid, previousLayout, layoutChangeKind);
  });

  return (
    <div ref={gridRef} className={`observability-card-grid ${density === "compact" ? "compact" : ""}`.trim()}>
      {children}
    </div>
  );
}

function captureCardLayout(container: HTMLElement): CardLayoutSnapshot {
  const rects: CardLayoutSnapshot = new Map();
  container.querySelectorAll<HTMLElement>(".session-card[data-session-id]").forEach((card) => {
    const sessionId = card.dataset.sessionId;
    if (sessionId) rects.set(sessionId, card.getBoundingClientRect());
  });
  return rects;
}

function animateCardLayoutFrom(container: HTMLElement, previousLayout: CardLayoutSnapshot, changeKind: CardLayoutChangeKind): void {
  container.querySelectorAll<HTMLElement>(".session-card[data-session-id]").forEach((card, index) => {
    const sessionId = card.dataset.sessionId;
    const previousRect = sessionId ? previousLayout.get(sessionId) : undefined;
    if (!previousRect) return;

    const nextRect = card.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const hasMeasurableSize = previousRect.width > 0 && previousRect.height > 0 && nextRect.width > 0 && nextRect.height > 0;
    const scaleX = hasMeasurableSize ? previousRect.width / nextRect.width : 1;
    const scaleY = hasMeasurableSize ? previousRect.height / nextRect.height : 1;
    const moved = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
    const resized = hasMeasurableSize && (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01);
    if (!moved && !resized) return;

    const delay = layoutPhaseDelay(changeKind, index);
    const keyframes = steelPlateLayoutKeyframes({ deltaX, deltaY });
    cancelCardLayoutAnimation(card);

    const activeAnimation: ActiveLayoutAnimation = { timers: [] };
    activeLayoutAnimations.set(card, activeAnimation);
    card.classList.add("is-layout-animating", `is-layout-${changeKind}`);
    const hasCardAnimationApi = typeof card.animate === "function";
    if (changeKind === "shrinking") {
      activeAnimation.inlineStyle = lockCardToLayoutSize(card, previousRect);
      card.classList.add("is-layout-compacting");
      if (!hasCardAnimationApi) {
        animateShrinkingCardLayoutWithInlineStyle(card, keyframes[0], {
          activeAnimation,
          delay,
          nextRect
        });
        return;
      }
      startCardLayoutCompaction(card, activeAnimation, nextRect);
      activeAnimation.timers.push(
        window.setTimeout(() => {
          if (activeLayoutAnimations.get(card) !== activeAnimation) return;
          card.classList.remove("is-layout-compacting");
          card.classList.add("is-layout-moving");
        }, delay)
      );
    } else {
      card.classList.add("is-layout-moving");
    }
    if (changeKind === "growing") {
      activeAnimation.inlineStyle = lockCardToLayoutSize(card, previousRect);
    }
    if (!hasCardAnimationApi) {
      animateCardLayoutWithInlineStyle(card, keyframes[0], {
        activeAnimation,
        changeKind,
        delay,
        nextRect
      });
      return;
    }

    const animation = card.animate(keyframes, {
      delay,
      duration: SESSION_CARD_LAYOUT_DURATION_MS,
      easing: SESSION_CARD_LAYOUT_EASING,
      fill: "both"
    });
    activeAnimation.animation = animation;
    const finish = () => {
      if (activeLayoutAnimations.get(card) !== activeAnimation) return;
      if (changeKind === "growing") {
        startCardLayoutExpansion(card, activeAnimation, nextRect);
      } else {
        settleCardLayoutAnimation(card, activeAnimation);
      }
    };
    const cancel = () => {
      if (activeLayoutAnimations.get(card) === activeAnimation) {
        completeCardLayoutAnimation(card, activeAnimation);
      }
    };
    animation.addEventListener("finish", finish, { once: true });
    animation.addEventListener("cancel", cancel, { once: true });
  });
}

function steelPlateLayoutKeyframes({
  deltaX,
  deltaY
}: {
  deltaX: number;
  deltaY: number;
}): Keyframe[] {
  return [
    {
      transform: layoutTransform(deltaX, deltaY)
    },
    {
      offset: 0.82,
      transform: layoutTransform(deltaX * 0.04, deltaY * 0.04)
    },
    {
      transform: layoutTransform(0, 0)
    }
  ];
}

function layoutTransform(x: number, y: number): string {
  return `translate(${roundLayoutNumber(x)}px, ${roundLayoutNumber(y)}px)`;
}

function roundLayoutNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function layoutPhaseDelay(changeKind: CardLayoutChangeKind, index: number): number {
  const stagger = index * SESSION_CARD_LAYOUT_STAGGER_MS;
  return changeKind === "shrinking" ? SESSION_CARD_LAYOUT_COMPACT_PHASE_MS + stagger : stagger;
}

function animateCardLayoutWithInlineStyle(
  card: HTMLElement,
  firstKeyframe: Keyframe,
  options: {
    activeAnimation: ActiveLayoutAnimation;
    changeKind: CardLayoutChangeKind;
    delay: number;
    nextRect: DOMRect;
  }
): void {
  const { activeAnimation, changeKind, delay, nextRect } = options;
  activeAnimation.inlineStyle ??= snapshotCardLayoutStyles(card);
  card.style.transition = "none";
  card.style.transformOrigin = "top left";
  card.style.transform = typeof firstKeyframe.transform === "string" ? firstKeyframe.transform : "";
  void card.offsetWidth;

  window.requestAnimationFrame(() => {
    if (activeLayoutAnimations.get(card) !== activeAnimation) return;
    const moveTimer = window.setTimeout(() => {
      startInlineCardLayoutMove(card, activeAnimation, changeKind, nextRect);
    }, delay);
    activeAnimation.timers.push(moveTimer);
  });
}

function animateShrinkingCardLayoutWithInlineStyle(
  card: HTMLElement,
  firstKeyframe: Keyframe,
  options: {
    activeAnimation: ActiveLayoutAnimation;
    delay: number;
    nextRect: DOMRect;
  }
): void {
  const { activeAnimation, delay, nextRect } = options;
  activeAnimation.inlineStyle ??= snapshotCardLayoutStyles(card);
  card.style.transition = "none";
  card.style.transformOrigin = "top left";
  card.style.transform = typeof firstKeyframe.transform === "string" ? firstKeyframe.transform : "";
  const fromWidth = readInlineLayoutNumber(card.style.width, nextRect.width);
  const fromHeight = readInlineLayoutNumber(card.style.height, nextRect.height);
  const targetWidth = roundLayoutNumber(nextRect.width);
  const targetHeight = roundLayoutNumber(nextRect.height);
  let compactStartedAt: number | null = null;

  const compactFrame = (timestamp: number) => {
    if (activeLayoutAnimations.get(card) !== activeAnimation) return;
    compactStartedAt ??= timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - compactStartedAt) / SESSION_CARD_LAYOUT_COMPACT_PHASE_MS));
    const width = fromWidth + (targetWidth - fromWidth) * progress;
    const height = fromHeight + (targetHeight - fromHeight) * progress;
    card.style.width = `${roundLayoutNumber(width)}px`;
    card.style.minHeight = `${roundLayoutNumber(height)}px`;
    card.style.height = `${roundLayoutNumber(height)}px`;

    if (progress < 1) {
      window.requestAnimationFrame(compactFrame);
      return;
    }

    const moveDelay = Math.max(0, delay - SESSION_CARD_LAYOUT_COMPACT_PHASE_MS);
    const moveTimer = window.setTimeout(
      () => startInlineCardLayoutMove(card, activeAnimation, "shrinking", nextRect),
      moveDelay
    );
    activeAnimation.timers.push(moveTimer);
  };

  void card.offsetWidth;
  window.requestAnimationFrame(compactFrame);
}

function readInlineLayoutNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : roundLayoutNumber(fallback);
}

function startInlineCardLayoutMove(
  card: HTMLElement,
  activeAnimation: ActiveLayoutAnimation,
  changeKind: CardLayoutChangeKind,
  nextRect: DOMRect
): void {
  if (activeLayoutAnimations.get(card) !== activeAnimation) return;
  card.classList.remove("is-layout-compacting");
  card.classList.add("is-layout-moving");
  card.style.transition = `transform ${SESSION_CARD_LAYOUT_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`;
  card.style.transform = layoutTransform(0, 0);

  const finishTimer = window.setTimeout(() => {
    if (activeLayoutAnimations.get(card) !== activeAnimation) return;
    if (changeKind === "growing") {
      startCardLayoutExpansion(card, activeAnimation, nextRect);
    } else {
      settleCardLayoutAnimation(card, activeAnimation);
    }
  }, SESSION_CARD_LAYOUT_DURATION_MS + SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS);
  activeAnimation.timers.push(finishTimer);
}

function snapshotCardLayoutStyles(card: HTMLElement): InlineLayoutStyleSnapshot {
  return {
    alignSelf: card.style.alignSelf,
    height: card.style.height,
    justifySelf: card.style.justifySelf,
    minHeight: card.style.minHeight,
    transform: card.style.transform,
    transformOrigin: card.style.transformOrigin,
    transition: card.style.transition,
    width: card.style.width
  };
}

function lockCardToLayoutSize(card: HTMLElement, rect: DOMRect): InlineLayoutStyleSnapshot {
  const snapshot = snapshotCardLayoutStyles(card);
  card.style.width = `${roundLayoutNumber(rect.width)}px`;
  card.style.minHeight = `${roundLayoutNumber(rect.height)}px`;
  card.style.height = `${roundLayoutNumber(rect.height)}px`;
  card.style.justifySelf = "start";
  card.style.alignSelf = "start";
  return snapshot;
}

function startCardLayoutCompaction(card: HTMLElement, activeAnimation: ActiveLayoutAnimation, nextRect: DOMRect): void {
  card.style.transition = "none";
  void card.offsetWidth;

  window.requestAnimationFrame(() => {
    if (activeLayoutAnimations.get(card) !== activeAnimation) return;
    card.style.transition = [
      `width ${SESSION_CARD_LAYOUT_COMPACT_PHASE_MS}ms ${SESSION_CARD_LAYOUT_EASING}`,
      `min-height ${SESSION_CARD_LAYOUT_COMPACT_PHASE_MS}ms ${SESSION_CARD_LAYOUT_EASING}`,
      `height ${SESSION_CARD_LAYOUT_COMPACT_PHASE_MS}ms ${SESSION_CARD_LAYOUT_EASING}`
    ].join(", ");
    card.style.width = `${roundLayoutNumber(nextRect.width)}px`;
    card.style.minHeight = `${roundLayoutNumber(nextRect.height)}px`;
    card.style.height = `${roundLayoutNumber(nextRect.height)}px`;
  });
}

function startCardLayoutExpansion(card: HTMLElement, activeAnimation: ActiveLayoutAnimation, nextRect: DOMRect): void {
  card.classList.remove("is-layout-moving");
  card.classList.add("is-layout-expanding");
  card.style.transition = [
    `width ${SESSION_CARD_LAYOUT_EXPAND_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`,
    `min-height ${SESSION_CARD_LAYOUT_EXPAND_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`,
    `height ${SESSION_CARD_LAYOUT_EXPAND_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`
  ].join(", ");
  card.style.width = "100%";
  card.style.minHeight = `${roundLayoutNumber(nextRect.height)}px`;
  card.style.height = `${roundLayoutNumber(nextRect.height)}px`;

  const cleanupTimer = window.setTimeout(
    () => completeCardLayoutAnimation(card, activeAnimation),
    SESSION_CARD_LAYOUT_EXPAND_DURATION_MS + SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS
  );
  activeAnimation.timers.push(cleanupTimer);
}

function settleCardLayoutAnimation(card: HTMLElement, activeAnimation: ActiveLayoutAnimation): void {
  card.classList.remove("is-layout-moving", "is-layout-compacting");
  card.classList.add("is-layout-locking");
  const cleanupTimer = window.setTimeout(() => completeCardLayoutAnimation(card, activeAnimation), SESSION_CARD_LAYOUT_LOCK_MS);
  activeAnimation.timers.push(cleanupTimer);
}

function completeCardLayoutAnimation(card: HTMLElement, activeAnimation: ActiveLayoutAnimation): void {
  if (activeLayoutAnimations.get(card) !== activeAnimation) return;
  activeLayoutAnimations.delete(card);
  for (const timer of activeAnimation.timers) window.clearTimeout(timer);
  activeAnimation.animation?.cancel?.();
  restoreCardLayoutStyles(card, activeAnimation.inlineStyle);
  removeLayoutPhaseClasses(card);
}

function cancelCardLayoutAnimation(card: HTMLElement): void {
  const activeAnimation = activeLayoutAnimations.get(card);
  if (!activeAnimation) return;
  activeLayoutAnimations.delete(card);
  for (const timer of activeAnimation.timers) window.clearTimeout(timer);
  activeAnimation.animation?.cancel?.();
  restoreCardLayoutStyles(card, activeAnimation.inlineStyle);
  removeLayoutPhaseClasses(card);
}

function cancelActiveCardLayoutAnimations(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".session-card[data-session-id]").forEach((card) => cancelCardLayoutAnimation(card));
}

function restoreCardLayoutStyles(card: HTMLElement, snapshot: InlineLayoutStyleSnapshot | undefined): void {
  if (!snapshot) return;
  card.style.alignSelf = snapshot.alignSelf;
  card.style.height = snapshot.height;
  card.style.justifySelf = snapshot.justifySelf;
  card.style.minHeight = snapshot.minHeight;
  card.style.transform = snapshot.transform;
  card.style.transformOrigin = snapshot.transformOrigin;
  card.style.transition = snapshot.transition;
  card.style.width = snapshot.width;
}

function removeLayoutPhaseClasses(card: HTMLElement): void {
  card.classList.remove(
    "is-layout-animating",
    "is-layout-reorder",
    "is-layout-shrinking",
    "is-layout-growing",
    "is-layout-compacting",
    "is-layout-moving",
    "is-layout-expanding",
    "is-layout-locking"
  );
}

function semanticHeadlineSignature(card: SessionCardView): string {
  return [card.headline.headline, card.title, card.project].join("\u0000");
}

function shouldAnimateHeadlineChange(card: SessionCardView): boolean {
  return card.lifecycle === "running";
}

function laneDescription(laneId: LifecycleLaneView["laneId"]): string {
  const descriptions: Record<LifecycleLaneView["laneId"], string> = {
    running: "Active now",
    idle: "Quiet but open",
    needs_action: "Ended follow-up",
    history: "Filed away"
  };
  return descriptions[laneId];
}
