import { win32 } from "node:path";

export function parseWindowsListenerPid(output, port) {
  for (const line of output.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 5 || fields[0]?.toUpperCase() !== "TCP" || fields[3]?.toUpperCase() !== "LISTENING") continue;
    const localAddress = fields[1] || "";
    if (localAddress !== `127.0.0.1:${port}`) continue;
    const pid = Number.parseInt(fields[4] || "", 10);
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
  }
  return undefined;
}

export function buildWindowsTaskkillInvocation(pid, force, systemRoot) {
  return {
    args: ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])],
    command: win32.join(systemRoot || "C:\\Windows", "System32", "taskkill.exe")
  };
}

export function buildWindowsProcessSnapshotInvocation(systemRoot) {
  return {
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate); ConvertTo-Json -InputObject $processes -Compress"
    ],
    command: win32.join(
      systemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    )
  };
}

export function parseWindowsProcessSnapshot(output) {
  const parsed = JSON.parse(output.replace(/^\uFEFF/u, "").trim());
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.flatMap((record) => {
    const pid = Number(record?.ProcessId);
    const parentPid = Number(record?.ParentProcessId);
    const creationTime = typeof record?.CreationDate === "string" ? record.CreationDate : undefined;
    return Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0 && creationTime
      ? [{ creationTime, parentPid, pid }]
      : [];
  });
}

export function collectWindowsDescendantPids(snapshot, rootPids) {
  const roots = new Set(rootPids);
  const attributed = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of snapshot) {
      if (!attributed.has(process.pid) && attributed.has(process.parentPid)) {
        attributed.add(process.pid);
        changed = true;
      }
    }
  }
  return [...attributed].filter((pid) => !roots.has(pid)).sort((left, right) => left - right);
}

export function windowsProcessBelongsToTree(snapshot, processIdentity, attributedProcesses) {
  const current = snapshot.find((process) => process.pid === processIdentity.pid);
  if (!current || current.creationTime !== processIdentity.creationTime) return false;
  const attributed = [...attributedProcesses];
  if (attributed.some((process) => process.pid === processIdentity.pid && process.creationTime === processIdentity.creationTime)) {
    return true;
  }
  const byPid = new Map(snapshot.map((process) => [process.pid, process]));
  const visited = new Set([current.pid]);
  let child = current;
  while (child.parentPid > 0 && !visited.has(child.parentPid)) {
    const parent = byPid.get(child.parentPid);
    if (!parent) return false;
    if (attributed.some((process) => process.pid === parent.pid && process.creationTime === parent.creationTime)) {
      return true;
    }
    visited.add(parent.pid);
    child = parent;
  }
  return false;
}
