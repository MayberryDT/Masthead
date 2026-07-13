export type ProductionConfig = {
  bundleDigest: string;
  dataDirectory: string;
  databasePath: string;
  expectedDatabaseId?: string;
  expectedSchemaVersion?: number;
  gitSha?: string;
  lifecycleLeasePath?: string;
  port: number;
  productionRoot: string;
  target: string;
  transitionNonce?: string;
  version?: string;
};

export type ProductionProcessRecord = {
  argv: string[];
  environ: Record<string, string>;
  exe: string;
  pid: number;
  starttime: string;
};

export function acquireLifecycleLease(path: string): Promise<{ release(): Promise<void> }>;
export function assertColdProductionOffline(
  config: ProductionConfig,
  dependencies?: Record<string, unknown>
): Promise<void>;
export function productionHealthPollPolicy(): { intervalMs: 250; maxAttempts: 1200; timeoutMs: 300000 };
export function readProductionProcesses(adapters?: {
  concurrency?: number;
  entries?: () => Promise<string[]>;
  maxEntries?: number;
  now?: () => number;
  readProcess?: (pid: number) => Promise<ProductionProcessRecord | undefined>;
  timeoutMs?: number;
}): Promise<ProductionProcessRecord[]>;
export function waitForProductionHealth(
  config: { port: number },
  adapters?: {
    delay?: (milliseconds: number) => Promise<void>;
    fetchHealth?: (port: number, timeoutMs: number) => Promise<unknown>;
    now?: () => number;
  }
): Promise<unknown>;
export function waitForMaintenanceChild(
  child: import("node:child_process").ChildProcess,
  action: string,
  timeoutMs: number,
  exitGraceMs?: number,
  identity?: Promise<{ pid: number; starttime: string }>,
  identityReader?: (pid: number) => Promise<{ pid: number; starttime: string } | undefined>
): Promise<unknown>;
export function stopColdMaintenanceChildren(
  config: ProductionConfig,
  request: Record<string, unknown>,
  dependencies?: Record<string, unknown>
): Promise<void>;
export function classifyProductionProcess(
  record: ProductionProcessRecord,
  config: ProductionConfig
): (ProductionProcessRecord & { role: "daemon" | "electron"; target: string }) | undefined;
export function installProductionLauncher(input: {
  bundleDigest: string;
  bundlePath: string;
  dataDirectory?: string;
  databasePath?: string;
  homeDir?: string;
  port?: number;
  productionRoot?: string;
}): Promise<{ desktopPath: string; gitSha: string; launcherPath: string; target: string; version: string }>;
export function installDisabledProductionSurface(input: {
  databasePath: string;
  homeDir?: string;
}): Promise<{ desktopPath: string; launcherPath: string }>;
export function captureLegacyTargetIdentity(
  target: string,
  productionRoot: string,
  adapters?: Record<string, unknown>
): Promise<{ device: string; inode: string; path: string }>;
export function coldActivateProduction(input: {
  bundleDigest: string;
  bundlePath: string;
  dataDirectory?: string;
  databasePath: string;
  homeDir?: string;
  port?: number;
  productionRoot?: string;
}, dependencies?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function startProduction(config: ProductionConfig, dependencies?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function stopProduction(config: ProductionConfig, dependencies?: Record<string, unknown>): Promise<{
  stopped: boolean;
  stoppedPids: number[];
}>;
export function statusProduction(config: ProductionConfig, dependencies?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function transitionProduction(input: {
  bundleDigest: string;
  bundlePath: string;
  dataDirectory?: string;
  databasePath?: string;
  homeDir?: string;
  port?: number;
  productionRoot?: string;
}, dependencies?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function runCli(argv?: string[], environment?: NodeJS.ProcessEnv): Promise<Record<string, unknown>>;
