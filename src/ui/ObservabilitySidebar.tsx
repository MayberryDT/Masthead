import type { ReactNode } from "react";
import sailLogoUrl from "./assets/masthead-logo-sail.png";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";

type Props = {
  version: string;
  activeCount: number;
  activeSurface?: AppSurface;
  onSurfaceChange?: (surface: AppSurface) => void;
};

export type AppSurface = "now" | "logbook" | "sources" | "agent_access" | "settings";

export function ObservabilitySidebar({ version, activeCount, activeSurface = "now", onSurfaceChange }: Props) {
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
        <SidebarGroup title="Workspace">
          <SidebarLink
            href="#now"
            icon="sessions"
            label="Now"
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
            icon="usage"
            label="Sources"
            active={activeSurface === "sources"}
            onClick={() => onSurfaceChange?.("sources")}
          />
          <SidebarLink
            href="#agent-access"
            icon="models"
            label="Agent Access"
            active={activeSurface === "agent_access"}
            onClick={() => onSurfaceChange?.("agent_access")}
          />
          <SidebarLink
            href="#settings"
            icon="models"
            label="Settings"
            active={activeSurface === "settings"}
            onClick={() => onSurfaceChange?.("settings")}
          />
        </SidebarGroup>
      </nav>
    </div>
  );
}

function SidebarGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-group">
      <p>{title}</p>
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
