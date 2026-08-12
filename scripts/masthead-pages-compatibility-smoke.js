#!/usr/bin/env node

/**
 * Cross-repository compatibility smoke for Masthead Pages.
 * Pure Node — no production credentials, no hosted network, sanitized receipt only.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import canonicalize from "canonicalize";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = join(root, "schemas/masthead-pages/v1");

const PRIVATE_MARKERS = [
  "session:private",
  "source:private",
  "/home/secret",
  "SECRET_",
  "refreshToken",
  "accessToken",
  "rawTranscript",
];

try {
  await runNode(join(root, "scripts/verify-masthead-pages-contract.js"));

  const manifest = JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8"));
  const vectors = JSON.parse(await readFile(join(bundleRoot, "vectors/page-object-ids.json"), "utf8"));
  const completeFixture = JSON.parse(
    await readFile(join(bundleRoot, "fixtures/page-revision/complete.valid.json"), "utf8"),
  );

  let matchedVectors = 0;
  for (const vector of vectors) {
    const objectId = computePageObjectId(vector.object);
    assert(objectId === vector.objectId, `object id mismatch for ${vector.name}: ${objectId} != ${vector.objectId}`);
    matchedVectors += 1;
  }

  const projected = projectAllowlist(syntheticDossier());
  assert(projected.schemaVersion === "masthead-page-revision-v1", "schemaVersion missing");
  assert(projected.kind === "session_dossier", "kind missing");
  assert(projected.generator.projection === "session-dossier-public-v1", "projection version missing");
  assert(!("identity" in projected), "identity leaked into projection");
  assert(!("narrative" in projected), "narrative leaked into projection");
  assert(!("files" in projected), "files leaked into projection");
  assert(!("tools" in projected), "tools leaked into projection");
  assert(!("usage" in projected), "usage leaked into projection");

  const request = {
    protocolVersion: "masthead-pages-publish-v1",
    publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
    slug: "compatibility-smoke-page",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    objectId: computePageObjectId(projected),
    object: projected,
  };

  const serialized = JSON.stringify(request);
  for (const marker of PRIVATE_MARKERS) {
    assert(!serialized.includes(marker), `outbound request leaked ${marker}`);
  }

  assert(
    !isStagedRefsOnly({ refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }], object: projected }),
    "raw page object IPC was accepted",
  );
  assert(
    isStagedRefsOnly({
      refs: [
        {
          artifactId: "a1",
          requestDigest: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    }),
    "valid staged refs rejected",
  );

  const fixtureObjectId = computePageObjectId(completeFixture);
  const completeVector = vectors.find((vector) => vector.name === "complete.valid.json");
  assert(completeVector, "complete.valid.json vector missing");
  assert(fixtureObjectId === completeVector.objectId, "complete fixture object id drifted from hosted vectors");

  const { createMastheadDaemon } = await import(pathToFileURL(join(root, "dist/daemon/src/daemon/server.js")).href);
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-compat-"));
  try {
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
      const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
      assert(health.ok === true, "local daemon health failed while hosted is unused");
      const logbook = await fetch(`${baseUrl}/logbook/artifacts`).then((response) => response.json());
      assert(logbook.ok === true, "local logbook list failed while hosted is unused");
    } finally {
      await daemon.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }

  const receipt = {
    ok: true,
    protocol: manifest.name,
    schemaFiles: manifest.files.length,
    vectorCount: matchedVectors,
    projection: projected.generator.projection,
    objectIds: {
      projected: request.objectId,
      completeFixture: fixtureObjectId,
    },
    passClasses: [
      "contract_checksum",
      "object_identity_vectors",
      "public_projection_allowlist",
      "private_marker_absent",
      "raw_envelope_ipc_rejected",
      "local_daemon_without_hosted",
    ],
  };

  const receiptJson = JSON.stringify(receipt);
  for (const marker of PRIVATE_MARKERS) {
    assert(!receiptJson.includes(marker), `receipt leaked ${marker}`);
  }
  assert(!/"body"\s*:/.test(receiptJson), "receipt must not embed full page bodies");

  if (process.argv.includes("--json")) console.log(JSON.stringify(receipt, null, 2));
  else {
    console.log(
      `Masthead Pages compatibility smoke passed (${matchedVectors} vectors, projection ${projected.generator.projection}).`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

function computePageObjectId(page) {
  const canonical = canonicalize(page);
  assert(typeof canonical === "string", "canonicalize_failed");
  return `sha256-${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function projectAllowlist(dossier) {
  const durable = dossier.durableEnrichment;
  assert(durable?.sessionTitle?.text, "title_required");
  assert(durable?.sessionSummary?.text, "summary_required");
  const d = durable.sessionDossier;
  return {
    schemaVersion: "masthead-page-revision-v1",
    kind: "session_dossier",
    title: durable.sessionTitle.text,
    summary: durable.sessionSummary.text,
    body: {
      purpose: d.purpose,
      outcome: d.outcome,
      keyWork: [...(d.keyWork ?? [])],
      decisions: [...(d.decisions ?? [])],
      blockers: [...(d.blockers ?? [])],
      continuation: {
        openQuestions: [...(d.continuation?.openQuestions ?? [])],
        constraints: [...(d.continuation?.constraints ?? [])],
        ...(d.continuation?.nextStep ? { nextStep: d.continuation.nextStep } : {}),
      },
      warnings: [...(d.warnings ?? [])],
    },
    labels: { topics: [], technologies: [] },
    verification: {
      status: d.verification?.status ?? "unknown",
      summary: d.verification?.summary ?? "No verification claims were published.",
      checks: [...(d.verification?.commands ?? [])],
      failures: [...(d.verification?.failures ?? [])],
    },
    evidence: [],
    provenance: {
      sourceKind: "session_dossier",
      sourceSchema: "canonical-session-dossier-v1",
      sourceLinks: [],
    },
    license: "all-rights-reserved",
    generator: {
      name: "Masthead",
      version: "0.1.15",
      projection: "session-dossier-public-v1",
    },
  };
}

function syntheticDossier() {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId: "session:private-alpha-do-not-leak",
      sourceSessionId: "source:private-alpha-do-not-leak",
      title: "Private",
      runtime: "codex",
      lifecycle: "ended",
      startedAt: "2026-08-10T09:15:30.000Z",
      endedAt: "2026-08-11T18:45:00.000Z",
      repoRoot: "/home/secret/repo-root-path",
    },
    enrichment: { status: "current" },
    durableEnrichment: {
      version: "session-capsule-v4",
      keywords: ["pages"],
      sessionTitle: {
        text: "Compatibility smoke Page",
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionSummary: {
        text: "Projected without private local fields.",
        state: "completed",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionDossier: {
        purpose: "Prove allowlist projection.",
        outcome: "Public PageRevisionV1 only.",
        keyWork: ["Checksum contract", "Match hosted object IDs"],
        decisions: ["No local object spread"],
        blockers: [],
        verification: {
          status: "passed",
          summary: "Smoke projection ready.",
          commands: ["npm run smoke:masthead-pages"],
          failures: [],
          evidenceRefs: [],
        },
        continuation: { openQuestions: [], constraints: [] },
        evidenceRefs: [],
        warnings: [],
      },
    },
    narrative: { firstUserPrompt: "SECRET_FIRST_USER_PROMPT_VALUE" },
    files: [],
    tools: [],
    usage: { inputTokens: 9 },
  };
}

function isStagedRefsOnly(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const forbidden = new Set([
    "object",
    "requests",
    "pageId",
    "publicLogbookId",
    "refreshToken",
    "accessToken",
    "token",
    "request",
    "envelope",
    "page",
  ]);
  for (const key of Object.keys(args)) {
    if (forbidden.has(key)) return false;
  }
  if (!Array.isArray(args.refs) || args.refs.length === 0) return false;
  return args.refs.every(
    (ref) =>
      ref &&
      typeof ref === "object" &&
      typeof ref.artifactId === "string" &&
      typeof ref.requestDigest === "string" &&
      Object.keys(ref).length === 2,
  );
}

function runNode(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} failed: ${stderr || `exit ${code}`}`));
    });
  });
}

function listen(daemon) {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
