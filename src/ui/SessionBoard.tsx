import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { LifecycleLaneView, SessionCardView } from "../core/types";
import type { CardDensity } from "./toolbarOptions";
import { sessionDemoTelemetry } from "./observabilityDemo";
import { SessionCard } from "./SessionCard";
import { prefersReducedMotion } from "./motionPreference";

type CardLayoutSnapshot = Map<string, DOMRect>;

export const SESSION_CARD_LAYOUT_DURATION_MS = 980;
export const SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS = 40;
export const SESSION_CARD_LAYOUT_STAGGER_MS = 32;
export const SESSION_CARD_LAYOUT_EASING = "cubic-bezier(0.24, 0.08, 0.18, 1)";

const activeLayoutAnimations = new WeakMap<HTMLElement, Animation>();

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
  const refreshPulseSignaturesRef = useRef<Map<string, string> | null>(null);
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
      .filter((card) => previousSignatures.has(card.sessionId) && previousSignatures.get(card.sessionId) !== semanticHeadlineSignature(card))
      .map((card) => card.sessionId);
    return new Map(updatedSessionIds.map((sessionId, index) => [sessionId, index]));
  }, [cards]);
  const refreshPulseOrder = useMemo(() => {
    const previousSemanticSignatures = semanticHeadlineSignaturesRef.current;
    const previousRefreshSignatures = refreshPulseSignaturesRef.current;
    if (!previousSemanticSignatures || !previousRefreshSignatures) return new Map<string, number>();

    const pulsedSessionIds = cards
      .filter((card) => {
        if (!previousSemanticSignatures.has(card.sessionId)) return false;
        if (previousSemanticSignatures.get(card.sessionId) !== semanticHeadlineSignature(card)) return false;
        const nextRefreshSignature = refreshPulseSignature(card);
        return nextRefreshSignature !== "" && previousRefreshSignatures.get(card.sessionId) !== nextRefreshSignature;
      })
      .map((card) => card.sessionId);
    return new Map(pulsedSessionIds.map((sessionId, index) => [sessionId, index]));
  }, [cards]);

  useEffect(() => {
    if (!seenSessionIdsRef.current) {
      seenSessionIdsRef.current = new Set(cards.map((card) => card.sessionId));
    }

    for (const card of cards) {
      seenSessionIdsRef.current.add(card.sessionId);
    }

    semanticHeadlineSignaturesRef.current = new Map(cards.map((card) => [card.sessionId, semanticHeadlineSignature(card)]));
    refreshPulseSignaturesRef.current = new Map(cards.map((card) => [card.sessionId, refreshPulseSignature(card)]));
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
                refreshPulseIndex={refreshPulseOrder.get(card.sessionId)}
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
                      refreshPulseIndex={refreshPulseOrder.get(sessionId)}
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
  const previousOrderSignatureRef = useRef<string | null>(null);
  const orderSignature = cards.map((card) => card.sessionId).join("\u0000");

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const previousLayout = previousLayoutRef.current;
    const previousOrderSignature = previousOrderSignatureRef.current;
    const nextLayout = captureCardLayout(grid);

    previousLayoutRef.current = nextLayout;
    previousOrderSignatureRef.current = orderSignature;

    if (!previousLayout || previousOrderSignature === null || prefersReducedMotion()) {
      return;
    }

    animateCardLayoutFrom(grid, previousLayout);
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

function animateCardLayoutFrom(container: HTMLElement, previousLayout: CardLayoutSnapshot): void {
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

    const keyframes = steelPlateLayoutKeyframes({ deltaX, deltaY, scaleX, scaleY });
    const previousAnimation = activeLayoutAnimations.get(card);
    previousAnimation?.cancel();
    activeLayoutAnimations.delete(card);

    card.classList.add("is-layout-animating");
    if (typeof card.animate !== "function") {
      animateCardLayoutWithInlineStyle(card, keyframes[0]);
      return;
    }

    const animation = card.animate(keyframes, {
      delay: index * SESSION_CARD_LAYOUT_STAGGER_MS,
      duration: SESSION_CARD_LAYOUT_DURATION_MS,
      easing: SESSION_CARD_LAYOUT_EASING,
      fill: "both"
    });
    activeLayoutAnimations.set(card, animation);
    const cleanup = () => {
      if (activeLayoutAnimations.get(card) === animation) {
        activeLayoutAnimations.delete(card);
        card.classList.remove("is-layout-animating");
      }
    };
    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  });
}

function steelPlateLayoutKeyframes({
  deltaX,
  deltaY,
  scaleX,
  scaleY
}: {
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
}): Keyframe[] {
  return [
    {
      transform: layoutTransform(deltaX, deltaY, scaleX, scaleY)
    },
    {
      offset: 0.62,
      transform: layoutTransform(deltaX * 0.22, deltaY * 0.22, dampedScale(scaleX, 0.22), dampedScale(scaleY, 0.22))
    },
    {
      offset: 0.86,
      transform: layoutTransform(deltaX * 0.045, deltaY * 0.045, dampedScale(scaleX, 0.045), dampedScale(scaleY, 0.045))
    },
    {
      transform: layoutTransform(0, 0, 1, 1)
    }
  ];
}

function dampedScale(value: number, remainingRatio: number): number {
  return 1 + (value - 1) * remainingRatio;
}

function layoutTransform(x: number, y: number, scaleX = 1, scaleY = scaleX): string {
  return `translate(${roundLayoutNumber(x)}px, ${roundLayoutNumber(y)}px) scale(${roundLayoutNumber(scaleX)}, ${roundLayoutNumber(scaleY)})`;
}

function roundLayoutNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function animateCardLayoutWithInlineStyle(card: HTMLElement, firstKeyframe: Keyframe): void {
  const previousTransition = card.style.transition;
  const previousTransform = card.style.transform;
  const previousTransformOrigin = card.style.transformOrigin;

  card.style.transition = "none";
  card.style.transformOrigin = "top left";
  card.style.transform = typeof firstKeyframe.transform === "string" ? firstKeyframe.transform : "";
  void card.offsetWidth;

  window.requestAnimationFrame(() => {
    card.style.transition = `transform ${SESSION_CARD_LAYOUT_DURATION_MS}ms ${SESSION_CARD_LAYOUT_EASING}`;
    card.style.transform = layoutTransform(0, 0, 1, 1);

    window.setTimeout(() => {
      card.style.transition = previousTransition;
      card.style.transform = previousTransform;
      card.style.transformOrigin = previousTransformOrigin;
      card.classList.remove("is-layout-animating");
    }, SESSION_CARD_LAYOUT_DURATION_MS + SESSION_CARD_LAYOUT_CLEANUP_BUFFER_MS);
  });
}

function semanticHeadlineSignature(card: SessionCardView): string {
  return [card.headline.headline, card.title, card.project].join("\u0000");
}

function refreshPulseSignature(card: SessionCardView): string {
  return card.headlineRefresh?.status === "success" ? card.headlineRefresh.requestedAt : "";
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
