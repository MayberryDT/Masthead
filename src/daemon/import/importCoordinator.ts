import {
  createImportJob,
  getImportJob,
  type ImportJobDto,
  type ImportJobKind,
  updateImportJob
} from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type ImportWorkResult = {
  discoveredCount: number;
  processedCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
};

export type ImportProgressUpdate = Partial<ImportWorkResult> & {
  currentPath?: string | null;
  failureMessage?: string | null;
};

export type ImportCancellationToken = {
  importJobId: string;
  readonly cancelled: boolean;
};

export type ImportJobControls = {
  importJobId: string;
  token: ImportCancellationToken;
  updateProgress: (update: ImportProgressUpdate) => ImportJobDto;
  throwIfCancelled: () => void;
};

type MutableImportCancellationToken = {
  importJobId: string;
  cancelled: boolean;
};

type ActiveImportJob = {
  token: MutableImportCancellationToken;
};

class ImportCancelledError extends Error {
  constructor(importJobId: string) {
    super(`Import job cancelled: ${importJobId}`);
    this.name = "ImportCancelledError";
  }
}

const activeImportJobs = new Map<string, ActiveImportJob>();

export function queueImportJob(
  db: MastheadDatabase,
  input: {
    sourceId: string;
    importKind: ImportJobKind;
    now?: () => string;
  },
  worker: (controls: ImportJobControls) => Promise<ImportWorkResult>
): ImportJobDto {
  const now = input.now ?? (() => new Date().toISOString());
  const job = createImportJob(db, {
    importKind: input.importKind,
    sourceId: input.sourceId,
    updatedAt: now()
  });
  const token: MutableImportCancellationToken = { cancelled: false, importJobId: job.importJobId };
  activeImportJobs.set(job.importJobId, { token });

  queueMicrotask(() => {
    void runQueuedImportJob(db, job.importJobId, now, worker, token);
  });

  return job;
}

export function cancelImportJob(db: MastheadDatabase, importJobId: string, now = () => new Date().toISOString()): ImportJobDto {
  const job = getImportJob(db, importJobId);
  if (!job) throw new Error(`Import job not found: ${importJobId}`);
  const active = activeImportJobs.get(importJobId);
  if (active) active.token.cancelled = true;
  if (job.status !== "queued" && job.status !== "running") return job;
  return updateImportJob(db, importJobId, {
    status: "cancelling",
    updatedAt: now()
  });
}

async function runQueuedImportJob(
  db: MastheadDatabase,
  importJobId: string,
  now: () => string,
  worker: (controls: ImportJobControls) => Promise<ImportWorkResult>,
  token: MutableImportCancellationToken
): Promise<void> {
  let job: ImportJobDto;
  const throwIfCancelled = (): void => {
    if (token.cancelled || ["cancelled", "cancelling"].includes(getImportJob(db, importJobId)?.status ?? "")) {
      token.cancelled = true;
      throw new ImportCancelledError(importJobId);
    }
  };
  const updateProgress = (update: ImportProgressUpdate): ImportJobDto => {
    throwIfCancelled();
    return updateImportJob(db, importJobId, {
      ...update,
      updatedAt: now()
    });
  };
  const controls: ImportJobControls = {
    importJobId,
    throwIfCancelled,
    token,
    updateProgress
  };

  try {
    const current = getImportJob(db, importJobId);
    if (current?.status === "cancelled") {
      activeImportJobs.delete(importJobId);
      return;
    }
    job = updateImportJob(db, importJobId, {
      status: "running",
      updatedAt: now()
    });
  } catch {
    activeImportJobs.delete(importJobId);
    return;
  }

  try {
    throwIfCancelled();
    const result = await worker(controls);
    throwIfCancelled();
    updateImportJob(db, importJobId, {
      ...result,
      currentPath: null,
      status: "succeeded",
      updatedAt: now()
    });
  } catch (error) {
    if (error instanceof ImportCancelledError || token.cancelled) {
      updateImportJob(db, importJobId, {
        currentPath: null,
        status: "cancelled",
        updatedAt: now()
      });
    } else {
      const latest = getImportJob(db, importJobId);
      updateImportJob(db, importJobId, {
        currentPath: null,
        failureCount: Math.max(1, latest?.failureCount ?? job.failureCount),
        failureMessage: error instanceof Error ? error.message : String(error),
        status: "failed",
        updatedAt: now()
      });
    }
  } finally {
    activeImportJobs.delete(importJobId);
  }
}
