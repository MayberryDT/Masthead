import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { buildSessionNarrativeFacts } from "../sessionNarrativeFacts.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session narrative facts", () => {
  test("extracts semantic evidence without leaking private path prefixes", async () => {
    const db = await openTestDatabase();
    seedNarrativeSession(db);

    const facts = buildSessionNarrativeFacts(db, "session-narrative-facts");

    expect(facts.project).toBe("Masthead");
    expect(facts.objective).toBe("Fix Agent Access MCP launch config validation");
    expect(facts.firstUserPrompt).toBe("Fix Agent Access MCP launch config validation before review.");
    expect(facts.finalAssistantMessage).toBe("Added validation and tools-list test for MCP launch config.");
    expect(facts.fileBasenames).toEqual(expect.arrayContaining(["Agent Access Panel", "mcp Status Service", "server"]));
    expect(facts.files.map((file) => file.path)).not.toContain("/home/tyler/.codex/worktrees/7c35/Masthead/src/ui/AgentAccessPanel.tsx");
    expect(facts.files[0]?.path).toMatch(/^src\//);
    expect(facts.technologies).toContain("TypeScript");
    expect(facts.testsPassed).toBe(true);
    expect(facts.topics).toContain("mcp");
    expect(facts.commands[0]).toMatchObject({
      exitCode: 0,
      name: "npm test -- --run src/mcp/__tests__/toolsList.test.ts",
      outputPreview: expect.stringContaining("adapter tests passed"),
      status: "succeeded"
    });
    expect(facts.commands[0]?.outputPreview).not.toContain("/home/tyler");
    expect(facts.commands[0]?.outputPreview).not.toContain("sk-secret");
    expect(facts.commands[0]?.outputPreview?.length).toBeLessThanOrEqual(240);
    expect(facts.coverage).toMatchObject({
      fileEffects: 3,
      hasUsableTranscript: true,
      level: "complete",
      messageCount: 2,
      toolCalls: 1,
      userMessages: 1,
      assistantMessages: 1
    });
    expect(facts.eventSummaries).toContain("MCP launch validation passed");
    expect(facts.eventSummaries).not.toContain("Codex hook event");
    expect(facts.eventSummaries).not.toContain("P3");
    expect(facts.latestFeedbackSummary).toBeUndefined();
    expect(facts.topics).not.toContain("sources");

    db.close();
  });

  test("limits narrative commands before attaching tool results", async () => {
    const db = await openTestDatabase();
    seedNarrativeSession(db);
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session-narrative-facts");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session-narrative-facts");
    for (let index = 0; index < 70; index += 1) {
      const toolCallId = `tool:bulk:${index}`;
      const startedAt = new Date(Date.UTC(2026, 5, 26, 14, index)).toISOString();
      db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
        toolCallId,
        "session-narrative-facts",
        `command ${String(index).padStart(2, "0")}`,
        startedAt,
        "{}"
      );
      for (let resultIndex = 0; resultIndex < 2; resultIndex += 1) {
        db.prepare(
          `INSERT INTO tool_results (
            tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `${toolCallId}:result:${resultIndex}`,
          toolCallId,
          "session-narrative-facts",
          "succeeded",
          `command ${index} result ${resultIndex}`,
          `${toolCallId}:result:${resultIndex}:hash`,
          0,
          startedAt,
          "{}"
        );
      }
    }

    const facts = buildSessionNarrativeFacts(db, "session-narrative-facts");
    const commandNames = facts.commands.map((command) => command.name);

    expect(commandNames).toHaveLength(50);
    expect(new Set(commandNames).size).toBe(50);
    expect(commandNames).toContain("command 69");
    expect(commandNames).not.toContain("command 00");
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-narrative-facts-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedNarrativeSession(db: MastheadDatabase): void {
  const now = "2026-06-26T14:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "runtime:codex",
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session-narrative-facts",
    "host:test",
    "runtime:codex",
    "source-narrative-facts",
    "Masthead",
    "/home/tyler/.codex/worktrees/7c35/Masthead",
    "/home/tyler/.codex/worktrees/7c35/Masthead",
    "codex/mcp-launch-validation",
    "Codex session",
    "Fix Agent Access MCP launch config validation",
    "ended",
    now,
    "authoritative",
    now,
    now
  );
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("message:user", "session-narrative-facts", "user", "Fix Agent Access MCP launch config validation before review.", "hash:user", now, "{}", "authoritative");
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "message:assistant",
    "session-narrative-facts",
    "assistant",
    "Added validation and tools-list test for MCP launch config.",
    "hash:assistant",
    "2026-06-26T14:02:00.000Z",
    "{}",
    "authoritative"
  );
  for (const [index, path] of [
    "/home/tyler/.codex/worktrees/7c35/Masthead/src/ui/AgentAccessPanel.tsx",
    "/home/tyler/.codex/worktrees/7c35/Masthead/src/daemon/mcpStatusService.ts",
    "/home/tyler/.codex/worktrees/7c35/Masthead/src/mcp/server.ts"
  ].entries()) {
    db.prepare(
      `INSERT INTO file_effects (
        file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`file:${index}`, "session-narrative-facts", path, "modified", now, "{}");
  }
  db.prepare(
    `INSERT INTO tool_calls (
      tool_call_id, session_id, tool_name, started_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("tool:test", "session-narrative-facts", "npm test -- --run src/mcp/__tests__/toolsList.test.ts", now, "{}");
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "result:test",
    "tool:test",
    "session-narrative-facts",
    "succeeded",
    `adapter tests passed from /home/tyler/private with key sk-secret ${"x".repeat(260)}`,
    "hash:output",
    0,
    "2026-06-26T14:03:00.000Z",
    "{}"
  );
  for (const [id, title] of [
    ["signal:hook", "Codex hook event"],
    ["signal:p3", "P3"],
    ["signal:useful", "MCP launch validation passed"]
  ]) {
    db.prepare(
      `INSERT INTO runtime_signals (
        signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, "session-narrative-facts", "status", "info", title, "{}", now, "{}");
  }
}
