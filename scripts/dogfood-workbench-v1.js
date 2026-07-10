#!/usr/bin/env node
/**
 * Prove the daemon-owned Workbench authoring loop against a temporary database.
 * The built thin CLI is the only authoring client; no command opens SQLite.
 */
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const cliPath = resolve(repoRoot, "dist/daemon/src/cli/mastheadctl.js");
const mcpPath = resolve(repoRoot, "dist/daemon/src/mcp/server.js");
const installedCliPath = join(homedir(), ".local", "bin", process.platform === "win32" ? "mastheadctl.cmd" : "mastheadctl");
const EVIDENCE_ITEMS = 500;
const LATE_OUTCOME_INDEX = 497;
const BODY_ONLY_PHRASE = "lantern-quartz authoring body sentinel";

for (const required of [cliPath, mcpPath]) {
  if (!existsSync(required)) {
    console.error(`Missing built module ${required}. Run npm run build:daemon first.`);
    process.exit(1);
  }
}

const { createMastheadDaemon } = await import("../dist/daemon/src/daemon/server.js");

const tempDir = await mkdtemp(join(tmpdir(), "masthead-authoring-dogfood-"));
let daemon;
const previousCliCommand = process.env.MASTHEAD_CLI_COMMAND;

try {
  const databasePath = join(tempDir, "masthead.sqlite");
  const bundlePath = join(tempDir, "bundle.json");
  const sessionId = "session:authoring-dogfood";
  process.env.MASTHEAD_CLI_COMMAND = installedCliPath;
  daemon = await createMastheadDaemon(daemonConfig(databasePath));
  const baseUrl = await listen(daemon);
  seedLongSession(daemon.database, sessionId);

  const capabilities = await cli(baseUrl, ["workbench", "capabilities", "--json"]);
  assert(capabilities.ok === true, "capabilities command did not succeed");
  assert(capabilities.capability === "artifact_authoring", "daemon did not advertise artifact_authoring");
  assert(capabilities.command === installedCliPath, "daemon did not report the installed CLI launcher");
  assert(Array.isArray(capabilities.operations) && capabilities.operations.join(",") === "open,status,evidence,submit,finish", "authoring operations are incomplete");

  const opened = await cli(baseUrl, [
    "workbench",
    "open",
    "--database-id",
    capabilities.databaseId,
    "--session",
    sessionId,
    "--json"
  ]);
  const runId = opened.run?.runId;
  assert(opened.ok === true && typeof runId === "string", "authoring open did not return a run");
  assert(opened.run.databaseId === capabilities.databaseId, "open reached a different database identity");
  assert(opened.evidence?.sessions?.[0]?.totalItems === EVIDENCE_ITEMS, `expected ${EVIDENCE_ITEMS} manifest items`);

  const ascending = await readAllEvidence(baseUrl, { order: "asc", runId, sessionId });
  const descending = await readAllEvidence(baseUrl, { order: "desc", runId, sessionId });
  const ascendingIds = new Set(ascending.map((item) => item.itemId));
  const descendingIds = new Set(descending.map((item) => item.itemId));
  assert(ascending.length === EVIDENCE_ITEMS && ascendingIds.size === EVIDENCE_ITEMS, "ascending evidence pagination lost or duplicated items");
  assert(descending.length === EVIDENCE_ITEMS && descendingIds.size === EVIDENCE_ITEMS, "descending evidence pagination lost or duplicated items");
  assert([...ascendingIds].every((itemId) => descendingIds.has(itemId)), "ascending and descending evidence catalogs differ");

  const lateOutcome = ascending.find((item) => item.text.includes("Decisive outcome:"));
  const lateVerification = ascending.find((item) => item.text.includes("Decisive verification:"));
  assert(lateOutcome && ascending.indexOf(lateOutcome) >= 480, "decisive outcome was not observed after item 480");
  assert(lateVerification && ascending.indexOf(lateVerification) >= 480, "decisive verification was not observed after item 480");

  const bundle = authoringBundle({
    evidenceRevision: opened.run.evidenceRevision,
    outcomeRef: lateOutcome.itemId,
    runId,
    sessionId,
    verificationRef: lateVerification.itemId
  });
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  const artifactsBeforeSubmit = countRows(daemon.database, "session_artifacts");
  const enrichmentsBeforeSubmit = countRows(daemon.database, "session_enrichments");
  const submission = await cli(baseUrl, ["workbench", "submit", "--run", runId, "--file", bundlePath, "--json"]);
  assert(submission.ok === true && submission.accepted === true, `authoring submission was rejected: ${JSON.stringify(submission.findings)}`);
  const artifactsBeforeFinish = countRows(daemon.database, "session_artifacts");
  assert(artifactsBeforeFinish === artifactsBeforeSubmit, "submit created artifact rows");
  assert(countRows(daemon.database, "session_enrichments") === enrichmentsBeforeSubmit, "submit created enrichment rows");

  const finished = await cli(baseUrl, ["workbench", "finish", "--run", runId, "--json"]);
  const retried = await cli(baseUrl, ["workbench", "finish", "--run", runId, "--json"]);
  assert(finished.ok === true && finished.receipt, "authoring finish did not return a receipt");
  assert(JSON.stringify(retried.receipt) === JSON.stringify(finished.receipt), "finish retry returned a different receipt");
  assert(finished.receipt.publishedArtifactIds.length === 2, "finish did not publish dossier and runbook");
  assert(finished.receipt.resolvedSessionIds.length === 1, "finish did not resolve the selected session");

  const details = await Promise.all(
    finished.receipt.publishedArtifactIds.map((artifactId) =>
      getJson(baseUrl, `/logbook/artifacts/${encodeURIComponent(artifactId)}`)
    )
  );
  const kinds = new Map(details.map((detail) => [detail.artifact?.capsule?.kind, detail.artifact]));
  assert(kinds.has("session_dossier") && kinds.has("runbook"), "published receipt omitted dossier or runbook detail");
  assert(details.every((detail) => detail.artifact?.publicationStatus === "published"), "receipt includes an unpublished artifact");
  assert(details.every((detail) => detail.artifact?.provenanceSessionIds?.includes(sessionId)), "receipt artifact lost session provenance");

  const bodySearch = await getJson(baseUrl, `/logbook/artifacts?q=${encodeURIComponent(BODY_ONLY_PHRASE)}&limit=10`);
  const runbook = kinds.get("runbook");
  const logbookBodySearch = bodySearch.artifacts?.some((artifact) => artifact.artifactId === runbook?.capsule?.artifactId) === true;
  assert(logbookBodySearch, "Logbook did not find the runbook by a body-only phrase");

  const mcp = verifyArtifactThroughMcp(databasePath, runbook.capsule.artifactId);
  assert(mcp.ok, `artifact-primary MCP reuse failed: ${mcp.error ?? "unknown error"}`);

  const receipt = {
    ok: true,
    databaseIdentityMatched: opened.run.databaseId === capabilities.databaseId,
    evidence: {
      totalItems: EVIDENCE_ITEMS,
      uniqueItemsRead: ascendingIds.size,
      lateOutcomeObserved: Boolean(lateOutcome && lateVerification)
    },
    submission: {
      accepted: submission.accepted,
      artifactsBeforeFinish
    },
    finish: {
      publishedArtifacts: finished.receipt.publishedArtifactIds.length,
      resolvedSessions: finished.receipt.resolvedSessionIds.length,
      runbook: "published",
      adr: resolutionStatus(finished.receipt, sessionId, "adr"),
      incidentTimeline: resolutionStatus(finished.receipt, sessionId, "incident_timeline"),
      idempotentRetry: JSON.stringify(retried.receipt) === JSON.stringify(finished.receipt)
    },
    reuse: {
      logbookBodySearch,
      mcpArtifactRead: mcp.artifactRead
    },
    runId,
    receipt: finished.receipt
  };
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  if (daemon) await daemon.close();
  if (previousCliCommand === undefined) delete process.env.MASTHEAD_CLI_COMMAND;
  else process.env.MASTHEAD_CLI_COMMAND = previousCliCommand;
  if (!process.env.MASTHEAD_KEEP_DOGFOOD_DB) await rm(tempDir, { force: true, recursive: true });
}

