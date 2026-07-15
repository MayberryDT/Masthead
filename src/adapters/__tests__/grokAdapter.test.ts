import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { grokAdapter } from "../grok/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const grokSessionId = "019f42f6-8ada-7001-afff-c722e75faf45";

describe("Grok adapter", () => {
  test("groups one Grok conversation file under the directory session id", async () => {
    const [unit] = await grokAdapter.planTranscriptUnits(grokFixtureSource());
    const parsed = await grokAdapter.parseTranscriptUnit(unit);

    expect(unit.sourceSessionId).toBe(grokSessionId);
    expect(parsed.sourceSessionIds).toEqual([grokSessionId]);
    expect(parsed.records.map((record) => record.normalized.kind)).toEqual([
      "message",
      "message",
      "checkpoint",
      "message",
      "tool_call",
      "tool_result"
    ]);
    expect(parsed.completeness).toBe("complete");
    expect(parsed.records.some((record) => normalizedSessionIds(record).includes("rs_fixture_001"))).toBe(false);
    expect(
      parsed.records.filter((record) => record.normalized.kind === "message").some((record) => {
        const value = record.normalized.value as { role?: string };
        return value.role === "user" || value.role === "assistant";
      })
    ).toBe(true);
  });

  test("reports unknown transcript rows without creating pseudo-sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-adapter-"));
    const conversationDir = join(root, grokSessionId);
    const path = join(conversationDir, "chat_history.jsonl");
    await mkdir(conversationDir);
    await writeFile(path, '{"type":"user","content":"Hello"}\n{"type":"mystery","id":"row_123"}\n');

    try {
      const source = grokFixtureSource(path);
      const [unit] = await grokAdapter.planTranscriptUnits(source);
      const parsed = await grokAdapter.parseTranscriptUnit(unit);

      expect(parsed.completeness).toBe("partial");
      expect(parsed.diagnostics.map((item) => item.code)).toContain("grok_record_type_unrecognized");
      expect(parsed.sourceSessionIds).toEqual([grokSessionId]);
      expect(parsed.records.flatMap(normalizedSessionIds)).not.toContain("row_123");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function grokFixtureSource(path = join(fixturesDir, "grok", grokSessionId, "chat_history.jsonl")): DiscoveredSource {
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

function normalizedSessionIds(record: AdapterRecord): string[] {
  const value = record.normalized.value;
  if (typeof value !== "object" || value === null || !("sessionId" in value)) return [];
  return typeof value.sessionId === "string" ? [value.sessionId] : [];
}
