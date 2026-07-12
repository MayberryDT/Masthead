import type { KnowledgeFlowSummaryDto } from "../shared/knowledgeFlow";
import { AnimatedNumber } from "./motion/AnimatedNumber";

type Props = {
  summary?: KnowledgeFlowSummaryDto;
  loading?: boolean;
  error?: string;
};

export function SidebarKnowledgeFlow({ summary, error }: Props) {
  const unavailable = Boolean(error);
  const value = (count: number | undefined) =>
    unavailable || count === undefined ? undefined : count;

  return (
    <section className={`sidebar-knowledge-flow ${unavailable ? "unavailable" : ""}`} aria-label="Knowledge flow">
      <div className="sidebar-knowledge-spine">
        <FlowRow index="01" label="Capture sessions" value={value(summary?.capturedSessions)} />
        <FlowRow index="02" label="Workbench" value={value(summary?.workbenchSessions)} />
        <FlowRow index="03" label="Publish artifacts" value={value(summary?.publishedArtifacts)} />
      </div>
      <p className="sidebar-knowledge-resolved">
        {unavailable
          ? "Summary unavailable"
          : summary?.automaticallyResolvedSessions === undefined
            ? "— automatically resolved"
            : <><AnimatedNumber className="sidebar-knowledge-inline-value" value={summary.automaticallyResolvedSessions} /> automatically resolved</>}
      </p>
    </section>
  );
}

function FlowRow({ index, label, value }: { index: string; label: string; value?: number }) {
  return (
    <div className="sidebar-knowledge-spine-row">
      <span className="sidebar-knowledge-node">{index}</span>
      <span className="sidebar-knowledge-stage-name">{label}</span>
      {value === undefined
        ? <strong className="sidebar-knowledge-stage-value">—</strong>
        : <AnimatedNumber className="sidebar-knowledge-stage-value" value={value} />}
    </div>
  );
}
