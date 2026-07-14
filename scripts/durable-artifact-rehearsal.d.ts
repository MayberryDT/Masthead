export const REHEARSAL_PORT: number;

export type RehearsalConfigInput = {
  bundleRoot: string;
  expectedAuditHash: string;
  expectedBuildSha: string;
  expectedDatabaseId: string;
  expectedLabelSha256: string;
  expectedSampleSha256: string;
  expectedSourceSha256: string;
  labelsPath: string;
  port: number;
  root: string;
  samplePath: string;
  sourceBackup: string;
};

export function validateStaticRehearsalConfig(input: RehearsalConfigInput): RehearsalConfigInput & {
  activeDatabase: string;
  cliEntry: string;
  daemonEntry: string;
  frozenDatabase: string;
  mcpEntry: string;
  nodePath: string;
  recoveryBackup: string;
};

export function buildIsolatedDaemonEnv(
  config: ReturnType<typeof validateStaticRehearsalConfig> & { buildVersion?: string },
  cliCommand: string
): Record<string, string>;

export function evaluateCandidateLabels(
  labels: Array<{ expectedCandidate: boolean; kind: string; sessionId: string }>,
  candidates: Array<{ kind: string; provenanceSessionIds: string[] }>
): {
  falseNegative: number;
  falsePositive: number;
  precision: number;
  recall: number;
  total: number;
  trueNegative: number;
  truePositive: number;
  units: Array<{ discoveredCandidate: boolean; expectedCandidate: boolean; kind: string; sessionId: string }>;
};

export function isExplicitlyUnknown(value: unknown): boolean;

export function selectCanaryCandidates<T extends { candidateId: string; provenanceSessionIds: string[] }>(
  candidates: T[],
  frozenSessionIds: Set<string>
): T[];

export function assertDiscoveryCompletion(
  report: { currentScans: number; eligibleSessions: number },
  expectedSessions?: number
): { currentScans: number; eligibleSessions: number };

export function classifyPreparedInvalidationState(counts: {
  artifacts: number;
  candidates: number;
  provenance: number;
  runs: number;
  searchRows: number;
  sessions: number;
}): "ready" | "committed";

export function validateDaemonCloseResult(
  result: { code: number | null; signal: string | null },
  requestedStop: boolean
): { code: number | null; signal: string | null };

export function validateHumanReviewReceipt(
  value: unknown,
  expected: {
    dossierArtifactIds: string[];
    machineReportSha256: string;
    optionalArtifactIds: string[];
    packetSha256: string;
    reviewSetSha256: string;
  }
): {
  dossiers: unknown[];
  medianOverall: number;
  minimumOverall: number;
  optionalArtifacts: unknown[];
  reviewer: string;
  signedAt: string;
};

export function normalizedDossierForComparison(value: unknown): unknown;