function daemonConfig(databasePath) {
  return {
    allowedOrigins: ["http://127.0.0.1:5180"],
    codexHomeDir: join(tempDir, "codex-home"),
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "legacy", "events.ndjson")
  };
}

function listen(instance) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    instance.server.once("error", onError);
    instance.server.listen(0, "127.0.0.1", () => {
      instance.server.off("error", onError);
      const address = instance.server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function cli(baseUrl, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MASTHEAD_ACTOR_ID: "dogfood-authoring-agent",
      MASTHEAD_DAEMON_URL: baseUrl
    },
    maxBuffer: 10 * 1024 * 1024
  });
  if (stderr.trim()) throw new Error(stderr.trim());
  return JSON.parse(stdout);
}

async function readAllEvidence(baseUrl, { order, runId, sessionId }) {
  const items = [];
  let cursor;
  do {
    const args = [
      "workbench",
      "evidence",
      "--run",
      runId,
      "--session",
      sessionId,
      "--limit",
      "137",
      "--order",
      order,
      "--json"
    ];
    if (cursor) args.splice(args.length - 1, 0, "--cursor", cursor);
    const page = await cli(baseUrl, args);
    assert(page.ok === true && page.total === EVIDENCE_ITEMS, `${order} evidence page reported the wrong total`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function verifyArtifactThroughMcp(databasePath, artifactId) {
  try {
    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_artifacts", arguments: { query: BODY_ONLY_PHRASE, limit: 5 } }
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_artifact", arguments: { artifactId } }
      }
    ];
    const child = spawnSync(process.execPath, [mcpPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
      maxBuffer: 10 * 1024 * 1024
    });
    if (child.status !== 0) throw new Error(child.stderr || `MCP exited ${child.status}`);
    const replies = child.stdout.trim().split(/\n/).map((line) => JSON.parse(line));
    const search = JSON.parse(replies.find((reply) => reply.id === 1)?.result?.content?.[0]?.text ?? "{}");
    const detail = JSON.parse(replies.find((reply) => reply.id === 2)?.result?.content?.[0]?.text ?? "{}");
    const artifactRead = detail.artifact?.capsule?.artifactId === artifactId;
    return {
      artifactRead,
      ok: search.artifacts?.some((artifact) => artifact.artifactId === artifactId) === true && artifactRead
    };
  } catch (error) {
    return {
      artifactRead: false,
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

function seedLongSession(db, sessionId) {
  const baseTime = Date.parse("2026-07-10T12:00:00.000Z");
  const observedAt = (offset) => new Date(baseTime + offset * 1_000).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
      "host:authoring-dogfood",
      "authoring-dogfood-host",
      observedAt(0),
      observedAt(500)
    );
    db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
      "runtime:authoring-dogfood",
      "codex",
      "dogfood",
      observedAt(0),
      observedAt(500)
    );
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, project_label, repo_root, worktree_path,
        branch, title, objective, lifecycle, outcome_label, started_at, last_activity_at, ended_at,
        source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      "host:authoring-dogfood",
      "runtime:authoring-dogfood",
      "source-authoring-dogfood",
      "Masthead",
      repoRoot,
      repoRoot,
      "main",
      "Long daemon-owned authoring dogfood",
      "Prove complete redacted evidence authoring through publication and reuse",
      "ended",
      "completed",
      observedAt(0),
      observedAt(500),
      observedAt(500),
      "authoritative",
      observedAt(0),
      observedAt(500)
    );

    const insertMessage = db.prepare(
      `INSERT INTO messages (
        message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (let index = 1; index <= 498; index += 1) {
      const ordinal = String(index).padStart(4, "0");
      const role = index % 2 === 0 ? "assistant" : "user";
      const text = index === LATE_OUTCOME_INDEX
        ? "Decisive outcome: daemon-owned authoring published a grounded dossier and reusable runbook."
        : `Canonical redacted evidence item ${ordinal} records substantive Workbench authoring context.`;
      insertMessage.run(
        `${sessionId}:message-${ordinal}`,
        sessionId,
        role,
        text,
        `${sessionId}:message-${ordinal}-hash`,
        observedAt(index),
        JSON.stringify({ source: "authoring-dogfood", ordinal: index }),
        "authoritative"
      );
    }
    db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
      `${sessionId}:tool-call`,
      sessionId,
      "npm test -- --run authoring",
      observedAt(499),
      JSON.stringify({ source: "authoring-dogfood", ordinal: 499 })
    );
    db.prepare(
      `INSERT INTO tool_results (
        tool_result_id, tool_call_id, session_id, status, exit_code, completed_at, output_redacted, source_ref_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `${sessionId}:tool-result`,
      `${sessionId}:tool-call`,
      sessionId,
      "succeeded",
      0,
      observedAt(500),
      "Decisive verification: focused authoring, Logbook search, and MCP reuse checks passed.",
      JSON.stringify({ source: "authoring-dogfood", ordinal: 500 })
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function authoringBundle({ evidenceRevision, outcomeRef, runId, sessionId, verificationRef }) {
  const evidenceRefs = [outcomeRef, verificationRef];
  return {
    bundleVersion: "workbench-authoring-v1",
    runId,
    evidenceRevision,
    sessionPackages: [
      {
        sessionId,
        enrichment: {
          claimEvidence: [{ path: "outcome", evidenceRefs }],
          confidence: "high",
          evidenceRefs,
          missingEvidence: [],
          outcome: "A daemon-owned authoring run published grounded artifacts and exposed them through Logbook and MCP.",
          searchPhrases: ["daemon-owned artifact authoring", "complete redacted evidence"],
          summary: "The long-session dogfood read every canonical redacted item before submitting and atomically publishing a grounded artifact bundle.",
          technologies: ["TypeScript", "SQLite", "HTTP"],
          title: "Prove complete daemon-owned authoring",
          topics: ["Workbench", "Logbook", "artifact authoring"],
          verificationSummary: "Focused authoring, Logbook body search, and artifact-primary MCP reuse passed."
        },
        dossier: {
          approach: ["Opened the selected session against the capabilities-reported database identity", "Read all 500 canonical evidence items in both orders", "Submitted and finished one grounded bundle"],
          claimEvidence: [
            { path: "keyDecisions[0]", evidenceRefs: [outcomeRef] },
            { path: "outcome", evidenceRefs },
            { path: "verification[0]", evidenceRefs: [verificationRef] }
          ],
          commandsAndTools: [{ label: "mastheadctl workbench", purpose: "Use the daemon-owned authoring transport", status: "passed" }],
          confidence: "high",
          context: "A 500-item canonical redacted session exercised evidence beyond the first 480 items.",
          evidenceRefs,
          filesTouched: [{ label: "scripts/dogfood-workbench-v1.js", role: "end-to-end acceptance dogfood" }],
          keyDecisions: ["Keep claims grounded in late canonical evidence rather than a bounded transcript preview."],
          lessonsLearned: ["An evidence manifest plus complete cursor pagination makes long-session grounding verifiable."],
          missingEvidence: [],
          outcome: "The daemon accepted a non-mutating submission, atomically published a dossier and runbook, and returned an idempotent completion receipt.",
          problemStatement: "Prove that normal agents can create excellent artifacts without direct SQLite access or truncated evidence.",
          risksOrGaps: ["Artifact correction tools remain future scope."],
          title: "Daemon-owned authoring acceptance dossier",
          verification: ["The late passed tool result proves Logbook body search and MCP artifact reuse."]
        }
      }
    ],
    artifacts: [
      {
        kind: "runbook",
        seedSessionId: sessionId,
        provenanceSessionIds: [sessionId],
        output: {
          changedFiles: ["scripts/dogfood-workbench-v1.js"],
          claimEvidence: [
            { path: "fixSteps[0]", evidenceRefs: [outcomeRef] },
            { path: "rootCause", evidenceRefs: [outcomeRef] },
            { path: "validationChecks[0]", evidenceRefs: [verificationRef] }
          ],
          commands: ["npm run build:daemon", "node scripts/dogfood-workbench-v1.js"],
          confidence: "high",
          deadEnds: ["Reading only an initial transcript preview cannot ground late-session outcomes."],
          environmentRequirements: ["A compatible Masthead daemon and its capabilities-reported database identity"],
          evidenceRefs,
          fixSteps: ["Read every cursor page of canonical redacted evidence before authoring the bundle."],
          missingEvidence: [],
          preconditions: ["The selected session is on the Workbench publish path."],
          preventionNotes: [`Preserve the ${BODY_ONLY_PHRASE} so full-body search remains covered.`],
          problemSignature: {
            affectedScope: "Long Workbench authoring sessions",
            errorStrings: ["evidence_revision_changed"],
            symptoms: ["Important outcomes after early transcript pages are omitted from artifacts"]
          },
          provenanceSessionIds: [sessionId],
          reproSteps: ["Seed 500 canonical items with the decisive outcome after item 480."],
          risksOrGaps: ["Correction tools are intentionally outside this acceptance slice."],
          rootCause: "Bounded evidence previews prevent agents from grounding artifacts in decisive late-session evidence.",
          signatureKey: "daemon-owned-long-session-authoring",
          title: "Author from complete canonical evidence",
          validationChecks: ["A passed late tool result verifies atomic finish, body search, and MCP reuse."]
        }
      }
    ],
    notApplicable: [
      {
        sessionId,
        kind: "adr",
        reason: "The reviewed evidence proves a delivery workflow and does not record a durable architecture choice.",
        evidenceRefs: [outcomeRef]
      },
      {
        sessionId,
        kind: "incident_timeline",
        reason: "The reviewed evidence contains no production incident, customer impact, or recovery timeline.",
        evidenceRefs: [outcomeRef]
      }
    ],
    contributions: []
  };
}

function resolutionStatus(receipt, sessionId, kind) {
  return receipt.notApplicable.some((decision) => decision.sessionId === sessionId && decision.kind === kind)
    ? "not_applicable"
    : "missing";
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
