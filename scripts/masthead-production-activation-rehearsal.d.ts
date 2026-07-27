export interface RehearsalBundleValidation {
  bundle: string;
  layout: {
    bundleRoot: string;
    executablePath: string;
    nodePath: string;
    resourcesPath: string;
  };
  manifest: {
    bundleDigest: string;
    release: { gitSha: string; version: string };
  };
  livePaths: string[];
}

export function validateRehearsalBundle(
  argv: string[],
  environment?: NodeJS.ProcessEnv
): Promise<RehearsalBundleValidation>;

export function runProductionActivationRehearsal(
  argv?: string[],
  environment?: NodeJS.ProcessEnv
): Promise<{ ok: true; bundle: string; headless: true; isolated: true; matrix: PackageBoundMatrixResult }>;

export interface PackageBoundMatrixResult {
  source: "supplied-package";
  executedCaseCount: 31;
  expectedCaseCount: 31;
  minimumCaseCount: 31;
  caseIds: string[];
}

export interface FixtureProcessRecord {
  controlGroup?: string;
  pid: number;
  ppid?: number;
  signalSafe?: boolean;
  starttime: string;
}

export interface ObservedFixtureProcessRecord extends FixtureProcessRecord {
  ppid: number;
}

export interface ClaimedExternalControlGroup {
  controlGroup: string;
  startPid: number;
  trustedIdentities: Array<Pick<FixtureProcessRecord, "pid" | "starttime">>;
}

export type FixtureSignalResult =
  | { status: "signaled" }
  | { status: "already-exited" }
  | { status: "reused"; observedStarttime: string };

export interface BoundedFixtureSubprocessOptions {
  allowedLiveIdentities?: FixtureProcessRecord[];
  captureAllowedLiveIdentities?: (input: {
    claimExternalScope: (claim: {
      startPid: number;
      daemonPid: number;
      daemonAlreadyContained?: boolean;
      deadline?: number;
    }) => Promise<ClaimedExternalControlGroup>;
    fixtureRoot: string;
    inspectProcesses: () => Promise<FixtureProcessRecord[]>;
    result: { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };
  }) => Promise<FixtureProcessRecord[]>;
  environment?: NodeJS.ProcessEnv;
  fixtureRoot: string;
  maxOutputBytes?: number;
  naturalExitGraceMs?: number;
  postKillTimeoutMs?: number;
  processSetAdapters?: {
    inspect?: (fixtureRoot: string, deadline?: number) => Promise<FixtureProcessRecord[]>;
    signalIdentity?: (
      record: FixtureProcessRecord,
      signal: "SIGTERM" | "SIGKILL",
      deadline?: number
    ) => FixtureSignalResult | Promise<FixtureSignalResult>;
  };
  timeoutMs: number;
}

