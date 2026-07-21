export type AuthoringPerfProbeInput =
  | { dbCopy: string; fixtureSessions?: never }
  | { dbCopy?: never; fixtureSessions: number };

export type ProbeChild = {
  exitCode: number | null;
  signalCode?: string | null;
  kill: (signal: "SIGTERM" | "SIGKILL") => boolean;
  once?: (event: "exit", listener: () => void) => unknown;
  off?: (event: "exit", listener: () => void) => unknown;
};

export type ProbeResult = {
  baseUrl: string;
  healthReadyMs: number;
  endpoints: Record<string, { p95Ms: number; samplesMs: number[] }>;
};

export function allocateLoopbackPort(options?: {
  createServer?: () => {
    once: (event: "error", listener: (error: Error) => void) => unknown;
    listen: (port: number, host: string, listener: () => void) => unknown;
    address: () => string | { port: number } | null;
    close: (listener: (error?: Error) => void) => unknown;
  };
}): Promise<number>;

export function assertSafeDatabaseCopySource(
  sourcePath: string,
  options?: { homeDir?: string }
): Promise<string>;

export function assertIsolatedProbeRuntime(input: {
  baseUrl: string;
  homeDir?: string;
  liveProductionBaseUrl?: string;
  manifestPath: string;
}): void;

export function runAuthoringPerfProbe(
  input: AuthoringPerfProbeInput,
  dependencyOverrides?: {
    allocatePort?: () => Promise<number>;
    createWorkspace?: () => Promise<string>;
    prepareFixtureDatabase?: (databasePath: string, fixtureSessions: number) => Promise<void>;
    probe?: (baseUrl: string, path: string, timeoutMs: number) => Promise<number>;
    spawnDaemon?: (input: {
      baseUrl: string;
      databasePath: string;
      dataDirectory: string;
      instanceDirectory: string;
      manifestPath: string;
      port: number;
      workspace: string;
    }) => ProbeChild;
    terminateChild?: (child: ProbeChild | undefined) => Promise<void>;
    waitForHealth?: (baseUrl: string, child: ProbeChild, timeoutMs: number) => Promise<number>;
  }
): Promise<ProbeResult>;

export function percentile95(samples: number[]): number;

export function waitForDaemonHealth(
  baseUrl: string,
  child: Pick<ProbeChild, "exitCode">,
  timeoutMs: number,
  options?: { fetchImpl?: typeof fetch }
): Promise<number>;

export function probeEndpoint(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  options?: { fetchImpl?: typeof fetch }
): Promise<number>;

export function terminateChild(
  child: ProbeChild | undefined,
  options?: { killTimeoutMs?: number; termTimeoutMs?: number }
): Promise<void>;

export function seedFixtureData(
  db: {
    exec: (sql: string) => unknown;
    prepare: (sql: string) => { run: (...parameters: any[]) => unknown };
  },
  fixtureSessions: number
): void;
