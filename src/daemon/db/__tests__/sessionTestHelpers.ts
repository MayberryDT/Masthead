import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import type { MastheadDatabase } from "../sqlite.ts";
import { markWorkbenchPublished } from "../workbenchPipelineRepository.ts";

export function seedSession(
  db: MastheadDatabase,
  options: {
    lifecycle: string;
    model: string;
    project: string;
    sessionId: string;
    title: string;
  }
): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "masthead-test-host",
    now,
    now
  );
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:opencode",
    "opencode",
    "opencode-test",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
      branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.sessionId,
    "host:test",
    "runtime:opencode",
    options.sessionId.replace("session", "source-session"),
    options.project,
    "/workspace/pip",
    "/workspace/pip",
    "main",
    options.title,
    "Fix OAuth callback handling",
    options.lifecycle,
    "completed",
    now,
    now,
    now,
    "authoritative",
    now,
    now
  );
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:message`,
    options.sessionId,
    "user",
    "Fix the OAuth authentication callback.",
    `${options.sessionId}:message-hash`,
    now,
    JSON.stringify({ source: "opencode.history", id: `${options.sessionId}:message` }),
    "authoritative"
  );
  db.prepare("INSERT INTO model_usage (usage_id, session_id, model, provider, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:usage`,
    options.sessionId,
    options.model,
    "openai",
    now,
    "{}"
  );
  db.prepare("INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:file`,
    options.sessionId,
    "auth/callback.ts",
    "modified",
    now,
    "{}"
  );
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${options.sessionId}:tool`,
    options.sessionId,
    "exec_command",
    now,
    "{}"
  );
  db.prepare("INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `${options.sessionId}:tool-result`,
    `${options.sessionId}:tool`,
    options.sessionId,
    "succeeded",
    now,
    "{}"
  );
  db.prepare("INSERT INTO session_topics (topic_id, session_id, topic, source, confidence) VALUES (?, ?, ?, ?, ?)").run(
    `${options.sessionId}:topic`,
    options.sessionId,
    "authentication",
    "fixture",
    "authoritative"
  );
  upsertSessionEnrichment(db, {
    content: {
      candidateDecisions: [],
      objective: "Fix OAuth callback handling",
      searchPhrases: ["OAuth callback", "authentication return path"],
      technologies: ["TypeScript"],
      title: options.title,
      topics: ["authentication"],
      unresolved: []
    },
    contentFingerprint: `${options.sessionId}:fingerprint`,
    enrichmentKind: "session_capsule",
    generatedAt: now,
    promptVersion: "session-capsule-v4",
    provider: "deterministic",
    sessionId: options.sessionId,
    sourceRefs: [],
    status: "current"
  });
}

export function publishSessionToLogbook(db: MastheadDatabase, sessionId: string): void {
  markWorkbenchPublished(db, {
    actor: { kind: "system", id: "test" },
    publishedVia: "test",
    sessionId
  });
}
