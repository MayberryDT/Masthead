import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { claudeCodeAdapter } from "../claudeCode/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Claude Code adapter", () => {
  test("normalizes the current Claude Code JSONL envelope without treating metadata rows as schema failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-claude-adapter-"));
    tempDirs.push(root);
    const path = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
    const sessionId = "11111111-1111-4111-8111-111111111111";
    await writeFile(path, [
      JSON.stringify({ cwd: "/workspace/example", sessionId, timestamp: "2026-07-18T10:00:00.000Z", type: "file-history-snapshot", uuid: "meta-1" }),
      JSON.stringify({ cwd: "/workspace/example", sessionId, timestamp: "2026-07-18T10:00:01.000Z", type: "user", uuid: "message-1", message: { role: "user", content: "Sanitized prompt" } }),
      JSON.stringify({ cwd: "/workspace/example", sessionId, timestamp: "2026-07-18T10:00:02.000Z", type: "assistant", uuid: "message-2", message: {
        role: "assistant",
        model: "claude-sanitized",
        usage: { input_tokens: 10, output_tokens: 4 },
        content: [
          { type: "thinking", thinking: "not transcript" },
          { type: "text", text: "Sanitized answer" },
          { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "sanitized.ts" } }
        ]
      } }),
      JSON.stringify({ cwd: "/workspace/example", sessionId, timestamp: "2026-07-18T10:00:03.000Z", type: "user", uuid: "message-3", message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Sanitized result", is_error: false }]
      } }),
      JSON.stringify({ aiTitle: "Sanitized session title", sessionId, timestamp: "2026-07-18T10:00:04.000Z", type: "ai-title", uuid: "meta-2" })
    ].join("\n") + "\n");

    const [unit] = await claudeCodeAdapter.planTranscriptUnits(source(path));
    const parsed = await claudeCodeAdapter.parseTranscriptUnit(unit);

    expect(parsed.completeness).toBe("complete");
    expect(parsed.sourceSessionIds).toEqual([sessionId]);
    expect(parsed.records.map((record) => record.normalized.kind)).toEqual([
      "message", "message", "tool_call", "usage", "tool_result", "session"
    ]);
    expect(parsed.records.map(value)).toContainEqual(expect.objectContaining({ project: "example", title: "Sanitized session title" }));
  });
});

function source(path: string): DiscoveredSource {
  return { confidence: "heuristic", path, runtime: "claude_code", schemaVersion: "claude-code-jsonl", sourceId: `claude:${path}`, sourceKind: "jsonl" };
}

function value(record: AdapterRecord): Record<string, unknown> {
  return record.normalized.value as Record<string, unknown>;
}
