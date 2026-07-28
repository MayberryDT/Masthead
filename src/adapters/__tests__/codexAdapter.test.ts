import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { codexAdapter } from "../codex/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Codex adapter", () => {
  test("restarts from the beginning when a saved byte cursor is beyond a truncated file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-truncated-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-truncated.jsonl");
    await writeFile(path, `${JSON.stringify({ timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "session-new" } })}\n`, "utf8");
    const source: DiscoveredSource = { confidence: "authoritative", path, runtime: "codex", sourceId: "codex:truncated", sourceKind: "jsonl" };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source, {
      byteOffset: 50_000,
      cursorId: "cursor:old",
      sourceId: source.sourceId,
      sourcePath: path,
      sourceSessionId: "session-old"
    })) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ normalized: { value: { sessionId: "session-new" } }, sourceRecordKey: `${path}:1` });
  });

  test("resumes after a byte checkpoint while retaining session context and stable line keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-adapter-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-test.jsonl");
    const lines = [
      JSON.stringify({ timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "session-real", cwd: "/workspace/masthead", model: "gpt-5" } }),
      JSON.stringify({ timestamp: "2026-07-01T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] } }),
      JSON.stringify({ timestamp: "2026-07-01T00:00:02.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "second" }] } })
    ];
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    const byteOffset = Buffer.byteLength(`${lines[0]}\n${lines[1]}\n`);
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:test",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source, {
      byteOffset,
      cursorId: "cursor:test",
      cwd: "/workspace/masthead",
      model: "gpt-5",
      sourceId: source.sourceId,
      sourcePath: path,
      sourceSessionId: "session-real"
    })) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      cursorAfter: { sourceSessionId: "session-real" },
      sourceRecordKey: `${path}:3`,
      normalized: { value: { role: "assistant", sessionId: "session-real", text: "second" } }
    });
  });

  test("prefers a short user-derived title over cwd basename when user narrative exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-title-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-title.jsonl");
    const userPrompt = "Implement Logbook pagination spacing for dense artifact rows";
    await writeFile(
      path,
      [
        JSON.stringify({
          timestamp: "2026-07-01T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "session-title", cwd: "/workspace/Masthead", model: "gpt-5" }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:01.000Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: userPrompt }] }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:02.000Z",
          type: "response_item",
          payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Working on it." }] }
        })
      ].join("\n") + "\n",
      "utf8"
    );
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:title",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source)) records.push(record);

    const session = records.find((record) => record.normalized.kind === "session");
    const title = (session?.normalized.value as { title?: string } | undefined)?.title;
    expect(title).toBeTruthy();
    expect(title).not.toBe("Masthead");
    expect(title).toMatch(/Logbook/i);
    expect(title).toMatch(/pagination/i);
    expect(title!.length).toBeLessThanOrEqual(80);
  });

  test("falls back to cwd basename when no usable user narrative exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-basename-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-basename.jsonl");
    await writeFile(
      path,
      `${JSON.stringify({
        timestamp: "2026-07-01T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-basename", cwd: "/workspace/Masthead", model: "gpt-5" }
      })}\n`,
      "utf8"
    );
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:basename",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source)) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]?.normalized.value).toMatchObject({
      sessionId: "session-basename",
      title: "Masthead"
    });
  });

  test("does not use control-only Codex envelopes as session titles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-control-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-control.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          timestamp: "2026-07-01T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "session-control", cwd: "/workspace/Masthead", model: "gpt-5" }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<skill>Internal instructions only</skill>" }]
          }
        })
      ].join("\n") + "\n",
      "utf8"
    );
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:control",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source)) records.push(record);
    const session = records.find((record) => record.normalized.kind === "session");
    expect(session?.normalized.value).toMatchObject({ title: "Masthead" });
  });

  test("prefers later real user narrative after control-only first user turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-control-then-user-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-control-then-user.jsonl");
    const realPrompt = "Implement Logbook pagination spacing for dense artifact rows";
    await writeFile(
      path,
      [
        JSON.stringify({
          timestamp: "2026-07-01T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "session-control-then-user", cwd: "/workspace/Masthead", model: "gpt-5" }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<skill>Internal instructions only</skill>" }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Acknowledged." }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-07-01T00:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: realPrompt }]
          }
        })
      ].join("\n") + "\n",
      "utf8"
    );
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:control-then-user",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source)) records.push(record);

    const session = records.find((record) => record.normalized.kind === "session");
    const title = (session?.normalized.value as { title?: string } | undefined)?.title;
    expect(title).toBeTruthy();
    expect(title).not.toBe("Masthead");
    expect(title).toMatch(/Logbook/i);
    expect(title).toMatch(/pagination/i);
    // Session must not precede the real user turn (weak title would have locked earlier).
    const sessionIndex = records.findIndex((record) => record.normalized.kind === "session");
    const realUserIndex = records.findIndex(
      (record) =>
        record.normalized.kind === "message" &&
        (record.normalized.value as { role?: string; text?: string }).role === "user" &&
        (record.normalized.value as { text?: string }).text === realPrompt
    );
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(realUserIndex).toBeGreaterThanOrEqual(0);
    expect(sessionIndex).toBeLessThanOrEqual(realUserIndex);
  });
});
