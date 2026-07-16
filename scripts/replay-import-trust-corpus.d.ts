import type { ImportAnomaly, ImportCompletionReportDto, ImportScopeDto } from "../src/shared/sourceImport.ts";
import type { ImportRepairPreview } from "../src/shared/importRepair.ts";

export type ImportTrustRuntimeReport = {
  evidence: {
    messagesByRole: Record<string, number>;
    reasoningCheckpoints: number;
    toolCalls: number;
    toolResults: number;
  };
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
  repairPreview: ImportRepairPreview;
  scopeEvidence: {
    currentUnitsAdmitted: number;
    oldSemanticUnit: {
      canonicalSessions: number;
      scopeReason?: string;
      status?: string;
      timestampBasis?: string;
    };
    recentScope: ImportScopeDto;
    reportDeferredUnits: number;
  };
};

export function replayImportTrustCorpus(input: {
  databasePath: string;
  sourceRoot: string;
}): Promise<ImportTrustReplayReport>;

export function validateImportTrustDatabasePath(value: string | undefined): Promise<string>;
