export type GuidedAgentLaunchPackage = {
  schemaVersion: "masthead-guided-agent-launch-v1";
  requestId: string;
  startCommand: string;
};

export const GUIDED_AGENT_FIXTURE: ReadonlyArray<{
  key: string;
  profile: string;
  title: string;
}>;

export function allocateGuidedCanaryPort(options?: Record<string, unknown>): Promise<number>;
export function assertIsolatedGuidedCanaryRuntime(input: {
  baseUrl: string;
  databasePath: string;
  manifestPath: string;
  port: number;
  homeDir?: string;
}): void;
export function buildGuidedAgentLaunchPackage(input: {
  requestId: string;
  startCommand: string;
  instanceDirectory: string;
  forbiddenValues?: string[];
}): GuidedAgentLaunchPackage;
export function guidedAgentCanaryFailures(report: Record<string, any>, untrustedAgentReport?: Record<string, any>): string[];
export function buildGuidedHumanReviewChallenge(
  requestId: string,
  trustedReport: Record<string, any>,
  reviewRequestedAt?: string
): Record<string, any>;
export function trustedHumanReview(review: Record<string, any> | undefined, challenge: Record<string, any>): Record<string, any>;
export function verifyPersistedGuidedAgentReview(
  persisted: Record<string, any>,
  review: Record<string, any>
): Record<string, any>;
export function persistGuidedAgentReport(path: string, result: Record<string, any>): Promise<void>;
export function buildFreshAgentEnvironment(
  environment: Record<string, string | undefined>,
  input: { agentHome: string; codexHome: string; launchPackage: GuidedAgentLaunchPackage }
): Record<string, string>;
export function auditFreshAgentOperations(
  entries: Array<string[] | { argv: string[]; status: number | null }>,
  expected: Record<string, any>
): Record<string, any>;
export function buildArtifactOnlyReuseTask(artifact: Record<string, any>): Record<string, any>;
export function buildOptionalArtifactOnlyReuseTask(artifact: Record<string, any>): Record<string, any>;
export function seedGuidedCanaryFixtureRows(database: any, sessionIds: string[]): void;
export function snapshotGuidedAuthoringState(database: any): { hash: string; tables: Record<string, string[]> };
export function countCanaryPublicationsBeforeApproval(
  publishedAtValues: string[],
  approval?: { decision: string; reviewedAt: string }
): number;
export function runFreshAgentProcess(input: Record<string, any>, dependencyOverrides?: Record<string, any>): Promise<Record<string, any>>;
export function verifyGuidedAgentCanaryState(input: Record<string, any>): Promise<Record<string, any>>;
export function runGuidedAgentCanary(options?: Record<string, any>, dependencyOverrides?: Record<string, any>): Promise<{
  failures: string[];
  launchPackage: GuidedAgentLaunchPackage;
  passed: boolean;
  productionAccessed: false;
  report: Record<string, any>;
  reportVersion: "guided-agent-canary-v1";
}>;
