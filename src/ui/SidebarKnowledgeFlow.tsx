import type { KnowledgeFlowSummaryDto } from "../shared/knowledgeFlow";

type Props = {
  summary?: KnowledgeFlowSummaryDto;
  loading?: boolean;
  error?: string;
};

export function SidebarKnowledgeFlow({ summary, loading = false, error }: Props) {
  const unavailable = Boolean(error);
  const value = (count: number | undefined) =>
    loading || unavailable || count === undefined ? "—" : formatCount(count);

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
          : `${value(summary?.automaticallyResolvedSessions)} automatically resolved`}
      </p>
    </section>
  );
}

function FlowRow({ index, label, value }: { index: string; label: string; value: string }) {
  return (
    <div className="sidebar-knowledge-spine-row">
      <span className="sidebar-knowledge-node">{index}</span>
      <span className="sidebar-knowledge-stage-name">{label}</span>
      <strong className="sidebar-knowledge-stage-value">{value}</strong>
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}
