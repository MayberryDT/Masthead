import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createCodexTranscriptLiveScanner } from "../codexTranscriptLive.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Codex transcript live scanner", () => {
  test("emits one metadata-only live event for a recently updated desktop transcript", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-codex-live-"));
    tempDirs.push(homeDir);
    const transcriptPath = join(homeDir, ".codex", "sessions", "2026", "07", "05", "rollout.jsonl");
    const cwd = join(homeDir, "worktrees", "masthead-live");
    await mkdir(dirname(transcriptPath), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        payload: {
          cwd,
          id: "codex-live-session",
          model: "gpt-5-codex"
        },
        timestamp: "2026-07-05T15:50:00.000Z",
        type: "session_meta"
      })}\n${JSON.stringify({
        payload: {
          content: [{ text: "Do not leak this prompt into a live metadata event.", type: "input_text" }],
          role: "user",
          type: "message"
        },
        timestamp: "2026-07-05T15:50:05.000Z",
        type: "response_item"
      })}\n${JSON.stringify({
        payload: {
          info: {
            last_token_usage: {
              input_tokens: 120,
              output_tokens: 30,
              total_tokens: 150
            }
          },
          type: "token_count"
        },
        timestamp: "2026-07-05T15:50:10.000Z",
        type: "event_msg"
      })}\n`,
      "utf8"
    );
    await utimes(transcriptPath, new Date("2026-07-05T15:50:00.000Z"), new Date("2026-07-05T15:50:10.000Z"));

    const scanner = createCodexTranscriptLiveScanner({
      homeDir,
      now: () => new Date("2026-07-05T15:50:15.000Z"),
      pollIntervalMs: 0,
      recentWindowMs: 60_000
    });

    const first = await scanner.refresh();
    const second = await scanner.refresh();

    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({
      occurredAt: "2026-07-05T15:50:10.000Z",
      payload: {
        cwd,
        harness: "Codex",
        inputTokens: 120,
        model: "gpt-5-codex",
        outputTokens: 30,
        runtime: "codex",
        sourceSessionId: "codex-live-session",
        totalTokens: 150,
        transcriptPath
      },
      sessionId: "codex-live-session",
      source: {
        adapter: "codex",
        surface: "tailer"
      },
      type: "session.started",
      workspace: {
        cwd,
        worktreePath: cwd
      }
    });
    expect(JSON.stringify(first.events[0].payload)).not.toContain("Do not leak this prompt");
    expect(second.events).toEqual([]);
  });

  test("defaults to only the most recently updated desktop transcript", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-codex-live-"));
    tempDirs.push(homeDir);
    const olderPath = join(homeDir, ".codex", "sessions", "2026", "07", "05", "older.jsonl");
    const newerPath = join(homeDir, ".codex", "sessions", "2026", "07", "05", "newer.jsonl");
    await mkdir(dirname(olderPath), { recursive: true });
    await writeFile(
      olderPath,
      `${JSON.stringify({
        payload: { id: "older-session", model: "gpt-5-codex" },
        timestamp: "2026-07-05T15:49:00.000Z",
        type: "session_meta"
      })}\n`,
      "utf8"
    );
    await writeFile(
      newerPath,
      `${JSON.stringify({
        payload: { id: "newer-session", model: "gpt-5-codex" },
        timestamp: "2026-07-05T15:50:00.000Z",
        type: "session_meta"
      })}\n`,
      "utf8"
    );
    await utimes(olderPath, new Date("2026-07-05T15:49:00.000Z"), new Date("2026-07-05T15:49:00.000Z"));
    await utimes(newerPath, new Date("2026-07-05T15:50:00.000Z"), new Date("2026-07-05T15:50:00.000Z"));

    const scanner = createCodexTranscriptLiveScanner({
      homeDir,
      now: () => new Date("2026-07-05T15:50:15.000Z"),
      pollIntervalMs: 0,
      recentWindowMs: 120_000
    });

    const refresh = await scanner.refresh();

    expect(refresh.candidates).toBe(1);
    expect(refresh.events).toHaveLength(1);
    expect(refresh.events[0].sessionId).toBe("newer-session");
  });
});
