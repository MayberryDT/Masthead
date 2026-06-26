import type { CSSProperties, ReactNode } from "react";

const enabled =
  import.meta.env.DEV && import.meta.env.VITE_MASTHEAD_DEV_CITATIONS === "1";

function getCiteColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = [
    "#ffeb3b",
    "#4caf50",
    "#2196f3",
    "#e91e63",
    "#ff9800",
    "#9c27b0",
    "#00bcd4",
  ];
  return palette[Math.abs(hash) % palette.length];
}

type CiteStyle = CSSProperties & { "--cite-color"?: string };

export function DevCite({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  const color = getCiteColor(name);
  const style: CiteStyle = {
    "--cite-color": color,
  };

  return (
    <div data-ui-cite={name} style={style} className="dev-cite">
      {children}
      <span
        className="dev-cite-label"
        style={{ background: color, color: "#000" }}
      >
        {name}
      </span>
    </div>
  );
}
