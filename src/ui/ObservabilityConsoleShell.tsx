import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  rightRail: ReactNode;
};

export function ObservabilityConsoleShell({ sidebar, main, rightRail }: Props) {
  return <AppShell sidebar={sidebar} main={main} rightRail={rightRail} />;
}
