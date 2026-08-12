#!/usr/bin/env node

/**
 * Local-first failure smoke for Masthead Pages.
 * Proves the local daemon/Logbook stay usable when hosted publication cannot run.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const tempDirs = [];

try {
  const { createMastheadDaemon } = await import(pathToFileURL(join(root, "dist/daemon/src/daemon/server.js")).href);

  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-offline-"));
  tempDirs.push(tempDir);

  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson"),
  });

  try {
    const baseUrl = await listen(daemon);

    const health = await getJson(`${baseUrl}/health`);
    assert(health.ok === true, "health failed offline");

    const logbook = await getJson(`${baseUrl}/logbook/artifacts`);
    assert(logbook.ok === true, "logbook list failed offline");
    assert(Array.isArray(logbook.artifacts), "logbook artifacts missing");

    // Hosted-shaped failure must not be required for local routes.
    const prepare = await postJson(`${baseUrl}/masthead-pages/reviews/prepare`, {
      artifactIds: ["artifact:does-not-exist"],
    });
    assert(prepare.ok === true, "prepare failed offline");
    assert(prepare.items?.[0]?.eligibility === "ineligible", "missing artifact should be ineligible");

    // Credential file must never be readable from daemon SQLite path.
    const credentialProbe = join(tempDir, "masthead-pages-credentials.json");
    await writeFile(
      credentialProbe,
      JSON.stringify({ encryptedRefreshTokenB64: "dGVzdA==", account: { handle: "demo" } }),
      "utf8",
    );
    const settings = await getJson(`${baseUrl}/settings`);
    const settingsJson = JSON.stringify(settings);
    assert(!settingsJson.includes("encryptedRefreshTokenB64"), "settings leaked pages credentials");
    assert(!settingsJson.includes("refreshToken"), "settings leaked refresh token field");
    assert(!settingsJson.includes("dGVzdA=="), "settings leaked credential bytes");

    // MCP status remains available without hosted Pages.
    const mcp = await getJson(`${baseUrl}/mcp/status`);
    assert(mcp.ok === true, "mcp status failed offline");

    const receipt = {
      ok: true,
      passClasses: [
        "daemon_health_offline",
        "logbook_list_offline",
        "prepare_without_hosted",
        "settings_exclude_pages_credentials",
        "mcp_status_offline",
      ],
      artifactCount: logbook.artifacts.length,
    };

    if (process.argv.includes("--json")) console.log(JSON.stringify(receipt, null, 2));
    else console.log("Masthead Pages offline smoke passed (local Logbook usable without hosted service).");
  } finally {
    await daemon.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
} finally {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
}

function listen(daemon) {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json();
  assert(response.ok, `GET ${url} -> ${response.status}`);
  return body;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  assert(response.ok, `POST ${url} -> ${response.status} ${JSON.stringify(json)}`);
  return json;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
