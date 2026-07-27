import {
  failWorkbenchAuthoringV5Preparation,
  getWorkbenchAuthoringV5Preparation,
  listPreparingWorkbenchAuthoringV5RequestIds
} from "./db/workbenchAuthoringV5Repository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "./db/sqlite.ts";
import { recordWorkbenchActivity } from "./db/workbenchPipelineRepository.ts";
import { prepareWorkbenchAuthoringV5RequestStep } from "../workbench/authoring/workbenchAuthoringV5Service.ts";

export type WorkbenchAuthoringV5PreparationCoordinator = {
  close: () => Promise<void>;
  resume: () => void;
  schedule: (requestId: string) => void;
};

export function createWorkbenchAuthoringV5PreparationCoordinator(
  db: MastheadDatabase
): WorkbenchAuthoringV5PreparationCoordinator {
  const queued = new Set<string>();
  let closed = false;
  let runner: Promise<void> | undefined;

  const run = async (): Promise<void> => {
    while (!closed && queued.size > 0) {
      const requestId = queued.values().next().value as string;
      try {
        const { done } = prepareWorkbenchAuthoringV5RequestStep(db, requestId);
        if (done) queued.delete(requestId);
      } catch (error) {
        queued.delete(requestId);
        withImmediateTransaction(db, () => {
          const preparation = getWorkbenchAuthoringV5Preparation(db, requestId);
          failWorkbenchAuthoringV5Preparation(db, requestId, error);
          const sessionId = preparation?.requestedSessionIds.find((candidate) => (
            Boolean(db.prepare("SELECT 1 AS present FROM sessions WHERE session_id = ?").get(candidate))
          ));
          if (preparation && sessionId) {
            const message = error instanceof Error ? error.message : String(error);
            recordWorkbenchActivity(db, {
              actor: { id: preparation.actorId, kind: "agent" },
              details: { reason: message, requestId },
              eventType: "authoring_request_preparation_failed",
              relatedRunId: requestId,
              sessionId,
              summary: "V5 authoring request preparation failed"
            });
          }
        });
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };

  const start = (): void => {
    if (closed || runner) return;
    runner = new Promise<void>((resolve) => setImmediate(resolve))
      .then(run)
      .finally(() => {
        runner = undefined;
        if (!closed && queued.size > 0) start();
      });
  };

  return {
    close: async () => {
      closed = true;
      await runner;
    },
    resume: () => {
      for (const requestId of listPreparingWorkbenchAuthoringV5RequestIds(db)) queued.add(requestId);
      start();
    },
    schedule: (requestId: string) => {
      queued.add(requestId);
      start();
    }
  };
}
