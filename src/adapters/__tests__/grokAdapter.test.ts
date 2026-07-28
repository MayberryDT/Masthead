import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { grokAdapter } from "../grok/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const grokSessionId = "019f42f6-8ada-7001-afff-c722e75faf45";
const secondGrokSessionId = "019f42f6-8ada-7002-afff-c722e75faf46";

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

  test("applies a conversation cursor only to its matching chat history", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-tree-"));
    const firstPath = join(root, grokSessionId, "chat_history.jsonl");
    const secondPath = join(root, secondGrokSessionId, "chat_history.jsonl");
    const userRow = '{"type":"user","content":"Hello"}\n';
    const assistantRow = '{"type":"assistant","content":"Hi"}\n';
    await mkdir(dirname(firstPath));
    await mkdir(dirname(secondPath));
    await writeFile(firstPath, userRow + assistantRow);
    await writeFile(secondPath, userRow + assistantRow);
    await writeFile(join(dirname(secondPath), "updates.jsonl"), "");

    try {
      const source = grokFixtureSource(root);
      const units = await grokAdapter.planTranscriptUnits(source);
      const first = units.find((unit) => unit.sourceSessionId === grokSessionId)!;
      const second = units.find((unit) => unit.sourceSessionId === secondGrokSessionId)!;
      const cursor = {
        byteOffset: Buffer.byteLength(userRow),
        cursorId: "cursor:first-grok-conversation",
        sourceId: source.sourceId,
        sourcePath: firstPath
      };

      const firstParsed = await grokAdapter.parseTranscriptUnit(first, cursor);
      const secondParsed = await grokAdapter.parseTranscriptUnit(second, cursor);

      expect(messageRoles(firstParsed.records)).toEqual(["assistant"]);
      expect(messageRoles(secondParsed.records)).toEqual(["user", "assistant"]);
      expect(secondParsed.completeness).toBe("complete");
      expect(secondParsed.diagnostics).toContainEqual(
        expect.objectContaining({ code: "grok_auxiliary_file_ignored", details: "updates.jsonl", severity: "info" })
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("discovers only canonical Grok chat histories and skips recap request JSON", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-grok-discovery-"));
    const conversationDir = join(homeDir, ".grok", "sessions", "%2Fworkspace", grokSessionId);
    const recapDir = join(conversationDir, "recap_requests");
    await mkdir(recapDir, { recursive: true });
    await writeFile(join(conversationDir, "chat_history.jsonl"), '{"type":"user","content":"Sanitized prompt"}\n');
    await writeFile(join(recapDir, "request.json"), "{}");

    try {
      const sources = await grokAdapter.discover({ exclusions: [], homeDir, now: "2026-07-18T00:00:00.000Z" });
      expect(sources.map((source) => source.path)).toEqual([join(conversationDir, "chat_history.jsonl")]);
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  test("keeps summary.json generated_title as the session title", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-title-"));
    const conversationDir = join(root, grokSessionId);
    const path = join(conversationDir, "chat_history.jsonl");
    await mkdir(conversationDir);
    await writeFile(path, `${JSON.stringify({ type: "user", content: "Hello from the user turn" })}\n`);
    await writeFile(
      join(conversationDir, "summary.json"),
      JSON.stringify({
        info: { id: grokSessionId, cwd: "/workspace/Masthead" },
        generated_title: "Preserve Grok summary titles",
        last_active_at: "2026-07-18T12:00:00.000Z"
      })
    );

    try {
      const [unit] = await grokAdapter.planTranscriptUnits(grokFixtureSource(path));
      const parsed = await grokAdapter.parseTranscriptUnit(unit);
      const session = parsed.records.find((record) => record.normalized.kind === "session");
      expect(session?.normalized.value).toMatchObject({
        sessionId: grokSessionId,
        title: "Preserve Grok summary titles"
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("normalizes the observed Grok backend tool-call row", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-grok-backend-tool-"));
    const conversationDir = join(root, grokSessionId);
    const path = join(conversationDir, "chat_history.jsonl");
    await mkdir(conversationDir);
    await writeFile(
      path,
      '{"type":"backend_tool_call","kind":{"tool_type":"web_search","action":{"type":"search","query":"sanitized query","sources":[]},"id":"ws_fixture_call_1","status":"completed"}}\n'
    );

    try {
      const [unit] = await grokAdapter.planTranscriptUnits(grokFixtureSource(path));
      const parsed = await grokAdapter.parseTranscriptUnit(unit);
      expect(parsed.completeness).toBe("complete");
      expect(parsed.records.map((record) => record.normalized.kind)).toEqual(["tool_call"]);
      expect(parsed.records.map((record) => record.normalized.value)).toEqual([
        {
          arguments: { query: "sanitized query", sources: [], type: "search" },
          callId: "ws_fixture_call_1",
          // Grok rows without timestamps fall back to chat-history file mtime (or summary activity).
          observedAt: expect.any(String),
          sessionId: grokSessionId,
          status: "completed",
          toolName: "web_search"
        }
      ]);
      expect((parsed.records[0]?.normalized.value as { observedAt?: string }).observedAt).not.toBe("1970-01-01T00:00:00.000Z");
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

function messageRoles(records: AdapterRecord[]): string[] {
  return records.flatMap((record) => {
    if (record.normalized.kind !== "message") return [];
    const value = record.normalized.value as { role?: unknown };
    return typeof value.role === "string" ? [value.role] : [];
  });
}
