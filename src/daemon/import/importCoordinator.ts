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

export function queueImportJob(
  db: MastheadDatabase,
  input: {
    sourceId: string;
    importKind: ImportJobKind;
    now?: () => string;
  },
  worker: () => Promise<ImportWorkResult>
): ImportJobDto {
  const now = input.now ?? (() => new Date().toISOString());
  const job = createImportJob(db, {
    importKind: input.importKind,
    sourceId: input.sourceId,
    updatedAt: now()
  });

  queueMicrotask(() => {
    void runQueuedImportJob(db, job.importJobId, now, worker);
  });

  return job;
}

async function runQueuedImportJob(
  db: MastheadDatabase,
  importJobId: string,
  now: () => string,
  worker: () => Promise<ImportWorkResult>
): Promise<void> {
  let job: ImportJobDto;
  try {
    job = updateImportJob(db, importJobId, {
      status: "running",
      updatedAt: now()
    });
  } catch {
    return;
  }

  try {
    const result = await worker();
    updateImportJob(db, importJobId, {
      ...result,
      status: "succeeded",
      updatedAt: now()
    });
  } catch (error) {
    updateImportJob(db, importJobId, {
      failureCount: Math.max(1, job.failureCount),
      failureMessage: error instanceof Error ? error.message : String(error),
      status: "failed",
      updatedAt: now()
    });
  }
}