export function runBoundedFixtureSubprocess(
  executable: string,
  args: string[],
  options: BoundedFixtureSubprocessOptions
): Promise<{
  allowedLiveIdentities: FixtureProcessRecord[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

export function retryTransientProcessScan<T>(operation: () => T | Promise<T>): Promise<T>;

export function runReceiptBoundStopAndStatus(
  runLifecycleCommand: (
    launcher: string,
    args: string[],
    environment: NodeJS.ProcessEnv
  ) => Promise<Record<string, unknown>>,
  launcherPath: string,
  environment: NodeJS.ProcessEnv
): Promise<{ stopped: Record<string, unknown>; status: Record<string, unknown> }>;

export function assertIdentityBoundSignalingAvailable(): Promise<void>;

export function assertFixtureContainmentAvailable(): Promise<void>;

export function signalFixtureProcessIdentity(
  record: FixtureProcessRecord,
  signal: "SIGTERM" | "SIGKILL",
  deadline?: number
): Promise<FixtureSignalResult>;

export function inspectClaimedFixtureProcessSetForTest(
  input: {
    fixtureRoot: string;
    currentScope: string;
    claimedExternalControlGroups: ClaimedExternalControlGroup[];
    userControlGroupRoot: string;
    deadline?: number;
  },
  adapters: {
    readCgroupTreePids: (controlGroup: string, deadline?: number) => Promise<number[]>;
    readProcessIdentity: (
      pid: number,
      deadline?: number
    ) => Promise<(ObservedFixtureProcessRecord & { controlGroup?: string }) | undefined>;
    resolveRegisteredScope: (
      scopeUnit: string,
      deadline?: number
    ) => Promise<{ controlGroup?: string; pids: number[] }>;
  }
): Promise<ObservedFixtureProcessRecord[]>;

export function cleanupDisposableRehearsalRoot(root: string, failure?: unknown): Promise<boolean>;

export function combineRehearsalAndCleanupFailures(
  fixtureRoot: string,
  rehearsalFailure: unknown,
  cleanupFailure: unknown
): AggregateError & { preserveFixtureRoot: true; fixtureRoot: string };

export function runRehearsalCaseWithCleanup<T>(
  fixtureRoot: string,
  body: () => T | Promise<T>,
  cleanup: () => unknown | Promise<unknown>
): Promise<T>;

export function formatRehearsalFailure(failure: unknown): string;

export function selectProductionCompanionIdentities(
  started: { started?: boolean; alreadyRunning?: boolean; pid?: number; pids?: number[] },
  health: { runtime?: { pid?: number } },
  processes: ObservedFixtureProcessRecord[]
): ObservedFixtureProcessRecord[];

export function selectProductionContainmentTopology(
  startPid: number,
  daemonPid: number,
  processes: ObservedFixtureProcessRecord[]
): { claimExternalScope: boolean; daemonAlreadyContained: boolean };

export interface InstalledStartAndFinalizeReceipt {
  receiptPath: string;
  baseUrl: string;
  instanceDir: string;
  instanceManifestPath: string;
  activeInstanceLauncherPath: string;
  dataDirectory: string;
  databasePath: string;
  buildSha: string;
}

export function runInstalledStartAndFinalizeProof(
  installedLauncher: string,
  receipt: InstalledStartAndFinalizeReceipt,
  environment: NodeJS.ProcessEnv,
  adapters?: {
    fetchHealth?: (baseUrl: string, attemptTimeoutMs?: number) => Promise<unknown>;
    runLifecycleCommand?: (
      launcher: string,
      args: string[],
      environment: NodeJS.ProcessEnv,
      options?: {
        allowedLiveIdentities?: FixtureProcessRecord[];
        captureAllowedLiveIdentities?: unknown;
      }
    ) => Promise<Record<string, unknown>>;
  }
): Promise<{
  finalized: Record<string, unknown>;
  fixtureProcessIdentities: FixtureProcessRecord[];
  started: Record<string, unknown>;
}>;

export function waitForExactReadyHealth(
  receipt: Pick<InstalledStartAndFinalizeReceipt,
    "baseUrl" | "instanceDir" | "instanceManifestPath" | "activeInstanceLauncherPath" |
    "dataDirectory" | "databasePath" | "buildSha"
  >,
  options?: {
    fetchHealth?: (baseUrl: string, attemptTimeoutMs: number) => Promise<unknown>;
    retryDelayMs?: number;
    timeoutMs?: number;
  }
): Promise<unknown>;

export function assertPackageBoundMatrixCoverage(
  executedCaseIds: string[],
  expectedCaseIds?: string[]
): void;

export function runPackageBoundCrashMatrix(
  verified: RehearsalBundleValidation,
  environment?: NodeJS.ProcessEnv,
  temporaryParent?: string
): Promise<PackageBoundMatrixResult>;
export function rehearsalIsolatedEnvironment(
  environment: NodeJS.ProcessEnv,
  homeDir: string
): NodeJS.ProcessEnv;
