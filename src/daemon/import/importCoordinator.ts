import {
  createImportJob,
  type ImportJobDto,
  type ImportJobKind,
  updateImportJob
} from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type ImportWorkResult = {
  discoveredCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
};

export async function runImportJob(
  db: MastheadDatabase,
  input: {
    sourceId: string;
    importKind: ImportJobKind;
    now?: () => string;
  },
  worker: () => Promise<ImportWorkResult>
): Promise<ImportJobDto> {
  const now = input.now ?? (() => new Date().toISOString());
  let job = createImportJob(db, {
    importKind: input.importKind,
    sourceId: input.sourceId,
    updatedAt: now()
  });
  job = updateImportJob(db, job.importJobId, {
    status: "running",
    updatedAt: now()
  });
  try {
    const result = await worker();
    return updateImportJob(db, job.importJobId, {
      ...result,
      status: "succeeded",
      updatedAt: now()
    });
  } catch (error) {
    return updateImportJob(db, job.importJobId, {
      failureCount: Math.max(1, job.failureCount),
      failureMessage: error instanceof Error ? error.message : String(error),
      status: "failed",
      updatedAt: now()
    });
  }
}
