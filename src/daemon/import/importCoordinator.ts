import {
  createImportJob,
  getImportJob,
  type ImportJobDto,
  type ImportJobKind,
  updateImportJob
} from "../db/importJobRepository.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { recordRuntimeDiagnostic } from "../diagnostics.ts";

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
const pendingImportJobs: QueuedImportJob[] = [];
let runningImportJobs = 0;
let importDrainScheduled = false;

const maxActiveImportJobs = parseImportConcurrency(process.env.MASTHEAD_IMPORT_CONCURRENCY);

type QueuedImportJob = {
  db: MastheadDatabase;
  importJobId: string;
  now: () => string;
  token: MutableImportCancellationToken;
  worker: (controls: ImportJobControls) => Promise<ImportWorkResult>;
};

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
  pendingImportJobs.push({ db, importJobId: job.importJobId, now, token, worker });
  logImportBacklogIfNeeded();
  scheduleImportDrain();

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

export function getImportQueueState(): { active: number; maxActive: number; pending: number; tracked: number } {
  return {
    active: runningImportJobs,
    maxActive: maxActiveImportJobs,
    pending: pendingImportJobs.length,
    tracked: activeImportJobs.size
  };
}

export function markInterruptedImportJobs(db: MastheadDatabase, now = () => new Date().toISOString()): number {
  const interrupted = db
    .prepare("SELECT COUNT(*) AS count FROM import_jobs WHERE status IN ('queued', 'running', 'cancelling')")
    .get() as { count: number };
  if (interrupted.count === 0) return 0;
  const interruptedAt = now();

  db.prepare(
    `UPDATE import_jobs
    SET status = 'failed',
      failure_count = CASE WHEN failure_count > 0 THEN failure_count ELSE 1 END,
      current_path = NULL,
      failure_message = COALESCE(NULLIF(failure_message, ''), 'Import was interrupted by a previous daemon shutdown. Re-run the import to continue.'),
      finished_at = ?,
      updated_at = ?
    WHERE status IN ('queued', 'running', 'cancelling')`
  ).run(interruptedAt, interruptedAt);

  recordRuntimeDiagnostic({
    details: { interruptedJobs: interrupted.count },
    kind: "import_jobs_interrupted",
    message: `Marked ${interrupted.count} interrupted import jobs from a previous daemon run`,
    severity: "warning"
  });
  return interrupted.count;
}

function scheduleImportDrain(): void {
  if (importDrainScheduled) return;
  importDrainScheduled = true;
  queueMicrotask(drainImportQueue);
}

function drainImportQueue(): void {
  importDrainScheduled = false;
  while (runningImportJobs < maxActiveImportJobs) {
    const queued = pendingImportJobs.shift();
    if (!queued) return;
    runningImportJobs += 1;
    recordRuntimeDiagnostic({
      details: {
        active: runningImportJobs,
        importJobId: queued.importJobId,
        maxActive: maxActiveImportJobs,
        pending: pendingImportJobs.length
      },
      kind: "import_job_started",
      message: `Started import job ${queued.importJobId}`,
      severity: "info"
    });
    void runQueuedImportJob(queued.db, queued.importJobId, queued.now, queued.worker, queued.token).finally(() => {
      runningImportJobs = Math.max(0, runningImportJobs - 1);
      scheduleImportDrain();
    });
  }
}

function logImportBacklogIfNeeded(): void {
  const pending = pendingImportJobs.length;
  if (![10, 50, 100, 500, 1_000, 2_000].includes(pending)) return;
  recordRuntimeDiagnostic({
    details: {
      active: runningImportJobs,
      maxActive: maxActiveImportJobs,
      pending
    },
    kind: "import_queue_backlog",
    message: `Import queue backlog reached ${pending} pending jobs`,
    severity: pending >= 500 ? "warning" : "info"
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
      startedAt: current?.startedAt ?? now(),
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
      finishedAt: now(),
      status: "succeeded",
      updatedAt: now()
    });
    recordRuntimeDiagnostic({
      details: {
        discoveredCount: result.discoveredCount,
        failureCount: result.failureCount,
        importJobId,
        importedCount: result.importedCount,
        processedCount: result.processedCount,
        queuedCount: result.queuedCount
      },
      kind: "import_job_succeeded",
      message: `Import job ${importJobId} succeeded`,
      severity: "info"
    });
  } catch (error) {
    if (error instanceof ImportCancelledError || token.cancelled) {
      updateImportJob(db, importJobId, {
        currentPath: null,
        finishedAt: now(),
        status: "cancelled",
        updatedAt: now()
      });
      recordRuntimeDiagnostic({
        details: { importJobId },
        kind: "import_job_cancelled",
        message: `Import job ${importJobId} cancelled`,
        severity: "info"
      });
    } else {
      const latest = getImportJob(db, importJobId);
      updateImportJob(db, importJobId, {
        currentPath: null,
        finishedAt: now(),
        failureCount: Math.max(1, latest?.failureCount ?? job.failureCount),
        failureMessage: error instanceof Error ? error.message : String(error),
        status: "failed",
        updatedAt: now()
      });
      recordRuntimeDiagnostic({
        details: {
          error,
          importJobId
        },
        kind: "import_job_failed",
        message: `Import job ${importJobId} failed`,
        severity: "warning"
      });
    }
  } finally {
    activeImportJobs.delete(importJobId);
  }
}

function parseImportConcurrency(value: string | undefined): number {
  const parsed = Number.parseInt(value || "", 10);
  if (parsed === 0) return 0;
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 8) return parsed;
  return 1;
}
