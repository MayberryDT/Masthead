import { describe, expect, test } from "vitest";
import { createLiveIngestQueue } from "../liveIngestQueue.ts";
import type { NormalizedEvent } from "../../core/types.ts";

describe("live ingest queue", () => {
  test("batches deferred events and flushes them in insertion order", async () => {
    const flushed: NormalizedEvent[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onFlush: async (events) => {
        flushed.push(events);
      }
    });

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    expect(flushed).toEqual([]);
    await queue.flushNow();

    expect(flushed.map((batch) => batch.map((candidate) => candidate.eventId))).toEqual([["event:one", "event:two"]]);
  });

  test("flushes automatically when max batch size is reached", async () => {
    const flushed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 2,
      onFlush: async (events) => {
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));

    await queue.flushNow();
    expect(flushed).toEqual([["event:one", "event:two"]]);
  });

  test("bounds each explicit flush batch by max batch size", async () => {
    const flushed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 2,
      onFlush: async (events) => {
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("one"));
    queue.enqueue(event("two"));
    queue.enqueue(event("three"));

    await queue.flushNow();

    expect(flushed).toEqual([
      ["event:one", "event:two"],
      ["event:three"]
    ]);
  });

  test("keeps failed flush events pending and retries them on the next flush", async () => {
    let calls = 0;
    const flushed: string[][] = [];
    const errors: Array<{ error: unknown; events: string[] }> = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onError: (error, events) => {
        errors.push({ error, events: events.map((candidate) => candidate.eventId) });
      },
      onFlush: async (events) => {
        calls += 1;
        if (calls === 1) throw new Error("first flush failed");
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("failed"));
    await expect(queue.flushNow()).rejects.toThrow("first flush failed");
    expect(queue.size()).toBe(1);
    queue.enqueue(event("recovered"));
    await queue.flushNow();

    expect(flushed).toEqual([["event:failed", "event:recovered"]]);
    expect(errors).toEqual([
      {
        error: expect.any(Error),
        events: ["event:failed"]
      }
    ]);
  });

  test("retries failed background flushes without new activity", async () => {
    let calls = 0;
    const flushed: string[][] = [];
    const errors: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 5,
      maxBatchSize: 10,
      onError: (_error, events) => {
        errors.push(events.map((candidate) => candidate.eventId));
      },
      onFlush: async (events) => {
        calls += 1;
        if (calls === 1) throw new Error("background flush failed");
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("retry"));

    await waitFor(() => errors.length === 1);
    expect(queue.size()).toBe(1);
    expect(errors).toEqual([["event:retry"]]);
    expect(flushed).toEqual([]);

    await waitFor(() => flushed.length === 1);

    expect(queue.size()).toBe(0);
    expect(flushed).toEqual([["event:retry"]]);
  });

  test("can discard pending events before they are flushed", async () => {
    const flushed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onFlush: async (events) => {
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("discarded"));
    expect(queue.size()).toBe(1);

    queue.discardPending();
    await queue.flushNow();

    expect(queue.size()).toBe(0);
    expect(flushed).toEqual([]);
  });

  test("does not drop events enqueued after a discarded in-flight batch resolves", async () => {
    let releaseFirstFlush: () => void = () => undefined;
    let calls = 0;
    const started: string[][] = [];
    const completed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onFlush: async (events) => {
        calls += 1;
        const eventIds = events.map((candidate) => candidate.eventId);
        started.push(eventIds);
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstFlush = resolve;
          });
        }
        completed.push(eventIds);
      }
    });

    queue.enqueue(event("old"));
    const inFlightFlush = queue.flushNow();
    await waitFor(() => started.length === 1);

    queue.discardPending();
    queue.enqueue(event("new"));
    expect(queue.size()).toBe(1);

    releaseFirstFlush();
    await inFlightFlush;

    expect(started).toEqual([["event:old"], ["event:new"]]);
    expect(completed).toEqual([["event:old"], ["event:new"]]);
    expect(queue.size()).toBe(0);
  });

  test("drains queued events before closing", async () => {
    const flushed: string[][] = [];
    const queue = createLiveIngestQueue({
      flushDelayMs: 10_000,
      maxBatchSize: 10,
      onFlush: async (events) => {
        flushed.push(events.map((candidate) => candidate.eventId));
      }
    });

    queue.enqueue(event("one"));
    expect(queue.size()).toBe(1);

    await queue.close();
    queue.enqueue(event("ignored"));

    expect(flushed).toEqual([["event:one"]]);
    expect(queue.size()).toBe(0);
  });
});

function event(id: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event:${id}`,
    sessionId: "session-1",
    source: {
      adapter: "opencode",
      surface: "hook",
      sourceEventId: id
    },
    occurredAt: "2026-07-02T12:00:00.000Z",
    receivedAt: "2026-07-02T12:00:00.100Z",
    type: "command.finished",
    summary: "Tool event",
    payload: { exitCode: 0 },
    sensitivity: "metadata",
    payloadHash: `hash:${id}`,
    evidence: [
      {
        id: `event:${id}`,
        kind: "event",
        observedAt: "2026-07-02T12:00:00.000Z",
        source: "test"
      }
    ]
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}
