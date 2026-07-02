import type { NormalizedEvent } from "../core/types.ts";

export type LiveIngestQueue = {
  enqueue(event: NormalizedEvent): void;
  flushNow(): Promise<void>;
  close(): Promise<void>;
  discardPending(): void;
  size(): number;
};

export type LiveIngestQueueOptions = {
  flushDelayMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown, events: NormalizedEvent[]) => void;
  onFlush(events: NormalizedEvent[]): Promise<void> | void;
};

export function createLiveIngestQueue(options: LiveIngestQueueOptions): LiveIngestQueue {
  const flushDelayMs = Math.max(0, options.flushDelayMs ?? 750);
  const maxBatchSize = Math.max(1, options.maxBatchSize ?? 100);
  const pending: NormalizedEvent[] = [];
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let closed = false;

  function enqueue(event: NormalizedEvent): void {
    if (closed) return;
    pending.push(event);
    if (pending.length >= maxBatchSize) {
      clearTimer();
      triggerBackgroundFlush();
      return;
    }
    schedule();
  }

  async function flushNow(): Promise<void> {
    clearTimer();
    inFlight = inFlight.then(() => flushPending({ retryOnFailure: false }), () => flushPending({ retryOnFailure: false }));
    return inFlight;
  }

  async function close(): Promise<void> {
    closed = true;
    clearTimer();
    await flushNow();
  }

  function size(): number {
    return pending.length;
  }

  function discardPending(): void {
    clearTimer();
    pending.length = 0;
  }

  function schedule(): void {
    if (timer || pending.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      triggerBackgroundFlush();
    }, flushDelayMs);
    timer.unref?.();
  }

  function triggerBackgroundFlush(): void {
    inFlight = inFlight.catch(() => undefined).then(() => flushPending({ retryOnFailure: true }));
    void inFlight.catch(() => undefined);
  }

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  }

  async function flushPending(optionsForFlush: { retryOnFailure: boolean }): Promise<void> {
    while (pending.length > 0) {
      await flushBatch(optionsForFlush);
    }
  }

  async function flushBatch(optionsForFlush: { retryOnFailure: boolean }): Promise<void> {
    if (pending.length === 0) return;
    const batch = pending.slice(0, maxBatchSize);
    try {
      await options.onFlush(batch);
      removeFlushedEvents(batch);
    } catch (error) {
      options.onError?.(error, batch);
      if (optionsForFlush.retryOnFailure && !closed && pending.length > 0) schedule();
      throw error;
    }
  }

  function removeFlushedEvents(batch: NormalizedEvent[]): void {
    const flushedEventIds = new Set(batch.map((event) => event.eventId));
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (flushedEventIds.has(pending[index].eventId)) pending.splice(index, 1);
    }
  }

  return {
    close,
    discardPending,
    enqueue,
    flushNow,
    size
  };
}
