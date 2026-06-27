import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
};

export function ObservabilityConsoleShell({ sidebar, main }: Props) {
  return <AppShell sidebar={sidebar} main={main} />;
}
