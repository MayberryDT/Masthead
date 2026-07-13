export type ProductionConfig = {
  bundleDigest: string;
  dataDirectory: string;
  databasePath: string;
  gitSha?: string;
  lifecycleLeasePath?: string;
  port: number;
  productionRoot: string;
  target: string;
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
export function productionHealthPollPolicy(): { intervalMs: 250; maxAttempts: 1200; timeoutMs: 300000 };
export function productionShutdownTimeout(migrationActive: boolean): 30000 | 1800000;
export function waitForProductionHealth(
  config: { port: number },
  adapters?: {
    delay?: (milliseconds: number) => Promise<void>;
    fetchHealth?: (port: number, timeoutMs: number) => Promise<unknown>;
    migrationActive?: () => Promise<boolean>;
    now?: () => number;
  }
): Promise<unknown>;
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
