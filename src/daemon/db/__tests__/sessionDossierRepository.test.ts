import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { getSessionDossier } from "../sessionDossierRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session dossier repository", () => {
  test("builds a canonical dossier with identity, evidence, reuse, usage, and narrative provenance", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db);

    const dossier = getSessionDossier(db, "session-1");

    expect(dossier).toMatchObject({
      identity: {
        hostId: "host:test",
        model: "gpt-5.5",
        models: ["gpt-5.5"],
        project: "Masthead",
        runtime: "codex",
        sessionId: "session-1",
        sourceConfidence: "authoritative",
        sourceSessionId: "source-session-1",
        title: "Build session dossier"
      },
      narrative: {
        firstUserPrompt: "Create a useful session dossier.",
        latestUserPrompt: "Add timeline filters.",
        finalAssistantMessage: "Implemented the dossier repository.",
        objective: "Create session dossiers",
        outcome: "Dossier repository ready.",
        technologies: ["TypeScript"],
        topics: ["session-memory"],
        unresolved: ["Need browser check."]
      },
      reuse: {
        canonicalSessionId: "session-1",
        mcpIncluded: true,
        sourceConfidence: "authoritative",
        sourceRuntime: "codex",
        sourceSessionId: "source-session-1"
      },
      usage: {
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500,
        usageRows: 1
      },
      verification: {
        status: "passed"
      }
    });
    expect(dossier?.files[0]).toMatchObject({
      basename: "SessionDossier.tsx",
      displayPath: "src/ui/session-dossier/SessionDossier.tsx",
      effectKind: "modified"
    });
    expect(dossier?.tools[0]).toMatchObject({
      exitCode: 0,
      outputPreview: "17 tests passed",
      status: "succeeded",
      toolName: "npm test"
    });
    expect(dossier?.attention.map((item) => item.kind)).not.toContain("missing_verification");
    expect(dossier?.excerpts.map((excerpt) => excerpt.kind)).toEqual(
      expect.arrayContaining(["message", "checkpoint", "runtime_signal"])
    );
    expect(dossier?.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["user", "assistant", "tool", "file", "checkpoint", "runtime_signal"])
    );
    expect(dossier?.reuse.copyableContext).toContain("# Masthead Session Context");
    expect(dossier?.reuse.copyableContext).toContain("Canonical session: session-1");
    expect(dossier?.reuse.copyableContext).toContain("Summary: Implemented the dossier repository.");
    expect(dossier?.reuse.copyableContext).toContain("Agent retrieval: included");
    expect(dossier?.reuse.copyableContext).not.toContain("Objective:");
    expect(dossier?.reuse.copyableContext).not.toContain("Outcome:");
    expect(dossier?.reuse.copyableContext).not.toContain("MCP included");
    expect(dossier?.narrative.narrativeDebug).toMatchObject({
      confidence: "medium",
      failureCode: "timeout",
      failureMessage: "OpenAI enrichment timed out. No fallback was persisted.",
      latestFailedAttemptAt: "2026-06-26T12:12:00.000Z",
      missingEvidence: ["verification"],
      model: "gpt-5-nano",
      promptVersion: "session-capsule-v3",
      providerStatus: "success",
      provider: "openai",
      subjectConfidence: "high",
      titleSource: "llm"
    });
    db.close();
  });

  test("returns undefined for deleted sessions and marks changed sessions without verification", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-deleted" });
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE session_id = ?").run("2026-06-26T12:30:00.000Z", "session-deleted");
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-missing-verification",
      title: "Missing verification"
    });
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session-missing-verification");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session-missing-verification");

    expect(getSessionDossier(db, "session-deleted")).toBeUndefined();
    expect(getSessionDossier(db, "session-missing-verification")?.verification.status).toBe("missing");
    expect(getSessionDossier(db, "session-missing-verification")?.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "missing_verification" }),
        expect.objectContaining({ detail: "auth/callback.ts", kind: "high_risk_change" })
      ])
    );
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-dossier-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedDossierSession(db: MastheadDatabase, options: { sessionId?: string } = {}): void {
  const sessionId = options.sessionId ?? "session-1";
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5.5",
    project: "Masthead",
    sessionId,
    title: "Build session dossier"
  });
  db.prepare(
    `UPDATE sessions
    SET objective = ?, outcome_label = ?, source_session_id = ?
    WHERE session_id = ?`
  ).run("Create session dossiers", "completed", sessionId.replace("session", "source-session"), sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM model_usage WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM session_topics WHERE session_id = ?").run(sessionId);

  insertMessage(db, sessionId, "m1", "user", "Create a useful session dossier.", "2026-06-26T12:00:00.000Z");
  insertMessage(db, sessionId, "m2", "user", "Add timeline filters.", "2026-06-26T12:05:00.000Z");
  insertMessage(db, sessionId, "m3", "assistant", "Implemented the dossier repository.", "2026-06-26T12:10:00.000Z");
  db.prepare(
    `INSERT INTO file_effects (
      file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:file`,
    sessionId,
    "src/ui/session-dossier/SessionDossier.tsx",
    "modified",
    0,
    42,
    3,
    "2026-06-26T12:06:00.000Z",
    JSON.stringify({ id: "file-ref" })
  );
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    `${sessionId}:tool`,
    sessionId,
    "npm test",
    "2026-06-26T12:08:00.000Z",
    JSON.stringify({ id: "tool-ref" })
  );
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:tool-result`,
    `${sessionId}:tool`,
    sessionId,
    "succeeded",
    "17 tests passed",
    "hash",
    0,
    "2026-06-26T12:09:00.000Z",
    JSON.stringify({ id: "tool-result-ref" })
  );
  db.prepare(
    `INSERT INTO checkpoints (checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:checkpoint`, sessionId, "summary", "Repository implemented.", "2026-06-26T12:09:30.000Z", "{}");
  db.prepare(
    `INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:signal`, sessionId, "verification", "info", "Verification passed", "{}", "2026-06-26T12:09:45.000Z", "{}");
  db.prepare(
    `INSERT INTO model_usage (
      usage_id, session_id, model, provider, input_tokens, output_tokens, total_tokens, observed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:usage`, sessionId, "gpt-5.5", "openai", 1200, 300, 1500, "2026-06-26T12:10:00.000Z", "{}");
  db.prepare("INSERT INTO session_topics (topic_id, session_id, topic, source, confidence) VALUES (?, ?, ?, ?, ?)").run(
    `${sessionId}:topic`,
    sessionId,
    "session-memory",
    "fixture",
    "authoritative"
  );
  upsertSessionEnrichment(db, {
    content: {
      candidateDecisions: [],
      confidence: "medium",
      missingEvidence: ["verification"],
      objective: "Create session dossiers",
      outcome: "Dossier repository ready.",
      providerStatus: "success",
      searchPhrases: ["session dossier"],
      subject: { confidence: "high", label: "Session dossier", source: "objective" },
      technologies: ["TypeScript"],
      title: "Build session dossier",
      titleSource: "llm",
      topics: ["session-memory"],
      unresolved: [{ evidence: [], support: "derived", text: "Need browser check." }],
      validationWarnings: ["Manual browser verification pending."]
    },
    contentFingerprint: `${sessionId}:fingerprint`,
    enrichmentKind: "session_capsule",
    generatedAt: "2026-06-26T12:11:00.000Z",
    model: "gpt-5-nano",
    promptVersion: "session-capsule-v3",
    provider: "openai",
    sessionId,
    sourceRefs: [{ id: "m1", kind: "event", observedAt: "2026-06-26T12:00:00.000Z", source: "fixture" }],
    status: "current"
  });
  upsertSessionEnrichment(db, {
    contentFingerprint: `${sessionId}:fingerprint:failed:timeout:2026-06-26T12:12:00.000Z`,
    enrichmentKind: "session_capsule",
    failureCode: "timeout",
    failureMessage: "OpenAI enrichment timed out. No fallback was persisted.",
    generatedAt: "2026-06-26T12:12:00.000Z",
    model: "gpt-5-nano",
    promptVersion: "session-capsule-v3",
    provider: "openai",
    sessionId,
    sourceRefs: [{ id: "m1", kind: "event", observedAt: "2026-06-26T12:00:00.000Z", source: "fixture" }],
    status: "failed"
  });
}

function insertMessage(db: MastheadDatabase, sessionId: string, id: string, role: string, text: string, observedAt: string): void {
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:${id}`, sessionId, role, text, `${sessionId}:${id}:hash`, observedAt, JSON.stringify({ id }), "authoritative");
}
