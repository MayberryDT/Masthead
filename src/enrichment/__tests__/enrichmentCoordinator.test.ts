import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readCurrentSessionEnrichment, readSessionEnrichment, upsertSessionEnrichment } from "../../daemon/db/enrichmentRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { createDeterministicEnrichmentProvider } from "../deterministicProvider.ts";
import { createEnrichmentCoordinator, EnrichmentFailedError, shouldReplaceSessionTitle } from "../enrichmentCoordinator.ts";
import { buildSessionFacts } from "../sessionFacts.ts";
import { fingerprintSessionFacts, SESSION_CAPSULE_PROMPT_VERSION } from "../sessionCompiler.ts";
import type { SessionEnrichmentProvider } from "../provider.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("enrichment coordinator", () => {
  test("a changed session marks old enrichment stale and queues a replacement", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const coordinator = createEnrichmentCoordinator(db, createDeterministicEnrichmentProvider());

    const first = await coordinator.enrich("session-1");
    appendMessage(db, "session-1", "assistant", "The build now passes.");

    const second = await coordinator.ensureCurrent("session-1");

    expect(first.contentFingerprint).not.toBe(second.contentFingerprint);
    expect(readSessionEnrichment(db, first.enrichmentId)?.status).toBe("stale");
    expect(second.status).toBe("current");
    db.close();
  });

  test("failed provider result writes a failed capsule without replacing current summaries", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const successCoordinator = createEnrichmentCoordinator(db, createDeterministicEnrichmentProvider());
    const current = await successCoordinator.enrich("session-1");
    const currentLiveSummary = readCurrentSessionEnrichment(db, "session-1", "live_summary", current.promptVersion);
    const currentSearchProjection = readCurrentSessionEnrichment(db, "session-1", "search_projection", current.promptVersion);

    const failureCoordinator = createEnrichmentCoordinator(db, failingProvider("timeout"));

    await expect(failureCoordinator.enrich("session-1")).rejects.toMatchObject({
      name: "EnrichmentFailedError",
      status: "timeout"
    });

    expect(readSessionEnrichment(db, current.enrichmentId)?.status).toBe("current");
    expect(readCurrentSessionEnrichment(db, "session-1", "live_summary", current.promptVersion)?.enrichmentId).toBe(
      currentLiveSummary?.enrichmentId
    );
    expect(readCurrentSessionEnrichment(db, "session-1", "search_projection", current.promptVersion)?.enrichmentId).toBe(
      currentSearchProjection?.enrichmentId
    );
    const failedRows = db
      .prepare(
        `SELECT status, failure_code AS failureCode, failure_message AS failureMessage, content_fingerprint AS fingerprint
        FROM session_enrichments
        WHERE session_id = ? AND enrichment_kind = 'session_capsule' AND status = 'failed'`
      )
      .all("session-1") as Array<{ status: string; failureCode: string; failureMessage: string; fingerprint: string }>;
    expect(failedRows).toEqual([
      {
        failureCode: "timeout",
        failureMessage: "Provider timed out.",
        fingerprint: expect.stringContaining(":failed:timeout"),
        status: "failed"
      }
    ]);
    db.close();
  });

  test("repeated failed provider results dedupe by stable failed fingerprint", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const provider = countingFailingProvider("timeout");
    const coordinator = createEnrichmentCoordinator(db, provider);

    await expect(coordinator.enrich("session-1")).rejects.toMatchObject({ status: "timeout" });
    await expect(coordinator.enrich("session-1")).rejects.toMatchObject({ status: "timeout" });

    const failedRows = db
      .prepare(
        `SELECT content_fingerprint AS fingerprint, failure_code AS failureCode
        FROM session_enrichments
        WHERE session_id = ? AND enrichment_kind = 'session_capsule' AND status = 'failed'`
      )
      .all("session-1") as Array<{ failureCode: string; fingerprint: string }>;

    expect(provider.calls()).toBe(2);
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0]).toMatchObject({
      failureCode: "timeout",
      fingerprint: expect.stringMatching(/:failed:timeout$/)
    });
    db.close();
  });

  test("ensureCurrent backs off recent timeout enrichment for unchanged facts", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const provider = countingFailingProvider("timeout");
    let now = Date.parse("2026-06-25T12:00:00.000Z");
    const coordinator = createEnrichmentCoordinator(db, provider, {
      failureBackoffMs: 10 * 60_000,
      now: () => now
    });

    await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "timeout" });
    const backedOff = await coordinator.ensureCurrent("session-1");

    now += 10 * 60_000 + 1;
    await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "timeout" });

    expect(backedOff).toMatchObject({
      failureCode: "timeout",
      status: "failed"
    });
    expect(provider.calls()).toBe(2);
    db.close();
  });

  test("ensureCurrent backs off recent validation failures for unchanged facts", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const provider = countingFailingProvider("validation_failed");
    let now = Date.parse("2026-06-25T12:00:00.000Z");
    const coordinator = createEnrichmentCoordinator(db, provider, {
      failureBackoffMs: 10 * 60_000,
      now: () => now
    });

    await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "validation_failed" });
    const backedOff = await coordinator.ensureCurrent("session-1");

    now += 10 * 60_000 + 1;
    await expect(coordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "validation_failed" });

    expect(backedOff).toMatchObject({
      failureCode: "validation_failed",
      status: "failed"
    });
    expect(provider.calls()).toBe(2);
    db.close();
  });

  test("ensureCurrent retries recent failures that predate the current daemon run", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const failedAt = Date.parse("2026-06-25T12:00:00.000Z");
    const failingCoordinator = createEnrichmentCoordinator(db, countingFailingProvider("timeout"), {
      failureBackoffMs: 10 * 60_000,
      now: () => failedAt
    });
    await expect(failingCoordinator.ensureCurrent("session-1")).rejects.toMatchObject({ status: "timeout" });
    const provider = countingSuccessfulProvider();
    const restartedCoordinator = createEnrichmentCoordinator(db, provider, {
      failureBackoffAfterMs: failedAt + 1,
      failureBackoffMs: 10 * 60_000,
      now: () => failedAt + 60_000
    });

    const refreshed = await restartedCoordinator.ensureCurrent("session-1");

    expect(provider.calls()).toBe(1);
    expect(refreshed).toMatchObject({
      provider: "test-provider",
      status: "current"
    });
    db.close();
  });

  test("ensureCurrent refreshes deterministic current enrichment when a model provider is configured", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const deterministicCoordinator = createEnrichmentCoordinator(db, createDeterministicEnrichmentProvider());
    await deterministicCoordinator.enrich("session-1");
    const provider = countingSuccessfulProvider();
    const modelCoordinator = createEnrichmentCoordinator(db, provider);

    const refreshed = await modelCoordinator.ensureCurrent("session-1");

    expect(provider.calls()).toBe(1);
    expect(refreshed).toMatchObject({
      model: "test-model",
      provider: "test-provider",
      status: "current"
    });
    expect(readCurrentSessionEnrichment(db, "session-1", "session_capsule", refreshed.promptVersion)).toMatchObject({
      model: "test-model",
      provider: "test-provider"
    });
    db.close();
  });

  test("ensureCurrent retries weak current fallback content when transcript facts are rich", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    appendMessage(db, "session-1", "assistant", "Implemented OAuth Logbook search and verified the focused tests passed.");
    const facts = buildSessionFacts(db, "session-1");
    const fingerprint = fingerprintSessionFacts(facts);
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        confidence: "high",
        durableEnrichment: {
          keywords: [],
          sessionDossier: {
            blockers: [],
            continuation: {
              constraints: [],
              nextStep: "Review the original source transcript if more context is needed.",
              openQuestions: []
            },
            decisions: [],
            evidenceRefs: [],
            keyWork: ["Changed 2 files."],
            outcome: "Masthead imported limited session metadata for this record.",
            purpose: "Not enough transcript evidence is available to identify the session purpose reliably.",
            verification: {
              commands: [],
              evidenceRefs: [],
              failures: [],
              status: "missing",
              summary: "No reliable verification evidence was captured."
            },
            warnings: ["Durable enrichment used a low-confidence fallback."]
          },
          sessionSummary: {
            confidence: "low",
            evidenceRefs: [],
            state: "unknown",
            text: "Imported historical Masthead session evidence with limited durable enrichment context."
          },
          sessionTitle: {
            basis: "dominant_work",
            confidence: "high",
            evidenceRefs: [],
            text: "OAuth Logbook search"
          },
          source: "remote_model",
          version: "session-capsule-v4"
        },
        liveSummary: "Imported historical Masthead session evidence with limited durable enrichment context.",
        searchPhrases: [],
        searchSummary: "OAuth Logbook search Imported historical Masthead session evidence with limited durable enrichment context.",
        sessionDossier: {
          blockers: [],
          continuation: {
            constraints: [],
            nextStep: "Review the original source transcript if more context is needed.",
            openQuestions: []
          },
          decisions: [],
          evidenceRefs: [],
          keyWork: ["Changed 2 files."],
          outcome: "Masthead imported limited session metadata for this record.",
          purpose: "Not enough transcript evidence is available to identify the session purpose reliably.",
          verification: {
            commands: [],
            evidenceRefs: [],
            failures: [],
            status: "missing",
            summary: "No reliable verification evidence was captured."
          },
          warnings: ["Durable enrichment used a low-confidence fallback."]
        },
        sessionSummary: {
          confidence: "low",
          evidenceRefs: [],
          state: "unknown",
          text: "Imported historical Masthead session evidence with limited durable enrichment context."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefs: [],
          text: "OAuth Logbook search"
        },
        technologies: [],
        title: "OAuth Logbook search",
        topics: [],
        unresolved: [],
        validationWarnings: ["liveSummary:missing", "searchSummary:missing"]
      },
      contentFingerprint: fingerprint,
      enrichmentKind: "session_capsule",
      generatedAt: "2026-06-25T12:05:00.000Z",
      model: "test-model",
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      provider: "test-provider",
      sessionId: "session-1",
      sourceRefs: facts.evidence,
      status: "current"
    });
    const provider = countingSuccessfulProvider();
    const coordinator = createEnrichmentCoordinator(db, provider);

    const refreshed = await coordinator.ensureCurrent("session-1");

    expect(provider.calls()).toBe(1);
    expect(refreshed).toMatchObject({
      provider: "test-provider",
      status: "current"
    });
    db.close();
  });

  test("typed enrichment failure exposes provider status for diagnostics", () => {
    const error = new EnrichmentFailedError({
      failureMessage: "Provider timed out.",
      model: "test-model",
      provider: "test-provider",
      status: "timeout"
    });

    expect(error).toMatchObject({
      failureMessage: "Provider timed out.",
      model: "test-model",
      name: "EnrichmentFailedError",
      provider: "test-provider",
      status: "timeout"
    });
  });

  test("does not replace a high-confidence ended title with lower-confidence provider output", () => {
    const current = {
      basis: "dominant_work" as const,
      confidence: "high" as const,
      evidenceRefs: [],
      text: "Durable ended session title"
    };
    const lower = {
      basis: "fallback" as const,
      confidence: "low" as const,
      evidenceRefs: [],
      text: "Masthead imported evidence"
    };

    expect(shouldReplaceSessionTitle({ current, incoming: lower, lifecycle: "ended" })).toBe(false);
    expect(shouldReplaceSessionTitle({ current: lower, incoming: current, lifecycle: "ended" })).toBe(true);
    expect(shouldReplaceSessionTitle({ current, incoming: lower, lifecycle: "running" })).toBe(true);
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-enrichment-coordinator-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: MastheadDatabase): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "runtime:codex",
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session-1", "host:test", "runtime:codex", "source-session-1", "Masthead", "Build Logbook", "ended", now, "authoritative", now, now);
  appendMessage(db, "session-1", "user", "Build OAuth Logbook search.");
}

