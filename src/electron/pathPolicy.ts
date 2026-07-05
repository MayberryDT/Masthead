import { join } from "node:path";

export type PackagedDaemonPaths = {
  daemonEntry: string;
  hookScript: string;
  mcpEntry: string;
  nodePath: string;
};

export function isMastheadOwnedDirectory(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((component) => component.toLowerCase().includes("masthead"));
}

export function packagedDaemonPaths(resourcesPath: string): PackagedDaemonPaths {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  return {
    nodePath: join(resourcesPath, "daemon", nodeName),
    daemonEntry: join(resourcesPath, "daemon", "dist", "src", "daemon", "main.js"),
    hookScript: join(resourcesPath, "daemon", "scripts", "masthead-hook.js"),
    mcpEntry: join(resourcesPath, "daemon", "dist", "src", "mcp", "server.js")
  };
}
