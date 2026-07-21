#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const PRODUCTION_PORT = 17_383;
const HEALTH_TIMEOUT_MS = 10_000;
const MEASURED_READS = 5;
const ENDPOINT_GATES = [
  { path: "/data/revisions", p95LimitMs: 50 },
  { path: "/logbook/artifacts?limit=50", p95LimitMs: 500 },
  { path: "/logbook/summary", p95LimitMs: 250 },
  { path: "/workbench/sessions?limit=100", p95LimitMs: 500 }
];

export async function allocateLoopbackPort(options = {}) {
  const createLoopbackServer = options.createServer ?? createServer;
  for (;;) {
    const server = createLoopbackServer();
    const port = await new Promise((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a loopback port."));
          return;
        }
        resolvePort(address.port);
      });
    });
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    if (port !== PRODUCTION_PORT) return port;
  }
}

export async function assertSafeDatabaseCopySource(sourcePath, options = {}) {
  const homeDir = resolve(options.homeDir || homedir());
  const productionDirectory = join(homeDir, ".config", "masthead-production");
  const requestedPath = resolve(sourcePath);
  if (isWithin(requestedPath, productionDirectory)) {
    throw new Error(`The authoring probe refuses the live production database: ${requestedPath}`);
  }
  const metadata = await lstat(requestedPath);
  if (metadata.isSymbolicLink()) throw new Error(`Database copy source must not be a symbolic link: ${requestedPath}`);
  if (!metadata.isFile()) throw new Error(`Database copy source must be a regular file: ${requestedPath}`);
  const canonicalPath = await realpath(requestedPath);
  if (isWithin(canonicalPath, productionDirectory)) {
    throw new Error(`The authoring probe refuses the live production database: ${canonicalPath}`);
  }
  return canonicalPath;
}

export function assertIsolatedProbeRuntime(input) {
  const productionDirectory = join(resolve(input.homeDir || homedir()), ".config", "masthead-production");
  const manifestPath = resolve(input.manifestPath);
  if (isWithin(manifestPath, productionDirectory)) {
    throw new Error(`The authoring probe refuses the live production manifest: ${manifestPath}`);
  }
  const normalizedBaseUrl = new URL(input.baseUrl).origin;
  if (input.liveProductionBaseUrl && normalizedBaseUrl === new URL(input.liveProductionBaseUrl).origin) {
    throw new Error(`The authoring probe refuses the live production base URL: ${normalizedBaseUrl}`);
  }
  if (new URL(normalizedBaseUrl).hostname !== "127.0.0.1") {
    throw new Error("The authoring probe requires a 127.0.0.1 loopback base URL.");
  }
}

export async function runAuthoringPerfProbe(input, dependencyOverrides = {}) {
  assertProbeInput(input);
  const createWorkspace = dependencyOverrides.createWorkspace ?? (() => mkdtemp(join(tmpdir(), "masthead-authoring-perf-")));
  const allocatePort = dependencyOverrides.allocatePort ?? allocateLoopbackPort;
  const prepareFixtureDatabase = dependencyOverrides.prepareFixtureDatabase ?? seedFixtureDatabase;
  const spawnDaemon = dependencyOverrides.spawnDaemon ?? spawnProbeDaemon;
  const probe = dependencyOverrides.probe ?? probeEndpoint;
  const terminate = dependencyOverrides.terminateChild ?? terminateChild;
  const waitForHealth = dependencyOverrides.waitForHealth ?? waitForDaemonHealth;
  const workspace = await createWorkspace();
  let child;
  let primaryError;
  try {
    const dataDirectory = join(workspace, "data");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const instanceDirectory = join(workspace, "instance");
    const manifestPath = join(instanceDirectory, "masthead-instance.json");
    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    assertIsolatedProbeRuntime({ baseUrl, manifestPath });
    await Promise.all([
      mkdir(dataDirectory, { recursive: true }),
      mkdir(instanceDirectory, { recursive: true }),
      mkdir(join(workspace, "codex-home"), { recursive: true })
    ]);
    await writeFile(manifestPath, `${JSON.stringify({ temporary: true, baseUrl })}\n`, { mode: 0o600 });

    if (input.dbCopy) {
      const sourcePath = await assertSafeDatabaseCopySource(input.dbCopy);
      await copyFile(sourcePath, databasePath);
      await migrateWorkingDatabase(databasePath);
    } else {
      await prepareFixtureDatabase(databasePath, input.fixtureSessions);
    }

    child = spawnDaemon({ baseUrl, databasePath, dataDirectory, instanceDirectory, manifestPath, port, workspace });
    const healthReadyMs = await waitForHealth(baseUrl, child, HEALTH_TIMEOUT_MS);
    if (healthReadyMs > HEALTH_TIMEOUT_MS) {
      throw new Error(`daemon health ready ${healthReadyMs.toFixed(1)} ms exceeds ${HEALTH_TIMEOUT_MS} ms`);
    }

    const endpoints = {};
    for (const gate of ENDPOINT_GATES) {
      await probe(baseUrl, gate.path, gate.p95LimitMs);
      const samples = [];
      for (let read = 0; read < MEASURED_READS; read += 1) {
        samples.push(await probe(baseUrl, gate.path, gate.p95LimitMs));
      }
      const p95Ms = percentile95(samples);
      if (p95Ms > gate.p95LimitMs) {
        throw new Error(`${gate.path} p95 ${p95Ms.toFixed(1)} ms exceeds ${gate.p95LimitMs} ms`);
      }
      endpoints[gate.path] = { p95Ms, samplesMs: samples };
    }
    return { baseUrl, healthReadyMs, endpoints };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const teardownErrors = [];
    try {
      await terminate(child);
    } catch (error) {
      teardownErrors.push(error);
    }
    try {
      await rm(workspace, { force: true, recursive: true });
    } catch (error) {
      teardownErrors.push(error);
    }
    if (teardownErrors.length === 1 && primaryError === undefined) throw teardownErrors[0];
    if (teardownErrors.length > 0) {
      throw new AggregateError(
        primaryError === undefined ? teardownErrors : [primaryError, ...teardownErrors],
        "The authoring performance probe failed and could not complete teardown."
      );
    }
  }
}

