import type { ReactNode } from "react";
import type { KnowledgeFlowSummaryDto } from "../shared/knowledgeFlow";
import sailLogoUrl from "./assets/masthead-logo-sail.png";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { SidebarKnowledgeFlow } from "./SidebarKnowledgeFlow";

type Props = {
  version: string;
  activeCount: number;
  activeSurface?: AppSurface;
  knowledgeFlowSummary?: KnowledgeFlowSummaryDto;
  knowledgeFlowLoading?: boolean;
  knowledgeFlowError?: string;
  onSurfaceChange?: (surface: AppSurface) => void;
};

export type AppSurface = "now" | "logbook" | "sources" | "workbench" | "usage" | "settings";

export function ObservabilitySidebar({
  version,
  activeCount,
  activeSurface = "now",
  knowledgeFlowSummary,
  knowledgeFlowLoading,
  knowledgeFlowError,
  onSurfaceChange
}: Props) {
  return (
    <div className="sidebar-shell">
      <div className="sidebar-brand" aria-label="Masthead">
        <img className="brand-sail" src={sailLogoUrl} alt="" aria-hidden="true" />
        <span>
          <strong>Masthead</strong>
          <small className="version-number">{version}</small>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Masthead sections">
        <SidebarGroup>
          <SidebarLink
            icon="sessions"
            label="Now"
            count={activeCount}
            active={activeSurface === "now"}
            onClick={() => onSurfaceChange?.("now")}
          />
          <SidebarLink
            icon="workbench"
            label="Workbench"
            active={activeSurface === "workbench"}
            onClick={() => onSurfaceChange?.("workbench")}
          />
          <SidebarLink
            icon="logbook"
            label="Logbook"
            active={activeSurface === "logbook"}
            onClick={() => onSurfaceChange?.("logbook")}
          />
          <SidebarLink
            icon="usage"
            label="Usage"
            active={activeSurface === "usage"}
            onClick={() => onSurfaceChange?.("usage")}
          />
          <SidebarLink
            icon="sources"
            label="Sources"
            active={activeSurface === "sources"}
            onClick={() => onSurfaceChange?.("sources")}
          />
          <SidebarLink
            icon="settings"
            label="Settings"
            active={activeSurface === "settings"}
            onClick={() => onSurfaceChange?.("settings")}
          />
        </SidebarGroup>
      </nav>
      <SidebarKnowledgeFlow
        summary={knowledgeFlowSummary}
        loading={knowledgeFlowLoading}
        error={knowledgeFlowError}
      />
    </div>
  );
}

function SidebarGroup({ children }: { children: ReactNode }) {
  return (
    <section className="sidebar-group">
      <div>{children}</div>
    </section>
  );
}

function SidebarLink({
  icon,
  label,
  count,
  active = false,
  onClick
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-link ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="sidebar-icon" aria-hidden="true">
        <Icon name={icon} size="sidebar" weight={active ? iconWeights.sidebarSelected : iconWeights.sidebarInactive} />
      </span>
      <span>{label}</span>
      {count !== undefined ? <strong>{count}</strong> : null}
    </button>
  );
}
