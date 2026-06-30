import type { ReactNode } from "react";
import type { UsageStatsDto } from "../app/daemonClient";
import sailLogoUrl from "./assets/masthead-logo-sail.png";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { SidebarUsageStats } from "./SidebarUsageStats";

type Props = {
  version: string;
  activeCount: number;
  activeSurface?: AppSurface;
  usageStats?: UsageStatsDto;
  usageLoading?: boolean;
  usageError?: string;
  onSurfaceChange?: (surface: AppSurface) => void;
};

export type AppSurface = "now" | "logbook" | "sources" | "usage" | "settings";

export function ObservabilitySidebar({
  version,
  activeCount,
  activeSurface = "now",
  usageStats,
  usageLoading,
  usageError,
  onSurfaceChange
}: Props) {
  return (
    <div className="sidebar-shell">
      <a className="sidebar-brand" href="#overview" aria-label="Masthead overview">
        <img className="brand-sail" src={sailLogoUrl} alt="" aria-hidden="true" />
        <span>
          <strong>Masthead</strong>
          <small className="version-number">{version}</small>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="Masthead sections">
        <SidebarGroup>
          <SidebarLink
            href="#board"
            icon="sessions"
            label="Board"
            count={activeCount}
            active={activeSurface === "now"}
            onClick={() => onSurfaceChange?.("now")}
          />
          <SidebarLink
            href="#logbook"
            icon="logbook"
            label="Logbook"
            active={activeSurface === "logbook"}
            onClick={() => onSurfaceChange?.("logbook")}
          />
          <SidebarLink
            href="#sources"
            icon="sources"
            label="Sources"
            active={activeSurface === "sources"}
            onClick={() => onSurfaceChange?.("sources")}
          />
          <SidebarLink
            href="#usage"
            icon="usage"
            label="Usage"
            active={activeSurface === "usage"}
            onClick={() => onSurfaceChange?.("usage")}
          />
          <SidebarLink
            href="#settings"
            icon="settings"
            label="Settings"
            active={activeSurface === "settings"}
            onClick={() => onSurfaceChange?.("settings")}
          />
        </SidebarGroup>
      </nav>
      <SidebarUsageStats stats={usageStats} loading={usageLoading} error={usageError} />
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
  href,
  icon,
  label,
  count,
  active = false,
  onClick
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      className={`sidebar-link ${active ? "active" : ""}`}
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={
        onClick
          ? (event) => {
              event.preventDefault();
              onClick();
            }
          : undefined
      }
    >
      <span className="sidebar-icon" aria-hidden="true">
        <Icon name={icon} size="sidebar" weight={active ? iconWeights.sidebarSelected : iconWeights.sidebarInactive} />
      </span>
      <span>{label}</span>
      {count !== undefined ? <strong>{count}</strong> : null}
    </a>
  );
}
