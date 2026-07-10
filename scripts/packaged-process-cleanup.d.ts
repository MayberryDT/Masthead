export function parseWindowsListenerPid(output: string, port: number): number | undefined;
export function buildWindowsTaskkillInvocation(
  pid: number,
  force: boolean,
  systemRoot?: string
): { args: string[]; command: string };
export type WindowsProcessIdentity = { creationTime: string; pid: number };
export type WindowsProcessRecord = WindowsProcessIdentity & { parentPid: number };
export function buildWindowsProcessSnapshotInvocation(systemRoot?: string): { args: string[]; command: string };
export function parseWindowsProcessSnapshot(output: string): WindowsProcessRecord[];
export function collectWindowsDescendantPids(
  snapshot: WindowsProcessRecord[],
  rootPids: Iterable<number>
): number[];
export function windowsProcessBelongsToTree(
  snapshot: WindowsProcessRecord[],
  processIdentity: WindowsProcessIdentity,
  attributedProcesses: Iterable<WindowsProcessIdentity>
): boolean;
