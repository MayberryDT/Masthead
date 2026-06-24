import type { LifecycleLaneView, SessionCardView } from "../core/types";
import type { CardDensity } from "./toolbarOptions";
import { sessionDemoTelemetry } from "./observabilityDemo";
import { SessionCard } from "./SessionCard";

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
          <div className={`observability-card-grid ${density === "compact" ? "compact" : ""}`.trim()}>
            {cards.map((card, index) => (
              <SessionCard
                key={card.sessionId}
                session={card}
                onToggle={onOpenSession}
                demoTelemetry={showDemoTelemetry ? sessionDemoTelemetry(card.sessionId, index) : undefined}
              />
            ))}
          </div>
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
                  return card ? <SessionCard key={sessionId} session={card} onToggle={onOpenSession} /> : null;
                })
              )}
            </div>
          </section>
        ))
      )}
    </section>
  );
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
