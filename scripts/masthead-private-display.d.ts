export interface PrivateDisplayEnvironmentInput {
  authPath: string;
  display: string;
  runtimeDir: string;
  runToken: string;
}

export interface PrivateDisplaySession extends PrivateDisplayEnvironmentInput {
  environment: NodeJS.ProcessEnv;
  identity: { executable: string; pid: number; starttime: string };
  root: string;
  socketPath: string;
}

export function privateDisplayEnvironment(
  environment: NodeJS.ProcessEnv,
  session: PrivateDisplayEnvironmentInput
): NodeJS.ProcessEnv;
export function assertPrivateDisplayEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function assertChildPrivateDisplayEnvironment(
  childEnvironment: NodeJS.ProcessEnv,
  expectedEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv;
export function withPrivateDisplay<T>(
  callback: (session: PrivateDisplaySession) => T | Promise<T>,
  options?: { environment?: NodeJS.ProcessEnv; temporaryParent?: string }
): Promise<T>;
