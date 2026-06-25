import type { ReactNode } from "react";
import sailLogoUrl from "./assets/masthead-logo-sail.png";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";

type Props = {
  version: string;
  activeCount: number;
  alertCount?: number;
  activeSurface?: AppSurface;
  onSurfaceChange?: (surface: AppSurface) => void;
};

export type AppSurface = "board" | "logbook" | "sources" | "settings";

export function ObservabilitySidebar({ version, activeCount, alertCount = 3, activeSurface = "board", onSurfaceChange }: Props) {
  return (
    <div className="sidebar-shell">
      <a className="sidebar-brand" href="#overview" aria-label="Masthead overview">
        <img className="brand-sail" src={sailLogoUrl} alt="" aria-hidden="true" />
        <span>
          <strong>Masthead</strong>
          <small className="version-number">{version}</small>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="Observability sections">
        <SidebarGroup title="Overview">
          <SidebarLink
            href="#sessions"
            icon="sessions"
            label="Sessions"
            count={activeCount}
            active={activeSurface === "board"}
            onClick={() => onSurfaceChange?.("board")}
          />
          <SidebarLink href="#top-models" icon="models" label="Models" />
          <SidebarLink href="#attention" icon="alerts" label="Alerts" count={alertCount} alertCount />
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
        </SidebarGroup>
        <SidebarGroup title="Analysis">
          <SidebarLink href="#tokens-per-minute" icon="performance" label="Performance" />
          <SidebarLink href="#usage" icon="usage" label="Usage" />
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
  alertCount = false,
  onClick
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  alertCount?: boolean;
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
      {count !== undefined ? <strong className={alertCount ? "alert-count" : ""}>{count}</strong> : null}
    </a>
  );
}
