import type { SessionDossierDto } from "../shared/sessionDossier";
import { getSessionDossier } from "./daemonClient";

export type PollDossierEnrichmentInput = {
  baseUrl: string;
  intervalMs?: number;
  maxAttempts?: number;
  onDossier: (dossier: SessionDossierDto) => void;
  sessionId: string;
  signal?: AbortSignal;
};

export async function pollDossierEnrichment({
  baseUrl,
  intervalMs = 1500,
  maxAttempts = 80,
  onDossier,
  sessionId,
  signal
}: PollDossierEnrichmentInput): Promise<SessionDossierDto> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const dossier = await getSessionDossier(sessionId, baseUrl, { signal });
    onDossier(dossier);
    if (dossier.enrichment.status !== "enriching") return dossier;
    await delay(intervalMs, signal);
  }
  throw new Error("Dossier enrichment is still running. Refresh the Dossier to check again.");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(abortError());
      },
      { once: true }
    );
  });
}

function abortError(): Error {
  const error = new Error("Polling aborted.");
  error.name = "AbortError";
  return error;
}
