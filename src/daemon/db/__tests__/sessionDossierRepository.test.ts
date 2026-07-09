import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { upsertSessionEnrichment } from "../enrichmentRepository.ts";
import { applySessionArtifact } from "../sessionArtifactRepository.ts";
import { getSessionDossier } from "../sessionDossierRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { publishSessionToLogbook, seedSession } from "./sessionTestHelpers.ts";

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
        runtime: "opencode",
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
        sourceRuntime: "opencode",
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
      promptVersion: "session-capsule-v4",
      providerStatus: "success",
      provider: "openai",
      subjectConfidence: "high",
      titleSource: "llm"
    });
    db.close();
  });

  test("includes durable enrichment in the session dossier", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-durable-dossier" });
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        liveSummary: "Live Dossier summary remains separate.",
        searchPhrases: [],
        sessionDossier: {
          blockers: [],
          continuation: {
            constraints: ["Keep Board headlines separate from durable titles."],
            nextStep: "Render durable Dossier sections first.",
            openQuestions: []
          },
          decisions: ["Do not reuse Board live headlines as Logbook titles."],
          evidenceRefs: [],
          keyWork: ["Added durable Dossier enrichment."],
          outcome: "Dossier durable enrichment is available to the UI.",
          purpose: "Expose durable enrichment through the Dossier endpoint.",
          verification: {
            commands: ["vitest"],
            evidenceRefs: [],
            failures: [],
            status: "passed",
            summary: "Dossier repository tests passed."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefs: [],
          state: "completed",
          text: "Exposed durable enrichment through the Session Dossier endpoint."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefs: [],
          text: "Session Dossier enrichment exposure"
        },
        technologies: [],
        title: "Session Dossier enrichment exposure",
        topics: [],
        unresolved: []
      },
      contentFingerprint: "session-durable-dossier:fingerprint:v4",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-26T12:13:00.000Z",
      model: "gpt-5-nano",
      promptVersion: "session-capsule-v4",
      provider: "openai",
      sessionId: "session-durable-dossier",
      sourceRefs: [],
      status: "current"
    });

    const dossier = getSessionDossier(db, "session-durable-dossier");

    expect(dossier?.identity.title).toBe("Session Dossier enrichment exposure");
    expect(dossier?.durableEnrichment?.sessionTitle.text).toBe("Session Dossier enrichment exposure");
    expect(dossier?.durableEnrichment?.sessionDossier.decisions).toContain("Do not reuse Board live headlines as Logbook titles.");
    db.close();
  });

  test("includes current Workbench artifact summaries", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-artifact-dossier" });

    applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: { confidence: "medium", title: "Workbench artifact summary" },
      contentFingerprint: "artifact:fingerprint:1",
      createdBy: "workbench_cli",
      evidenceRefs: ["message:session-artifact-dossier:message"],
      schemaVersion: "session_dossier-v1",
      sessionId: "session-artifact-dossier",
      title: "Workbench artifact summary",
      validation: { ok: true }
    });
    applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: { confidence: "high", title: "Current Workbench artifact" },
      contentFingerprint: "artifact:fingerprint:2",
      createdBy: "workbench_cli",
      evidenceRefs: ["message:session-artifact-dossier:message"],
      schemaVersion: "session_dossier-v1",
      sessionId: "session-artifact-dossier",
      title: "Current Workbench artifact",
      validation: { ok: true }
    });

    const dossier = getSessionDossier(db, "session-artifact-dossier");

    expect(dossier?.artifacts).toEqual([
      expect.objectContaining({
        artifactKind: "session_dossier",
        confidence: "high",
        evidenceRefs: ["message:session-artifact-dossier:message"],
        status: "current",
        title: "Current Workbench artifact"
      })
    ]);
    db.close();
  });

  test("reports current, failed, and missing Dossier enrichment state", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-current-state" });
    seedDossierSession(db, { sessionId: "session-failed-state" });
    seedDossierSession(db, { sessionId: "session-missing-state" });
    db.prepare("DELETE FROM session_enrichments WHERE session_id IN (?, ?, ?)").run(
      "session-current-state",
      "session-failed-state",
      "session-missing-state"
    );
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        liveSummary: "Current Dossier enrichment is available.",
        searchPhrases: [],
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], nextStep: "Use the current enrichment.", openQuestions: [] },
          decisions: [],
          evidenceRefs: [],
          keyWork: ["Generated current enrichment."],
          outcome: "The current Dossier enrichment is visible.",
          purpose: "Expose current enrichment status.",
          verification: { commands: [], evidenceRefs: [], failures: [], status: "passed", summary: "Status test passed." },
          warnings: []
        },
        sessionSummary: { confidence: "high", evidenceRefs: [], state: "completed", text: "Current enrichment exists." },
        sessionTitle: { basis: "dominant_work", confidence: "high", evidenceRefs: [], text: "Current enrichment state" },
        technologies: [],
        title: "Current enrichment state",
        topics: [],
        unresolved: []
      },
      contentFingerprint: "current-state:fingerprint",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-07-03T18:00:00.000Z",
      model: "test-model",
      promptVersion: "session-capsule-v4",
      provider: "test-provider",
      sessionId: "session-current-state",
      sourceRefs: [],
      status: "current"
    });
    upsertSessionEnrichment(db, {
      contentFingerprint: "failed-state:fingerprint:failed:timeout",
      enrichmentKind: "session_capsule",
      failureCode: "timeout",
      failureMessage: "Provider timed out.",
      generatedAt: "2026-07-03T18:01:00.000Z",
      model: "test-model",
      promptVersion: "session-capsule-v4",
      provider: "test-provider",
      sessionId: "session-failed-state",
      sourceRefs: [],
      status: "failed"
    });

    expect(getSessionDossier(db, "session-current-state")?.enrichment).toMatchObject({
      generatedAt: "2026-07-03T18:00:00.000Z",
      model: "test-model",
      provider: "test-provider",
      status: "current"
    });
    expect(getSessionDossier(db, "session-failed-state")?.enrichment).toMatchObject({
      failureCode: "timeout",
      failureMessage: "Provider timed out.",
      status: "failed"
    });
    expect(getSessionDossier(db, "session-missing-state")?.enrichment).toEqual({ status: "not_enriched" });
    db.close();
  });

  test("ignores older current enrichment prompt versions in the session dossier", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-old-enrichment" });
    db.prepare("DELETE FROM session_enrichments WHERE session_id = ?").run("session-old-enrichment");
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        confidence: "high",
        liveSummary: "Validated App for Codex hook event.",
        missingEvidence: [],
        outcome: "Validated App for Codex hook event.",
        providerStatus: "success",
        searchPhrases: ["Codex hook event"],
        technologies: [],
        title: "Project App",
        titleSource: "llm",
        topics: ["codex-hook-event"],
        unresolved: []
      },
      contentFingerprint: "old-v3-fingerprint",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-26T12:11:00.000Z",
      model: "gpt-5-nano",
      promptVersion: "session-capsule-v3",
      provider: "openai",
      sessionId: "session-old-enrichment",
      sourceRefs: [],
      status: "current"
    });

    const dossier = getSessionDossier(db, "session-old-enrichment");

    expect(dossier?.durableEnrichment).toBeUndefined();
    expect(dossier?.narrative.liveSummary).toBeUndefined();
    expect(dossier?.narrative.outcome).toBe("completed");
    expect(dossier?.narrative.narrativeDebug).toBeUndefined();
    db.close();
  });

  test("labels hook-only tokenless sessions without useful transcript as incomplete capture", async () => {
    const db = await openTestDatabase();
    seedSession(db, {
      lifecycle: "running",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session-hook-only",
      title: "Codex hook event"
    });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session-hook-only");
    db.prepare("DELETE FROM model_usage WHERE session_id = ?").run("session-hook-only");
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session-hook-only");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session-hook-only");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session-hook-only");
    db.prepare(
      "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "session-hook-only:hook-message",
      "session-hook-only",
      "user",
      "Codex hook event",
      "session-hook-only:hook-message:hash",
      "2026-06-26T12:00:00.000Z",
      JSON.stringify({ sourceKind: "hook" }),
      "authoritative"
    );
    db.prepare(
      "INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "session-hook-only:signal",
      "session-hook-only",
      "hook",
      "info",
      "Codex hook event",
      "{}",
      "2026-06-26T12:01:00.000Z",
      JSON.stringify({ sourceKind: "hook" })
    );

    const dossier = getSessionDossier(db, "session-hook-only");

    expect(dossier?.coverage.level).toBe("hook_only");
    expect(dossier?.coverage.transcript.hasUsableTranscript).toBe(false);
    expect(dossier?.coverage.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "transcript_missing" }),
        expect.objectContaining({ code: "tokens_missing" }),
        expect.objectContaining({ code: "low_value_hook_summaries" })
      ])
    );
    expect(dossier?.narrative.liveSummary).toContain("Only live hook metadata is available for this session.");
    db.close();
  });

  test("bounds message rows used to build the dossier while preserving newest narrative facts", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-many-messages" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session-many-messages");
    for (let index = 0; index < 320; index += 1) {
      insertMessage(
        db,
        "session-many-messages",
        `bulk-${index}`,
        index % 2 === 0 ? "user" : "assistant",
        `Bounded dossier message ${index}`,
        `2026-06-26T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
      );
    }

    const dossier = getSessionDossier(db, "session-many-messages");

    expect(dossier?.narrative.firstUserPrompt).toBe("Bounded dossier message 0");
    expect(dossier?.narrative.latestUserPrompt).toBe("Bounded dossier message 318");
    expect(dossier?.narrative.finalAssistantMessage).toBe("Bounded dossier message 319");
    expect(dossier?.excerpts).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", text: "Bounded dossier message 0" })])
    );
    expect(dossier?.timeline.length).toBeGreaterThan(200);
    expect(dossier?.timeline.length).toBeLessThanOrEqual(260);
    db.close();
  });

  test("limits dossier tools before joining tool results", async () => {
    const db = await openTestDatabase();
    seedDossierSession(db, { sessionId: "session-many-tool-results" });
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session-many-tool-results");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session-many-tool-results");
    for (let index = 0; index < 120; index += 1) {
      const toolCallId = `session-many-tool-results:tool-${index}`;
      const startedAt = `2026-06-26T13:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
      db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
        toolCallId,
        "session-many-tool-results",
        `tool ${index}`,
        startedAt,
        JSON.stringify({ id: toolCallId })
      );
      for (let resultIndex = 0; resultIndex < 2; resultIndex += 1) {
        db.prepare(
          `INSERT INTO tool_results (
            tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `${toolCallId}:result-${resultIndex}`,
          toolCallId,
          "session-many-tool-results",
          "succeeded",
          `tool ${index} result ${resultIndex}`,
          `${toolCallId}:result-${resultIndex}:hash`,
          0,
          startedAt,
          JSON.stringify({ id: `${toolCallId}:result-${resultIndex}` })
        );
      }
    }

    const dossier = getSessionDossier(db, "session-many-tool-results");
    const toolIds = dossier?.tools.map((tool) => tool.toolCallId) ?? [];

    expect(toolIds).toHaveLength(100);
    expect(new Set(toolIds).size).toBe(100);
    expect(toolIds).toContain("session-many-tool-results:tool-119");
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
  publishSessionToLogbook(db, sessionId);
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
    promptVersion: "session-capsule-v4",
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
    promptVersion: "session-capsule-v4",
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
