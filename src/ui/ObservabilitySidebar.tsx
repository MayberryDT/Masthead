import type { ReactNode } from "react";
import sailLogoUrl from "./assets/masthead-logo-sail.png";

type Props = {
  version: string;
  activeCount: number;
  alertCount?: number;
};

export function ObservabilitySidebar({ version, activeCount, alertCount = 3 }: Props) {
  return (
    <div className="sidebar-shell">
      <a className="sidebar-brand" href="#overview" aria-label="Masthead overview">
        <img className="brand-sail" src={sailLogoUrl} alt="" aria-hidden="true" />
        <span>
          <strong>Masthead</strong>
          <small>{version}</small>
        </span>
      </a>

      <nav className="sidebar-nav" aria-label="Observability sections">
        <SidebarGroup title="Overview">
          <SidebarLink href="#sessions" icon={<SessionsIcon />} label="Sessions" count={activeCount} active />
          <SidebarLink href="#top-models" icon={<ModelsIcon />} label="Models" />
          <SidebarLink href="#attention" icon={<AlertsIcon />} label="Alerts" count={alertCount} alertCount />
          <SidebarLink href="#logbook" icon={<LogbookIcon />} label="Logbook" />
        </SidebarGroup>
        <SidebarGroup title="Analysis">
          <SidebarLink href="#tokens-per-minute" icon={<PerformanceIcon />} label="Performance" />
          <SidebarLink href="#usage" icon={<UsageIcon />} label="Usage" />
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
  alertCount = false
}: {
  href: string;
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  alertCount?: boolean;
}) {
  return (
    <a className={`sidebar-link ${active ? "active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      <span className="sidebar-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      {count !== undefined ? <strong className={alertCount ? "alert-count" : ""}>{count}</strong> : null}
    </a>
  );
}

function SessionsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M8 4v16M16 4v16" />
      <path d="M4 8h6M14 8h6M4 16h6M14 16h6" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="12" r="2" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
      <path d="M6 6l3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3 3.7 18h16.6L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function LogbookIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 7h8M8 12h8M8 17h5" />
    </svg>
  );
}

function PerformanceIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m4 16 5-5 4 4 7-8" />
      <path d="M4 20h16" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}
