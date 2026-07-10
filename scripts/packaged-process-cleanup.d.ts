export function parseWindowsListenerPid(output: string, port: number): number | undefined;
export function buildWindowsTaskkillInvocation(
  pid: number,
  force: boolean,
  systemRoot?: string
): { args: string[]; command: string };
