import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { grokAdapter } from "../grok/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const grokSessionId = "019f42f6-8ada-7001-afff-c722e75faf45";

describe("Grok adapter", () => {
  test("groups one Grok conversation file under the directory session id", async () => {
    const records = await collect(grokAdapter.backfill(grokFixtureSource()));
    const sessionIds = new Set(records.flatMap(normalizedSessionIds));

    expect(sessionIds).toEqual(new Set([grokSessionId]));
    expect(records.filter((record) => record.normalized.kind === "message")).toHaveLength(3);
    expect(records.filter((record) => record.normalized.kind === "tool_call")).toHaveLength(1);
    expect(records.filter((record) => record.normalized.kind === "tool_result")).toHaveLength(1);
    expect(records.some((record) => normalizedSessionIds(record).includes("rs_fixture_001"))).toBe(false);
  });
});

function grokFixtureSource(): DiscoveredSource {
  const path = join(fixturesDir, "grok", grokSessionId, "chat_history.jsonl");
  return {
    confidence: "heuristic",
    path,
    runtime: "grok",
    schemaVersion: "grok-jsonl-tree",
    sourceId: `grok:${path}`,
    sourceKind: "jsonl",
    sourceSessionId: grokSessionId
  };
}

async function collect(records: AsyncIterable<AdapterRecord>): Promise<AdapterRecord[]> {
  const output: AdapterRecord[] = [];
  for await (const record of records) output.push(record);
  return output;
}

function normalizedSessionIds(record: AdapterRecord): string[] {
  const value = record.normalized.value;
  if (typeof value !== "object" || value === null || !("sessionId" in value)) return [];
  return typeof value.sessionId === "string" ? [value.sessionId] : [];
}
