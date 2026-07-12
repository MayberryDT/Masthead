import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { upsertSessionEnrichment } from "../db/enrichmentRepository.ts";
import { approveTranscriptImport } from "../db/sourceRepository.ts";
import { setSourcePolicy } from "../db/sourcePolicyRepository.ts";
import { publishSessionToLogbook, seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import {
  claimWorkbenchSessions,
  ensureWorkbenchSessionState,
  markWorkbenchNotAdded,
  markWorkbenchArtifactSatisfied,
  markWorkbenchSessionEnrichmentSatisfied,
  recordWorkbenchActivity
} from "../db/workbenchPipelineRepository.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("workbench API", () => {
  test("returns publish-path sessions without leaking Not Added details", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:queue",
      title: "Queued session"
    });
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:not-added",
      title: "Rejected session"
    });
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:published",
      title: "Published session"
    });
    ensureWorkbenchSessionState(daemon.database, "session:queue");
    recordWorkbenchActivity(daemon.database, {
      actor: { kind: "agent", id: "codex" },
      eventType: "transcript_checked",
      sessionId: "session:queue",
      summary: "Transcript checked"
    });
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const claim = claimWorkbenchSessions(daemon.database, {
      claimedBy: "codex",
      expiresAt,
      sessionIds: ["session:queue"]
    });
    markWorkbenchNotAdded(daemon.database, {
      actor: { kind: "system", id: "quality" },
      reason: "metadata_only",
      sessionId: "session:not-added"
    });
    publishSessionToLogbook(daemon.database, "session:published");

    const body = await getJson(baseUrl, "/workbench/sessions?limit=10");

    expect(body).toMatchObject({ ok: true, scope: "default" });
    expect(body.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activeClaim: {
            claimId: claim.claims[0].claimId,
            claimedBy: "codex",
            expiresAt
          },
          latestActivity: expect.objectContaining({ eventType: expect.any(String), sessionId: "session:queue" }),
          nextAction: "check_transcript",
          publicationStatus: "publish_path",
          sessionId: "session:queue",
          title: "Queued session"
        }),
        expect.objectContaining({
          nextAction: "enrich",
          publicationStatus: "published",
          sessionId: "session:published"
        })
      ])
    );
    expect(body.sessions).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("session:not-added");
  });

  test("returns Workbench activity rows", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:activity",
      title: "Activity session"
    });
    ensureWorkbenchSessionState(daemon.database, "session:activity");
    recordWorkbenchActivity(daemon.database, {
      actor: { kind: "agent", id: "codex" },
      details: { checked: true },
      eventType: "transcript_checked",
      sessionId: "session:activity",
      summary: "Transcript checked"
    });

    const body = await getJson(baseUrl, "/workbench/activity?limit=10&sessionId=session%3Aactivity");

    expect(body).toMatchObject({
      ok: true,
      activity: [expect.objectContaining({ eventType: "transcript_checked", sessionId: "session:activity" })]
    });
  });

  test("summarizes Not Added without details by default and exposes details only explicitly", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:not-added",
      title: "Rejected session"
    });
    markWorkbenchNotAdded(daemon.database, {
      actor: { kind: "system", id: "quality" },
      reason: "metadata_only",
      sessionId: "session:not-added"
    });

    const summary = await getJson(baseUrl, "/workbench/not-added-summary");
    expect(summary).toEqual({
      ok: true,
      total: 1,
      reasons: [{ count: 1, reason: "metadata_only" }]
    });
    expect(JSON.stringify(summary)).not.toContain("session:not-added");

    const details = await getJson(baseUrl, "/workbench/not-added?includeDetails=true&limit=10");
    expect(details).toMatchObject({
      ok: true,
      total: 1,
      sessions: [expect.objectContaining({ reason: "metadata_only", sessionId: "session:not-added" })]
    });
  });

  test("publishes sessions only after readiness gates pass", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:publish",
      title: "Publish candidate"
    });

    const blocked = await postJson(baseUrl, "/workbench/sessions/session%3Apublish/publish", {}, 409);
    expect(blocked).toMatchObject({
      ok: false,
      code: "publication_gate_failed",
      missing: ["transcript", "quality", "session_enrichment", "session_dossier"]
    });

    ensureWorkbenchSessionState(daemon.database, "session:publish");
    daemon.database
      .prepare("UPDATE workbench_session_state SET transcript_status = 'imported', quality_status = 'passed' WHERE session_id = ?")
      .run("session:publish");
    markWorkbenchSessionEnrichmentSatisfied(daemon.database, { actor: { kind: "agent", id: "codex" }, sessionId: "session:publish" });
    markWorkbenchArtifactSatisfied(daemon.database, {
      actor: { kind: "agent", id: "codex" },
      artifactKind: "session_dossier",
      sessionId: "session:publish"
    });
    markWorkbenchArtifactSatisfied(daemon.database, {
      actor: { kind: "agent", id: "codex" },
      artifactKind: "runbook",
      sessionId: "session:publish"
    });

    const published = await postJson(baseUrl, "/workbench/sessions/session%3Apublish/publish");
    expect(published).toMatchObject({
      ok: true,
      activity: { eventType: "published" },
      state: { publicationStatus: "published", sessionId: "session:publish" }
    });
  });

  test("checks transcripts and requires source-scoped permission for Workbench transcript import", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:transcript",
      title: "Transcript candidate"
    });
    seedSessionSource(daemon.database, "session:transcript", "source:allowed");
    seedIngestSource(daemon.database, "source:other");
    approveTranscriptImport(daemon.database, {
      approvedAt: "2026-07-08T12:00:00.000Z",
      reason: "Global approval should not satisfy Workbench import."
    });

    const checked = await postJson(baseUrl, "/workbench/sessions/session%3Atranscript/check-transcript");
    expect(checked).toMatchObject({ ok: true, sessionId: "session:transcript", transcriptStatus: "imported" });

    const denied = await postJson(baseUrl, "/workbench/sessions/session%3Atranscript/import-transcript-preview", { sourceId: "source:allowed" }, 409);
    expect(denied).toMatchObject({
      ok: false,
      code: "transcript_permission_required",
      sessionId: "session:transcript",
      sourceId: "source:allowed"
    });

    setSourcePolicy(daemon.database, {
      decidedAt: "2026-07-08T12:01:00.000Z",
      enabled: true,
      policyKind: "transcript_import",
      sourceId: "source:allowed"
    });
    setSourcePolicy(daemon.database, {
      decidedAt: "2026-07-08T12:01:00.000Z",
      enabled: true,
      policyKind: "transcript_import",
      sourceId: "source:other"
    });

    const unrelated = await postJson(baseUrl, "/workbench/sessions/session%3Atranscript/import-transcript-preview", { sourceId: "source:other" }, 409);
    expect(unrelated).toMatchObject({
      ok: false,
      code: "source_not_linked",
      sessionId: "session:transcript",
      sourceId: "source:other"
    });

    const previewed = await postJson(baseUrl, "/workbench/sessions/session%3Atranscript/import-transcript-preview", { sourceId: "source:allowed" });
    expect(previewed).toMatchObject({
      ok: true,
      sessionId: "session:transcript",
      sourceId: "source:allowed",
      transcriptStatus: "available"
    });
  });

  test("POST /workbench/enroll-missing enrolls only sessions without state", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:missing",
      title: "Missing from pipeline"
    });
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:published",
      title: "Already published"
    });
    publishSessionToLogbook(daemon.database, "session:published");

    const body = await postJson(baseUrl, "/workbench/enroll-missing", { limit: 100 });
    expect(body).toMatchObject({
      ok: true,
      enrolled: expect.any(Number),
      skippedExisting: expect.any(Number),
      enrolledSessionIds: expect.any(Array),
      limit: 100
    });
    expect(body.enrolled).toBeGreaterThanOrEqual(1);
    expect(body.enrolledSessionIds).toContain("session:missing");
    expect(typeof body.generatedAt).toBe("string");

    const queue = await getJson(baseUrl, "/workbench/sessions?limit=50");
    expect(queue.sessions.some((session: { sessionId: string }) => session.sessionId === "session:missing")).toBe(true);
    expect(queue.sessions.some((session: { sessionId: string }) => session.sessionId === "session:published")).toBe(true);
  });

  test("POST claim and release round-trip on queue DTO", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:claim",
      title: "Claim candidate"
    });
    ensureWorkbenchSessionState(daemon.database, "session:claim");

    const claimBody = await postJson(baseUrl, "/workbench/sessions/session%3Aclaim/claim", {
      claimedBy: "ui-user",
      ttlSeconds: 300
    });
    expect(claimBody).toMatchObject({
      ok: true,
      claims: [expect.objectContaining({ claimedBy: "ui-user", sessionId: "session:claim" })]
    });
    const claimId = claimBody.claims[0].claimId as string;
    expect(typeof claimId).toBe("string");

    const queue = await getJson(baseUrl, "/workbench/sessions?limit=20");
    const row = queue.sessions.find((session: { sessionId: string }) => session.sessionId === "session:claim");
    expect(row).toMatchObject({
      activeClaim: {
        claimId,
        claimedBy: "ui-user"
      },
      sessionId: "session:claim"
    });

    const released = await postJson(baseUrl, `/workbench/claims/${encodeURIComponent(claimId)}/release`, {
      reason: "done"
    });
    expect(released).toMatchObject({
      ok: true,
      claim: expect.objectContaining({
        claimId,
        releaseReason: "done",
        sessionId: "session:claim"
      })
    });
    expect(typeof released.claim.releasedAt).toBe("string");

    const afterRelease = await getJson(baseUrl, "/workbench/sessions?limit=20");
    const releasedRow = afterRelease.sessions.find((session: { sessionId: string }) => session.sessionId === "session:claim");
    expect(releasedRow?.activeClaim).toBeUndefined();
  });

  test("POST quality pass, fail, and precheck", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:quality",
      title: "Quality candidate"
    });
    for (const [index, role, text] of [
      [1, "assistant", "I will inspect the candidate pipeline."],
      [2, "user", "Please implement and verify the gate."],
      [3, "assistant", "The implementation now uses canonical evidence."]
    ] as const) {
      daemon.database
        .prepare(
          "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          `session:quality:message:${index}`,
          "session:quality",
          role,
          text,
          `session:quality:hash:${index}`,
          `2026-06-25T12:00:0${index}.000Z`,
          "{}",
          "authoritative"
        );
    }
    ensureWorkbenchSessionState(daemon.database, "session:quality");
    daemon.database
      .prepare(
        `UPDATE workbench_session_state
         SET transcript_status = 'imported', quality_status = 'unchecked', next_action = 'review_quality'
         WHERE session_id = ?`
      )
      .run("session:quality");

    const passed = await postJson(baseUrl, "/workbench/sessions/session%3Aquality/quality", {
      actorId: "ui-user",
      status: "passed"
    });
    expect(passed).toMatchObject({
      ok: true,
      activity: expect.objectContaining({ actorId: "ui-user", eventType: "quality_passed" }),
      state: expect.objectContaining({
        nextAction: "enrich",
        publicationStatus: "publish_path",
        qualityStatus: "passed",
        sessionId: "session:quality"
      })
    });

    const failed = await postJson(baseUrl, "/workbench/sessions/session%3Aquality/quality", {
      reason: "hook_only_noise",
      status: "failed"
    });
    expect(failed).toMatchObject({
      ok: true,
      activity: expect.objectContaining({ actorId: "workbench_ui", eventType: "quality_failed" }),
      state: expect.objectContaining({
        nonPublicationReason: "hook_only_noise",
        publicationStatus: "not_added_to_logbook",
        qualityStatus: "failed",
        sessionId: "session:quality"
      })
    });

    // Re-admit to publish path, then exercise precheck with grounded multi-turn evidence.
    await postJson(baseUrl, "/workbench/sessions/session%3Aquality/quality", { status: "passed" });
    const precheckPass = await postJson(baseUrl, "/workbench/sessions/session%3Aquality/quality", { mode: "precheck" });
    expect(precheckPass).toMatchObject({
      ok: true,
      precheck: expect.objectContaining({ ok: true, reason: "meaningful_message", sessionId: "session:quality" }),
      state: expect.objectContaining({
        publicationStatus: "publish_path",
        qualityStatus: "passed",
        sessionId: "session:quality"
      })
    });

    // Strip transcript so precheck fails and marks not-added.
    daemon.database.prepare("DELETE FROM messages WHERE session_id = ?").run("session:quality");
    daemon.database.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session:quality");
    daemon.database.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session:quality");
    daemon.database.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:quality");
    daemon.database.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run("session:quality");
    daemon.database.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:quality");
    const precheckFail = await postJson(baseUrl, "/workbench/sessions/session%3Aquality/quality", { mode: "precheck" });
    expect(precheckFail).toMatchObject({
      ok: false,
      precheck: expect.objectContaining({ ok: false, reason: "metadata_only", sessionId: "session:quality" }),
      state: expect.objectContaining({
        nonPublicationReason: "metadata_only",
        publicationStatus: "not_added_to_logbook",
        qualityStatus: "failed",
        sessionId: "session:quality"
      })
    });

    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:published-quality",
      title: "Published quality block"
    });
    ensureWorkbenchSessionState(daemon.database, "session:published-quality");
    daemon.database
      .prepare(
        `UPDATE workbench_session_state
         SET transcript_status = 'imported',
             quality_status = 'passed',
             session_enrichment_status = 'satisfied',
             session_dossier_status = 'satisfied',
             runbook_status = 'satisfied'
         WHERE session_id = ?`
      )
      .run("session:published-quality");
    const published = await postJson(baseUrl, "/workbench/sessions/session%3Apublished-quality/publish");
    expect(published).toMatchObject({ ok: true, state: { publicationStatus: "published" } });

    const blockedFail = await postJson(
      baseUrl,
      "/workbench/sessions/session%3Apublished-quality/quality",
      { reason: "late_reject", status: "failed" },
      409
    );
    expect(blockedFail).toMatchObject({
      ok: false,
      code: "cannot_fail_quality_on_published_session",
      sessionId: "session:published-quality"
    });
  });

  test("returns recent sessions missing Workbench enrichment", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:missing",
      title: "Raw session needing memory"
    });
    ensureWorkbenchSessionState(daemon.database, "session:missing");
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:current",
      title: "Already enriched"
    });
    daemon.database.prepare("UPDATE runtimes SET runtime_kind = ? WHERE runtime_id = ?").run("codex", "runtime:opencode");
    upsertSessionEnrichment(daemon.database, {
      content: { candidateDecisions: [], searchPhrases: [], technologies: [], title: "Already enriched", topics: [], unresolved: [] },
      contentFingerprint: "current",
      enrichmentKind: "session_capsule",
      generatedAt: "2026-07-08T00:00:00.000Z",
      model: "external_agent",
      promptVersion: "session-capsule-v4",
      provider: "workbench_cli",
      sessionId: "session:current",
      sourceRefs: [],
      status: "current"
    });

    const body = await getJson(baseUrl, "/workbench/missing-sessions?limit=10");

    expect(body).toMatchObject({
      ok: true,
      limit: 10,
      sessions: [
        expect.objectContaining({
          sessionId: "session:missing",
          title: "Raw session needing memory",
          project: "Masthead",
          runtime: "codex",
          enrichmentStatus: "missing"
        })
      ]
    });
    expect(body.sessions).toHaveLength(1);
  });

  test("does not hide a raw session when another current Workbench enrichment kind exists", async () => {
    const { baseUrl, daemon } = await startTestDaemon();
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:missing",
      title: "Raw session needing capsule"
    });
    ensureWorkbenchSessionState(daemon.database, "session:missing");
    daemon.database.prepare("UPDATE runtimes SET runtime_kind = ? WHERE runtime_id = ?").run("codex", "runtime:opencode");
    upsertSessionEnrichment(daemon.database, {
      content: { text: "Fresh live summary" },
      contentFingerprint: "live-summary-current",
      enrichmentKind: "live_summary",
      generatedAt: "2026-07-08T00:00:00.000Z",
      model: "external_agent",
      promptVersion: "session-capsule-v4",
      provider: "workbench_cli",
      sessionId: "session:missing",
      sourceRefs: [],
      status: "current"
    });

    const body = await getJson(baseUrl, "/workbench/missing-sessions?limit=10");

    expect(body.sessions).toEqual([
      expect.objectContaining({
        enrichmentStatus: "missing",
        runtime: "codex",
        sessionId: "session:missing",
        title: "Raw session needing capsule"
      })
    ]);
  });
});

async function startTestDaemon(): Promise<{ baseUrl: string; daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-api-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  const baseUrl = await listen(daemon);
  return { baseUrl, daemon, databasePath, storePath, tempDir };
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

function seedSessionSource(db: MastheadDaemon["database"], sessionId: string, sourceId: string): void {
  seedIngestSource(db, sourceId);
  const now = "2026-07-08T12:00:00.000Z";
  db.prepare(
    `INSERT INTO session_sources (session_id, source_id, first_seen_at, last_seen_at, imported_record_count)
    VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, sourceId, now, now, 1);
}

function seedIngestSource(db: MastheadDaemon["database"], sourceId: string): void {
  const now = "2026-07-08T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "codex", "jsonl", `/tmp/${sourceId}.jsonl`, "authoritative", now, now);
}

async function postJson(baseUrl: string, path: string, body: unknown = {}, expectedStatus = 200): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(expectedStatus);
  return response.json() as Promise<Record<string, any>>;
}
