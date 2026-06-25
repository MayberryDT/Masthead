import type { AdapterRecord } from "../../adapters/types.ts";
import type { ImportWorkResult } from "./importCoordinator.ts";

export function emptyImportResult(): ImportWorkResult {
  return {
    discoveredCount: 0,
    failureCount: 0,
    importedCount: 0,
    queuedCount: 0
  };
}

export function countImportedRecord(result: ImportWorkResult, record: AdapterRecord, imported: boolean): void {
  result.discoveredCount += 1;
  if (imported) {
    result.importedCount += 1;
  } else if (record.diagnostics.length > 0) {
    result.failureCount += 1;
  } else {
    result.queuedCount += 1;
  }
}