function appendMessage(db: MastheadDatabase, sessionId: string, role: string, text: string): void {
  const observedAt = new Date(1_780_000_000_000 + Math.floor(Math.random() * 1000)).toISOString();
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`message:${role}:${text}`, sessionId, role, text, `${role}:${text}`, observedAt, "{}", "authoritative");
}

function failingProvider(status: "timeout" | "api_error"): SessionEnrichmentProvider {
  return {
    id: "test-provider",
    model: "test-model",
    async enrich() {
      return {
        failureMessage: "Provider timed out.",
        model: "test-model",
        provider: "test-provider",
        source: "none",
        status
      };
    }
  };
}

function countingFailingProvider(status: "timeout" | "api_error" | "validation_failed"): SessionEnrichmentProvider & { calls(): number } {
  let calls = 0;
  return {
    calls: () => calls,
    id: "test-provider",
    model: "test-model",
    async enrich() {
      calls += 1;
      return {
        failureMessage: status === "validation_failed" ? "Provider output failed validation." : "Provider timed out.",
        model: "test-model",
        provider: "test-provider",
        source: "none",
        status
      };
    }
  };
}

function countingSuccessfulProvider(): SessionEnrichmentProvider & { calls(): number } {
  let calls = 0;
  return {
    calls: () => calls,
    id: "test-provider",
    model: "test-model",
    async enrich() {
      calls += 1;
      return {
        capsule: {
          candidateDecisions: [],
          confidence: "high",
          liveSummary: "Model provider refreshed deterministic fallback.",
          missingEvidence: [],
          outcome: "Configured provider current enrichment is available.",
          searchPhrases: ["provider refresh"],
          technologies: [],
          title: "Provider refreshed enrichment",
          topics: [],
          unresolved: []
        },
        model: "test-model",
        provider: "test-provider",
        source: "llm",
        status: "success"
      };
    }
  };
}
