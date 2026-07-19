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
): Promise<{ ok: true; bundle: string; isolated: true; matrix: true }>;

export function stopChild(
  child: {
    exitCode: number | null;
    kill(signal: NodeJS.Signals): boolean;
    pid?: number;
    signalCode: NodeJS.Signals | null;
  },
  adapters?: {
    readProcess?: (pid: number) => Promise<{ starttime?: string } | undefined>;
    termTimeoutMs?: number;
  }
): Promise<void>;