export function percentile95(samples) {
  if (samples.length === 0) throw new Error("Cannot compute p95 without samples.");
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

async function seedFixtureDatabase(databasePath, fixtureSessions) {
  const { openMastheadDatabase } = await importBuiltModule("src/daemon/db/sqlite.js");
  const { migrateDatabase } = await importBuiltModule("src/daemon/db/schema.js");
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    seedFixtureData(db, fixtureSessions);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
  } finally {
    db.close();
  }
}

export function seedFixtureData(db, fixtureSessions) {
  const firstTimestamp = fixtureTimestamp(0, fixtureSessions, 0);
  const lastTimestamp = fixtureTimestamp(fixtureSessions - 1, fixtureSessions, 10 * 60_000);
  db.prepare("INSERT INTO hosts(host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)")
    .run("host:probe", "probe", firstTimestamp, lastTimestamp);
  db.prepare("INSERT INTO runtimes(runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .run("runtime:probe", "codex", "probe", firstTimestamp, lastTimestamp);
  const insertSession = db.prepare(
    `INSERT INTO sessions(
      session_id, host_id, runtime_id, source_session_id, project_label, title, objective, lifecycle,
      started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
    ) VALUES (?, 'host:probe', 'runtime:probe', ?, ?, ?, ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`
  );
  const insertWorkbench = db.prepare(
    `INSERT INTO workbench_session_state(
      session_id, publication_status, next_action, transcript_status, quality_status,
      session_enrichment_status, session_dossier_status, bug_fix_trace_status,
      published_at, last_activity_at, created_at, updated_at
    ) VALUES (?, 'published', 'none', 'imported', 'passed', 'satisfied', 'satisfied', 'not_applicable', ?, ?, ?, ?)`
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages(
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'authoritative')`
  );
  const insertToolCall = db.prepare(
    `INSERT INTO tool_calls(
      tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertToolResult = db.prepare(
    `INSERT INTO tool_results(
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code,
      completed_at, source_ref_json
    ) VALUES (?, ?, ?, 'succeeded', ?, ?, 0, ?, ?)`
  );
  const insertFileEffect = db.prepare(
    `INSERT INTO file_effects(
      file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json
    ) VALUES (?, ?, ?, 'modified', 0, ?, ?, ?, ?)`
  );
  const insertModelUsage = db.prepare(
    `INSERT INTO model_usage(
      usage_id, session_id, model, provider, input_tokens, output_tokens, total_tokens, cost_micros,
      observed_at, source_ref_json
    ) VALUES (?, ?, ?, 'openai', ?, ?, ?, ?, ?, ?)`
  );
  const insertActivity = db.prepare(
    `INSERT INTO workbench_activity(
      activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary, details_json
    ) VALUES (?, ?, ?, ?, 'system', 'authoring-perf-probe', ?, ?)`
  );
  const insertArtifact = db.prepare(
    `INSERT INTO session_artifacts(
      artifact_id, session_id, artifact_kind, status, publication_status, content_fingerprint,
      created_at, updated_at, created_by, schema_version, title, summary, project_label,
      published_at, lineage_id, content_json, evidence_refs_json, validation_json
    ) VALUES (?, ?, ?, 'current', 'published', ?, ?, ?, 'authoring-perf-probe', ?, ?, ?, ?, ?, ?, ?, ?, '{"valid":true}')`
  );
  const insertProvenance = db.prepare(
    "INSERT INTO session_artifact_provenance(artifact_id, session_id) VALUES (?, ?)"
  );

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (let index = 0; index < fixtureSessions; index += 1) {
      const paddedIndex = String(index).padStart(6, "0");
      const sessionId = `session:probe:${paddedIndex}`;
      const project = `Probe project ${index % 25}`;
      const sessionTitle = `Historical authoring session ${index}`;
      const startedAt = fixtureTimestamp(index, fixtureSessions, 0);
      const userAt = fixtureTimestamp(index, fixtureSessions, 60_000);
      const toolAt = fixtureTimestamp(index, fixtureSessions, 2 * 60_000);
      const fileAt = fixtureTimestamp(index, fixtureSessions, 3 * 60_000);
      const assistantAt = fixtureTimestamp(index, fixtureSessions, 5 * 60_000);
      const publishedAt = fixtureTimestamp(index, fixtureSessions, 10 * 60_000);
      const sourceRef = JSON.stringify({ fixture: "authoring-perf", session: sessionId });
      const inputTokens = 1_200 + (index % 4_000);
      const outputTokens = 300 + (index % 1_000);

      insertSession.run(
        sessionId,
        `source:${index}`,
        project,
        sessionTitle,
        `Complete historical maintenance task ${index}`,
        startedAt,
        publishedAt,
        publishedAt,
        startedAt,
        publishedAt
      );
      insertWorkbench.run(sessionId, publishedAt, publishedAt, startedAt, publishedAt);
      insertMessage.run(
        `${sessionId}:message:user`,
        sessionId,
        "user",
        `Investigate regression ${index} and preserve the verified behavior.`,
        `${sessionId}:message:user:hash`,
        userAt,
        sourceRef
      );
      insertMessage.run(
        `${sessionId}:message:assistant`,
        sessionId,
        "assistant",
        `Verified regression ${index}, updated the implementation, and ran focused tests.`,
        `${sessionId}:message:assistant:hash`,
        assistantAt,
        sourceRef
      );
      insertToolCall.run(
        `${sessionId}:tool`,
        sessionId,
        index % 2 === 0 ? "exec_command" : "apply_patch",
        JSON.stringify({ command: "focused verification", index }),
        toolAt,
        sourceRef
      );
      insertToolResult.run(
        `${sessionId}:tool-result`,
        `${sessionId}:tool`,
        sessionId,
        `Verification passed for fixture session ${index}.`,
        `${sessionId}:tool-result:hash`,
        assistantAt,
        sourceRef
      );
      insertFileEffect.run(
        `${sessionId}:file`,
        sessionId,
        `src/fixture/module-${index % 500}.ts`,
        5 + (index % 60),
        index % 12,
        fileAt,
        sourceRef
      );
      insertModelUsage.run(
        `${sessionId}:usage`,
        sessionId,
        index % 3 === 0 ? "gpt-5.2-codex" : "gpt-5",
        inputTokens,
        outputTokens,
        inputTokens + outputTokens,
        1_000 + (index % 25_000),
        assistantAt,
        sourceRef
      );
      insertActivity.run(
        `${sessionId}:activity:imported`,
        sessionId,
        "transcript_imported",
        assistantAt,
        "Imported two historical transcript messages.",
        JSON.stringify({ messageCount: 2 })
      );
      insertActivity.run(
        `${sessionId}:activity:published`,
        sessionId,
        "artifact_published",
        publishedAt,
        "Published the current artifact set.",
        JSON.stringify({ project })
      );

      const kinds = ["session_dossier"];
      if (index % 2 === 0) kinds.push("runbook");
      if (index % 5 === 0) kinds.push("adr");
      if (index % 10 === 0) kinds.push("incident_timeline");
      for (const kind of kinds) {
        const artifactId = `artifact:probe:${paddedIndex}:${kind}`;
        const title = `${kind.replaceAll("_", " ")} for ${sessionTitle}`;
        const evidenceRefs = JSON.stringify([
          `${sessionId}:message:user`,
          `${sessionId}:message:assistant`,
          `${sessionId}:tool`,
          `${sessionId}:file`
        ]);
        insertArtifact.run(
          artifactId,
          sessionId,
          kind,
          `fingerprint:${index}:${kind}`,
          assistantAt,
          publishedAt,
          `${kind}-v1`,
          title,
          `Evidence-backed ${kind.replaceAll("_", " ")} from historical session ${index}.`,
          project,
          publishedAt,
          artifactId,
          JSON.stringify({ evidenceCount: 4, index, project, title }),
          evidenceRefs
        );
        insertProvenance.run(artifactId, sessionId);
      }
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function fixtureTimestamp(index, fixtureSessions, offsetMs) {
  const historyStartMs = Date.parse("2024-01-01T08:00:00.000Z");
  const historySpanMs = 540 * 24 * 60 * 60 * 1_000;
  const position = fixtureSessions <= 1 ? 0 : index / (fixtureSessions - 1);
  return new Date(historyStartMs + Math.round(historySpanMs * position) + offsetMs).toISOString();
}

async function migrateWorkingDatabase(databasePath) {
  const { openMastheadDatabase } = await importBuiltModule("src/daemon/db/sqlite.js");
  const { migrateDatabase } = await importBuiltModule("src/daemon/db/schema.js");
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
  } finally {
    db.close();
  }
}

async function importBuiltModule(relativePath) {
  const path = resolve("dist/daemon", relativePath);
  return import(pathToFileURL(path).href);
}

function spawnProbeDaemon(input) {
  return spawn(process.execPath, [resolve("dist/daemon/src/daemon/main.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MASTHEAD_ALLOWED_ORIGINS: "masthead://app",
      MASTHEAD_BACKGROUND_HYDRATION: "0",
      MASTHEAD_CLI_COMMAND: join(input.instanceDirectory, "bin", "mastheadctl"),
      MASTHEAD_CODEX_HOME: join(input.workspace, "codex-home"),
      MASTHEAD_DATA_DIR: input.dataDirectory,
      MASTHEAD_DB_PATH: input.databasePath,
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_INSTANCE_DIR: input.instanceDirectory,
      MASTHEAD_INSTANCE_MANIFEST: input.manifestPath,
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_PORT: String(input.port),
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
      MASTHEAD_STORE_PATH: join(input.dataDirectory, "legacy", "events.ndjson")
    },
    stdio: ["ignore", "inherit", "inherit"]
  });
}

export async function waitForDaemonHealth(baseUrl, child, timeoutMs, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = performance.now();
  for (;;) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Masthead probe daemon exited before health was ready (${child.exitCode}).`);
    }
    const remainingMs = timeoutMs - (performance.now() - startedAt);
    if (remainingMs <= 0) throw new Error(`daemon health ready exceeded ${timeoutMs} ms`);
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)))
      });
      if (response.ok) {
        await response.arrayBuffer();
        return performance.now() - startedAt;
      }
    } catch {
      // Binding and migration are bounded by the health deadline below.
    }
    if (performance.now() - startedAt > timeoutMs) throw new Error(`daemon health ready exceeded ${timeoutMs} ms`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

export async function probeEndpoint(baseUrl, path, timeoutMs, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = performance.now();
  const response = await fetchImpl(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  await response.arrayBuffer();
  const durationMs = performance.now() - startedAt;
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
  return durationMs;
}

export async function terminateChild(child, options = {}) {
  if (!child || childHasExited(child)) return;
  const termTimeoutMs = options.termTimeoutMs ?? 2_000;
  const killTimeoutMs = options.killTimeoutMs ?? 2_000;
  if (await signalAndWaitForExit(child, "SIGTERM", termTimeoutMs)) return;
  if (childHasExited(child)) return;
  if (await signalAndWaitForExit(child, "SIGKILL", killTimeoutMs)) return;
  if (!childHasExited(child)) throw new Error("Masthead probe daemon did not exit after SIGKILL.");
}

function signalAndWaitForExit(child, signal, timeoutMs) {
  if (typeof child.once !== "function") {
    child.kill(signal);
    if (childHasExited(child)) return Promise.resolve(true);
    return Promise.reject(new Error(`Cannot verify Masthead probe daemon exit after ${signal}.`));
  }
  return new Promise((resolveExit, reject) => {
    let timeout;
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
    timeout = setTimeout(() => {
      child.off?.("exit", onExit);
      resolveExit(childHasExited(child));
    }, timeoutMs);
    try {
      child.kill(signal);
    } catch (error) {
      clearTimeout(timeout);
      child.off?.("exit", onExit);
      reject(error);
    }
  });
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null && child.signalCode !== undefined;
}

function assertProbeInput(input) {
  const hasCopy = typeof input?.dbCopy === "string" && input.dbCopy.length > 0;
  const hasFixture = Number.isInteger(input?.fixtureSessions) && input.fixtureSessions > 0;
  if (hasCopy === hasFixture) throw new Error("Specify exactly one of --db-copy or --fixture-sessions.");
}

function isWithin(candidate, directory) {
  const pathFromDirectory = relative(resolve(directory), resolve(candidate));
  return pathFromDirectory === "" || (!pathFromDirectory.startsWith("..") && !pathFromDirectory.startsWith("/"));
}

function parseArguments(argv) {
  const input = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--db-copy") input.dbCopy = argv[++index];
    else if (argument === "--fixture-sessions") input.fixtureSessions = Number.parseInt(argv[++index] ?? "", 10);
    else throw new Error(`Unknown authoring probe argument: ${argument}`);
  }
  assertProbeInput(input);
  return input;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = await runAuthoringPerfProbe(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
