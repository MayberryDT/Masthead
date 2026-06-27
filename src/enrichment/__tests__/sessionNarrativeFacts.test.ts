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
      tool_result_id, tool_call_id, session_id, status, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("result:test", "tool:test", "session-narrative-facts", "succeeded", 0, "2026-06-26T14:03:00.000Z", "{}");
}
