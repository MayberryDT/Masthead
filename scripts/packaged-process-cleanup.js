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
