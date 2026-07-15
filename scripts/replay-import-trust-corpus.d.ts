import type { ImportAnomaly, ImportCompletionReportDto, ImportScopeDto } from "../src/shared/sourceImport.ts";

export type ImportTrustRuntimeReport = {
  sessions: number;
  sourceSessionIds: string[];
  structuredToolCalls: number;
  structuredToolResults: number;
  reasoningFragmentPseudoSessions: number;
};

export type ImportTrustReplayReport = {
  productionAccessed: false;
  databasePath: string;
  perRuntime: Record<string, ImportTrustRuntimeReport>;
  importReports: ImportCompletionReportDto[];
  workbenchCounts: {
    importRepair: number;
    importFailuresClassifiedAsNotAdded: number;
    notAdded: number;
    notAddedReasons: Array<{ count: number; reason: string }>;
    packagePath: number;
  };
  anomalies: ImportAnomaly[];
  repairPreview: {
    applyAllowed: false;
    importJobIds: string[];
    planHash: null;
    reason: string;
  };
  scopeEvidence: {
    changedOldUnitIncludedOnlyWithCursor: boolean;
    freshOldUnitExcluded: boolean;
    recentScope: ImportScopeDto;
  };
};

export function replayImportTrustCorpus(input: {
  databasePath: string;
  sourceRoot: string;
}): Promise<ImportTrustReplayReport>;

export function validateImportTrustDatabasePath(value: string | undefined): Promise<string>;
