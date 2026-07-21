import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  deleteAllMastheadData,
  deleteMastheadData,
  type DeleteMastheadDataScope
} from "../dataLifecycleRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../sessionArtifactRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { indexSessionSearch } from "../searchRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { getDataRevisions } from "../dataRevisionRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("data lifecycle repository", () => {
  test("increments both revisions for scoped session deletion", async () => {
    const db = await openTestDatabase();
    seedScopedAuthoredSession(db, {
      hostId: "host:target",
      hostname: "target-host",
      project: "Target project",
      runtimeId: "runtime:target",
      runtimeKind: "target-runtime",
      sessionId: "session:target"
    });
    const before = getDataRevisions(db);

    deleteMastheadData(db, { kind: "session", sessionId: "session:target" });

    expect(getDataRevisions(db)).toEqual({ logbook: before.logbook + 1, workbench: before.workbench + 1 });
    db.close();
  });

  test("deleteAllMastheadData removes every canonical and derived record", async () => {
    const db = await openTestDatabase();
    const databaseId = getOrCreateDatabaseIdentity(db);
    seedCanonicalSessionGraph(db);

    const result = deleteAllMastheadData(db);

    expect(result.sessions).toBe(1);
    expect(result.rawEvents).toBe(1);
    expect(result.enrichments).toBe(1);
    expect(result.auditRows).toBe(1);
    expect(count(db, "sessions")).toBe(0);
    expect(count(db, "messages")).toBe(0);
    expect(count(db, "session_enrichments")).toBe(0);
    expect(count(db, "session_search")).toBe(0);
    expect(count(db, "session_search_rowids")).toBe(0);
    expect(count(db, "session_artifact_search")).toBe(0);
    expect(count(db, "session_artifact_provenance")).toBe(0);
    expect(count(db, "session_artifacts")).toBe(0);
    expect(count(db, "workbench_authoring_run_sessions")).toBe(0);
    expect(count(db, "workbench_authoring_runs")).toBe(0);
    expect(count(db, "workbench_runs")).toBe(0);
    expect(count(db, "workbench_claims")).toBe(0);
    expect(count(db, "workbench_activity")).toBe(0);
    expect(count(db, "raw_events")).toBe(0);
    expect(count(db, "ingest_sources")).toBe(0);
    expect(count(db, "hosts")).toBe(0);
    expect(count(db, "runtimes")).toBe(0);
    expect(getOrCreateDatabaseIdentity(db)).toBe(databaseId);
    db.close();
  });

  test.each<[string, DeleteMastheadDataScope]>([
    ["session", { kind: "session", sessionId: "session:target" }],
    ["project", { kind: "project", project: "Target project" }],
    ["runtime", { kind: "runtime", runtime: "runtime:target" }],
    ["host", { kind: "host", host: "target-host" }]
  ])("%s deletion removes only authored data associated with its sessions", async (_label, scope) => {
    const db = await openTestDatabase();
    const databaseId = getOrCreateDatabaseIdentity(db);
    seedScopedAuthoredSession(db, {
      hostId: "host:target",
      hostname: "target-host",
      project: "Target project",
      runtimeId: "runtime:target",
      runtimeKind: "target-runtime",
      sessionId: "session:target"
    });
    const retained = seedScopedAuthoredSession(db, {
      hostId: "host:retained",
      hostname: "retained-host",
      project: "Retained project",
      runtimeId: "runtime:retained",
      runtimeKind: "retained-runtime",
      sessionId: "session:retained"
    });

    const result = deleteMastheadData(db, scope);

    expect(result.sessions).toBe(1);
    expect(ids(db, "sessions", "session_id")).toEqual(["session:retained"]);
    expect(ids(db, "session_artifacts", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "session_artifact_provenance", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "session_artifact_search", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "workbench_authoring_runs", "run_id")).toEqual(["authoring:session:retained"]);
    expect(ids(db, "workbench_authoring_run_sessions", "run_id")).toEqual(["authoring:session:retained"]);
    expect(ids(db, "workbench_runs", "run_id")).toEqual(["legacy:authoring:session:retained"]);
    expect(ids(db, "workbench_claims", "claim_id")).toEqual(["claim:session:retained"]);
    expect(ids(db, "workbench_activity", "activity_id")).toEqual(["activity:session:retained"]);
    expect(ids(db, "session_search", "session_id")).toEqual(["session:retained"]);
    expect(ids(db, "session_search_rowids", "session_id")).toEqual(["session:retained"]);
    expect(getOrCreateDatabaseIdentity(db)).toBe(databaseId);
    db.close();
  });

  test("session deletion removes multi-session artifacts and authoring runs that include it", async () => {
    const db = await openTestDatabase();
    seedScopedAuthoredSession(db, {
      hostId: "host:target",
      hostname: "target-host",
      project: "Shared project",
      runtimeId: "runtime:target",
      runtimeKind: "target-runtime",
      sessionId: "session:target"
    });
    const retained = seedScopedAuthoredSession(db, {
      hostId: "host:retained",
      hostname: "retained-host",
      project: "Shared project",
      runtimeId: "runtime:retained",
      runtimeKind: "retained-runtime",
      sessionId: "session:retained"
    });
    const shared = seedSharedAuthoredData(db);
    seedArtifactReferenceRun(db, {
      artifactId: shared.artifactId,
      claimId: "claim:bundle-contribution",
      referenceSource: "bundle",
      runId: "authoring:bundle-contribution",
      sessionId: "session:retained"
    });
    seedArtifactReferenceRun(db, {
      artifactId: shared.artifactId,
      claimId: "claim:receipt-contribution",
      referenceSource: "receipt",
      runId: "authoring:receipt-contribution",
      sessionId: "session:retained"
    });
    db.prepare(
      `UPDATE workbench_session_state
       SET runbook_status = 'published', bug_fix_trace_status = 'satisfied'
       WHERE session_id = ?`
    ).run("session:retained");
    db.prepare(
      `INSERT INTO workbench_activity (
        activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "activity:artifact-only",
      "session:retained",
      "runbook_published",
      "2026-06-25T12:00:00.000Z",
      "agent",
      "codex",
      "Published shared artifact",
      JSON.stringify({ artifactId: shared.artifactId, artifactKind: "runbook" })
    );

    deleteMastheadData(db, { kind: "session", sessionId: "session:target" });

    expect(ids(db, "session_artifacts", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "session_artifact_search", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "session_artifact_provenance", "artifact_id")).toEqual([retained.artifactId]);
    expect(ids(db, "workbench_authoring_runs", "run_id")).toEqual(["authoring:session:retained"]);
    expect(ids(db, "workbench_authoring_run_sessions", "run_id")).toEqual(["authoring:session:retained"]);
    expect(ids(db, "workbench_runs", "run_id")).toEqual(["legacy:authoring:session:retained"]);
    expect(ids(db, "workbench_claims", "claim_id")).toEqual(["claim:session:retained"]);
    expect(ids(db, "workbench_activity", "activity_id")).toEqual(["activity:session:retained"]);
    expect(
      db.prepare("SELECT runbook_status AS runbookStatus FROM workbench_session_state WHERE session_id = ?").get(
        "session:retained"
      )
    ).toEqual({ runbookStatus: "applied" });
    db.close();
  });

  test("shared-artifact deletion preserves N/A and satisfaction from another current artifact", async () => {
    const db = await openTestDatabase();
    seedScopedAuthoredSession(db, {
      hostId: "host:target",
      hostname: "target-host",
      project: "Shared project",
      runtimeId: "runtime:target",
      runtimeKind: "target-runtime",
      sessionId: "session:target"
    });
    seedScopedAuthoredSession(db, {
      hostId: "host:supported",
      hostname: "supported-host",
      project: "Shared project",
      runtimeId: "runtime:supported",
      runtimeKind: "supported-runtime",
      sessionId: "session:supported"
    });
    seedScopedAuthoredSession(db, {
      hostId: "host:support-seed",
      hostname: "support-seed-host",
      project: "Shared project",
      runtimeId: "runtime:support-seed",
      runtimeKind: "support-seed-runtime",
      sessionId: "session:support-seed"
    });
    publishAutomaticArtifact(db, {
      artifactKind: "runbook",
      fingerprint: "runbook:deleted",
      provenanceSessionIds: ["session:target", "session:supported"],
      seedSessionId: "session:target"
    });
    publishAutomaticArtifact(db, {
      artifactKind: "adr",
      fingerprint: "adr:deleted",
      provenanceSessionIds: ["session:target", "session:supported"],
      seedSessionId: "session:target"
    });
    const supportingArtifactId = publishAutomaticArtifact(db, {
      artifactKind: "runbook",
      fingerprint: "runbook:supporting",
      provenanceSessionIds: ["session:support-seed", "session:supported"],
      seedSessionId: "session:support-seed"
    });
    db.prepare(
      `UPDATE workbench_session_state
       SET runbook_status = 'contributed', bug_fix_trace_status = 'satisfied', adr_status = 'not_applicable'
       WHERE session_id = ?`
    ).run("session:supported");

    deleteMastheadData(db, { kind: "session", sessionId: "session:target" });

    expect(ids(db, "session_artifacts", "artifact_id")).toContain(supportingArtifactId);
    expect(
      db.prepare(
        `SELECT runbook_status AS runbookStatus, adr_status AS adrStatus
         FROM workbench_session_state WHERE session_id = ?`
      ).get("session:supported")
    ).toEqual({ adrStatus: "not_applicable", runbookStatus: "contributed" });
    db.close();
  });

  test("project deletion handles more selected sessions than SQLite's parameter limit", async () => {
    const db = await openTestDatabase();
    const now = "2026-06-25T12:00:00.000Z";
    db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
      "host:bulk",
      "bulk-host",
      now,
      now
    );
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run("runtime:bulk", "bulk", "test", now, now);
    db.exec(
      `WITH RECURSIVE sequence(value) AS (
         VALUES(1)
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value < 33000
       )
       INSERT INTO sessions (
         session_id, host_id, runtime_id, source_session_id, project_label, lifecycle,
         last_activity_at, source_confidence, created_at, updated_at
       )
       SELECT
         printf('session:bulk:%05d', value),
         'host:bulk',
         'runtime:bulk',
         printf('source:bulk:%05d', value),
         'Bulk project',
         'ended',
         '${now}',
         'authoritative',
         '${now}',
         '${now}'
       FROM sequence`
    );

    expect(deleteMastheadData(db, { kind: "project", project: "Bulk project" }).sessions).toBe(33000);
    expect(count(db, "sessions")).toBe(0);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-data-lifecycle-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedCanonicalSessionGraph(db: MastheadDatabase): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("source:opencode", "opencode", "jsonl", "/tmp/rollout.jsonl", "authoritative", now, now);
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, source_path, payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("raw:1", "source:opencode", "rollout.jsonl:1", now, now, "jsonl", "/tmp/rollout.jsonl", "hash", "{}");
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "test-host",
    now,
    now
  );
  db.prepare(
    `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run("runtime:opencode", "opencode", "test", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, title, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session:1", "host:test", "runtime:opencode", "session-1", "Import Logbook", "ended", now, "authoritative", now, now);
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("message:1", "session:1", "user", "Build Logbook", "hash:message", now, "{}", "authoritative");
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("enrichment:1", "session:1", "session_capsule", "current", "fp", "v1", now, "{}", "[]");
  indexSessionSearch(db, searchDocument("session:1", "Import Logbook", "Build Logbook"));
  db.prepare(
    `INSERT INTO mcp_query_log (
      mcp_query_id, tool_name, requested_at, result_count, session_ids_json, status
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("mcp:1", "search_sessions", now, 1, "[\"session:1\"]", "succeeded");
  seedAuthoredData(db, {
    claimId: "claim:1",
    project: "Masthead",
    runId: "authoring:1",
    sessionId: "session:1"
  });
}

function seedAuthoredData(
  db: MastheadDatabase,
  input: { claimId: string; project: string; runId: string; sessionId: string }
): { artifactId: string } {
  const now = "2026-06-25T12:00:00.000Z";
  const artifact = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    confidence: "high",
    content: { outcome: "Authored artifact body" },
    contentFingerprint: `fingerprint:${input.sessionId}`,
    createdBy: "codex",
    evidenceRefs: [`message:${input.sessionId}`],
    highlight: "Authored artifact highlight",
    projectLabel: input.project,
    schemaVersion: "session-dossier-v1",
    sessionId: input.sessionId,
    summary: "Authored artifact summary",
    title: `Dossier ${input.sessionId}`,
    validation: { valid: true }
  });
  publishSessionArtifact(db, artifact.artifactId);
  db.prepare("INSERT INTO workbench_session_state (session_id) VALUES (?)").run(input.sessionId);
  db.prepare(
    `INSERT INTO workbench_claims (
      claim_id, session_id, claimed_by, claimed_at, heartbeat_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.claimId, input.sessionId, "codex", now, now, "2026-06-25T12:15:00.000Z");
  db.prepare(
    `INSERT INTO workbench_authoring_runs (
      run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
      receipt_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    "codex",
    getOrCreateDatabaseIdentity(db),
    "completed",
    `evidence:${input.sessionId}`,
    JSON.stringify({ sessionIds: [input.sessionId] }),
    JSON.stringify([{ code: "grounded", severity: "warning" }]),
    JSON.stringify({ publishedArtifactIds: [artifact.artifactId], runId: input.runId }),
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal)
     VALUES (?, ?, ?, ?)`
  ).run(input.runId, input.sessionId, input.claimId, 0);
  db.prepare(
    `INSERT INTO workbench_activity (
      activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary,
      details_json, related_run_id, related_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `activity:${input.sessionId}`,
    input.sessionId,
    "authoring_finished",
    now,
    "agent",
    "codex",
    "Published authored artifact",
    JSON.stringify({ artifactId: artifact.artifactId }),
    input.runId,
    input.claimId
  );
  db.prepare(
    `INSERT INTO workbench_runs (
      run_id, command, started_at, completed_at, status, session_id, artifact_id, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `legacy:${input.runId}`,
    "author",
    now,
    now,
    "succeeded",
    input.sessionId,
    artifact.artifactId,
    JSON.stringify({ runId: input.runId })
  );
  return { artifactId: artifact.artifactId };
}

function seedScopedAuthoredSession(
  db: MastheadDatabase,
  input: {
    hostId: string;
    hostname: string;
    project: string;
    runtimeId: string;
    runtimeKind: string;
    sessionId: string;
  }
): { artifactId: string } {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    input.hostId,
    input.hostname,
    now,
    now
  );
  db.prepare(
    `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.runtimeId, input.runtimeKind, "test", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.sessionId,
    input.hostId,
    input.runtimeId,
    `source:${input.sessionId}`,
    input.project,
    `Authored ${input.sessionId}`,
    "ended",
    now,
    "authoritative",
    now,
    now
  );
  indexSessionSearch(db, searchDocument(input.sessionId, `Authored ${input.sessionId}`, input.project));
  return seedAuthoredData(db, {
    claimId: `claim:${input.sessionId}`,
    project: input.project,
    runId: `authoring:${input.sessionId}`,
    sessionId: input.sessionId
  });
}

function searchDocument(sessionId: string, title: string, normalizedText: string) {
  return {
    capsule: "",
    commands: "",
    filePaths: "",
    finalResponse: "",
    firstPrompt: "",
    normalizedText,
    projectAliases: "",
    sessionId,
    tags: "",
    title,
    toolNames: ""
  };
}

function seedSharedAuthoredData(db: MastheadDatabase): { artifactId: string } {
  const now = "2026-06-25T12:00:00.000Z";
  const artifact = applySessionArtifact(db, {
    artifactKind: "runbook",
    confidence: "high",
    content: { rootCause: "Evidence spans both sessions" },
    contentFingerprint: "fingerprint:shared",
    createdBy: "codex",
    evidenceRefs: ["message:session:target", "message:session:retained"],
    highlight: "Shared authored artifact highlight",
    joinRationale: "Both sessions document the same repair.",
    projectLabel: "Shared project",
    provenanceSessionIds: ["session:target", "session:retained"],
    schemaVersion: "runbook-v1",
    sessionId: "session:retained",
    summary: "Shared authored artifact summary",
    title: "Shared runbook",
    validation: { valid: true }
  });
  publishSessionArtifact(db, artifact.artifactId);
  db.prepare(
    `INSERT INTO workbench_runs (
      run_id, command, started_at, completed_at, status, session_id, artifact_id, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "legacy:authoring:shared",
    "author",
    now,
    now,
    "succeeded",
    "session:retained",
    artifact.artifactId,
    JSON.stringify({ runId: "authoring:shared" })
  );

  const insertClaim = db.prepare(
    `INSERT INTO workbench_claims (
      claim_id, session_id, claimed_by, claimed_at, heartbeat_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertClaim.run("claim:shared:target", "session:target", "codex", now, now, "2026-06-25T12:15:00.000Z");
  insertClaim.run("claim:shared:retained", "session:retained", "codex", now, now, "2026-06-25T12:15:00.000Z");
  db.prepare(
    `INSERT INTO workbench_authoring_runs (
      run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
      receipt_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "authoring:shared",
    "codex",
    getOrCreateDatabaseIdentity(db),
    "completed",
    "evidence:shared",
    JSON.stringify({ sessionIds: ["session:target", "session:retained"] }),
    JSON.stringify([{ code: "shared_evidence", severity: "warning" }]),
    JSON.stringify({ publishedArtifactIds: [artifact.artifactId], runId: "authoring:shared" }),
    now,
    now,
    now
  );
  const insertRunSession = db.prepare(
    `INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal)
     VALUES (?, ?, ?, ?)`
  );
  insertRunSession.run("authoring:shared", "session:target", "claim:shared:target", 0);
  insertRunSession.run("authoring:shared", "session:retained", "claim:shared:retained", 1);
  const insertActivity = db.prepare(
    `INSERT INTO workbench_activity (
      activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary,
      details_json, related_run_id, related_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertActivity.run(
    "activity:shared:target",
    "session:target",
    "authoring_finished",
    now,
    "agent",
    "codex",
    "Published shared artifact",
    "{}",
    "authoring:shared",
    "claim:shared:target"
  );
  insertActivity.run(
    "activity:shared:retained",
    "session:retained",
    "authoring_finished",
    now,
    "agent",
    "codex",
    "Published shared artifact",
    "{}",
    "authoring:shared",
    "claim:shared:retained"
  );
  return { artifactId: artifact.artifactId };
}

function seedArtifactReferenceRun(
  db: MastheadDatabase,
  input: {
    artifactId: string;
    claimId: string;
    referenceSource: "bundle" | "receipt";
    runId: string;
    sessionId: string;
  }
): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT INTO workbench_claims (
      claim_id, session_id, claimed_by, claimed_at, heartbeat_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.claimId, input.sessionId, "codex", now, now, "2026-06-25T12:15:00.000Z");
  db.prepare(
    `INSERT INTO workbench_authoring_runs (
      run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
      receipt_json, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    "codex",
    getOrCreateDatabaseIdentity(db),
    "completed",
    "evidence:contribution",
    JSON.stringify(
      input.referenceSource === "bundle"
        ? { contributions: [{ kind: "runbook", publishedArtifactId: input.artifactId, sessionId: input.sessionId }] }
        : { contributions: [] }
    ),
    "[]",
    JSON.stringify(
      input.referenceSource === "receipt"
        ? {
            contributions: [{ artifactId: input.artifactId, kind: "runbook", sessionId: input.sessionId }],
            publishedArtifactIds: []
          }
        : { contributions: [], publishedArtifactIds: [] }
    ),
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal)
     VALUES (?, ?, ?, ?)`
  ).run(input.runId, input.sessionId, input.claimId, 0);
  db.prepare(
    `INSERT INTO workbench_activity (
      activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary,
      details_json, related_run_id, related_claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `activity:${input.referenceSource}-contribution`,
    input.sessionId,
    "authoring_finished",
    now,
    "agent",
    "codex",
    "Resolved contribution",
    JSON.stringify({ publishedArtifactIds: [] }),
    input.runId,
    input.claimId
  );
}

function publishAutomaticArtifact(
  db: MastheadDatabase,
  input: {
    artifactKind: "runbook" | "adr" | "incident_timeline";
    fingerprint: string;
    provenanceSessionIds: string[];
    seedSessionId: string;
  }
): string {
  const artifact = applySessionArtifact(db, {
    artifactKind: input.artifactKind,
    confidence: "high",
    content: { outcome: `Published ${input.artifactKind}` },
    contentFingerprint: input.fingerprint,
    createdBy: "codex",
    evidenceRefs: [`message:${input.seedSessionId}`],
    joinRationale: "The sessions contain evidence for the same reusable artifact.",
    projectLabel: "Shared project",
    provenanceSessionIds: input.provenanceSessionIds,
    schemaVersion: `${input.artifactKind}-v1`,
    sessionId: input.seedSessionId,
    summary: `Shared ${input.artifactKind}`,
    title: `Shared ${input.artifactKind}`,
    validation: { valid: true }
  });
  publishSessionArtifact(db, artifact.artifactId);
  return artifact.artifactId;
}

function count(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function ids(db: MastheadDatabase, table: string, column: string): string[] {
  return (db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).all() as Array<{ id: string }>).map(
    (row) => row.id
  );
}
