export function parseWindowsListenerPid(output: string, port: number): number | undefined;
export function buildWindowsTaskkillInvocation(
  pid: number,
  force: boolean,
  systemRoot?: string
): { args: string[]; command: string };
export type WindowsProcessRecord = { parentPid: number; pid: number };
export function buildWindowsProcessSnapshotInvocation(systemRoot?: string): { args: string[]; command: string };
export function parseWindowsProcessSnapshot(output: string): WindowsProcessRecord[];
export function collectWindowsDescendantPids(
  snapshot: WindowsProcessRecord[],
  rootPids: Iterable<number>
): number[];
export function windowsProcessBelongsToTree(
  snapshot: WindowsProcessRecord[],
  pid: number,
  attributedPids: Iterable<number>
): boolean;
