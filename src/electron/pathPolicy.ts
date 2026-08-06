import { join } from "node:path";

export type PackagedDaemonPaths = {
  daemonEntry: string;
  daemonRoot: string;
  hookScript: string;
  mcpEntry: string;
  nodePath: string;
  releaseJson: string;
};

export function isMastheadOwnedDirectory(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((component) => component.toLowerCase().includes("masthead"));
}

export function packagedDaemonPaths(resourcesPath: string): PackagedDaemonPaths {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const daemonRoot = join(resourcesPath, "daemon");
  return {
    daemonRoot,
    nodePath: join(daemonRoot, nodeName),
    daemonEntry: join(daemonRoot, "dist", "src", "daemon", "main.js"),
    hookScript: join(daemonRoot, "scripts", "masthead-hook.js"),
    mcpEntry: join(daemonRoot, "dist", "src", "mcp", "server.js"),
    releaseJson: join(daemonRoot, "release.json")
  };
}
