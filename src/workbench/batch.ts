import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { getWorkbenchSchema, isWorkbenchOutputKind } from "./schemas.ts";
import { applySessionEnrichment } from "./applySessionEnrichment.ts";
import { applyArtifact } from "./applyArtifact.ts";
import { buildWorkbenchEvidencePacket } from "./evidencePacket.ts";
import { workbenchInstructions } from "./instructions.ts";
import { queueWorkbenchSessions, type WorkbenchQueueItem } from "./queueRepository.ts";
import type { WorkbenchOutputKind } from "./types.ts";

export type WorkbenchBatchManifest = {
  batchVersion: "workbench-batch-v1";
  createdAt: string;
  kind: WorkbenchOutputKind;
  scope: string;
  sessions: WorkbenchBatchSession[];
};

export type WorkbenchBatchSession = WorkbenchQueueItem & {
  directoryName: string;
};

export type PrepareWorkbenchBatchResult = {
  ok: boolean;
  batchDir: string;
  sessions: WorkbenchBatchSession[];
};

export type ApplyWorkbenchBatchResult = {
  ok: boolean;
  applied: number;
  failed: number;
  failures: Array<{
    sessionId: string;
    directoryName: string;
    message: string;
  }>;
};

export async function prepareWorkbenchBatch(
  db: MastheadDatabase,
  options: { kind: WorkbenchOutputKind; scope: string; limit: number; outDir: string }
): Promise<PrepareWorkbenchBatchResult> {
  const sessions = queueWorkbenchSessions(db, { kind: options.kind, limit: options.limit, scope: options.scope }).map((session, index) => ({
    ...session,
    directoryName: `session-${String(index + 1).padStart(3, "0")}`
  }));
  const manifest: WorkbenchBatchManifest = {
    batchVersion: "workbench-batch-v1",
    createdAt: new Date().toISOString(),
    kind: options.kind,
    scope: options.scope,
    sessions
  };

  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(options.outDir, "README.md"), batchReadme(options.kind, options.scope), "utf8");

  await Promise.all(
    sessions.map(async (session) => {
      const sessionDir = join(options.outDir, session.directoryName);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(join(sessionDir, "evidence.json"), `${JSON.stringify(buildWorkbenchEvidencePacket(db, { kind: options.kind, sessionId: session.sessionId }), null, 2)}\n`, "utf8");
      await writeFile(join(sessionDir, "schema.json"), `${JSON.stringify(getWorkbenchSchema(options.kind), null, 2)}\n`, "utf8");
      await writeFile(join(sessionDir, "instructions.md"), `${workbenchInstructions({ kind: options.kind, scope: `session:${session.sessionId}` })}\n`, "utf8");
      await writeFile(join(sessionDir, "output.json"), "{}\n", "utf8");
      await writeApplyScript(sessionDir, options.kind, session.sessionId);
    })
  );

  return { batchDir: options.outDir, ok: true, sessions };
}

export async function applyWorkbenchBatch(db: MastheadDatabase, options: { batchDir: string; dryRun?: boolean }): Promise<ApplyWorkbenchBatchResult> {
  const manifest = parseManifest(await readFile(join(options.batchDir, "manifest.json"), "utf8"));
  const failures: ApplyWorkbenchBatchResult["failures"] = [];
  let applied = 0;

  for (const session of manifest.sessions) {
    try {
      const output = JSON.parse(await readFile(join(options.batchDir, session.directoryName, "output.json"), "utf8")) as unknown;
      if (manifest.kind === "session_enrichment") {
        applySessionEnrichment(db, { dryRun: options.dryRun, output: output as never, sessionId: session.sessionId });
      } else {
        applyArtifact(db, { dryRun: options.dryRun, kind: manifest.kind, output, sessionId: session.sessionId });
      }
      applied += 1;
    } catch (error) {
      failures.push({
        directoryName: session.directoryName,
        message: error instanceof Error ? error.message : String(error),
        sessionId: session.sessionId
      });
    }
  }

  return {
    applied,
    failed: failures.length,
    failures,
    ok: failures.length === 0
  };
}

function batchReadme(kind: WorkbenchOutputKind, scope: string): string {
  return [
    `# Masthead Workbench Batch`,
    "",
    `Kind: ${kind}`,
    `Scope: ${scope}`,
    "",
    "Fill each session output.json with JSON matching schema.json.",
    "Use evidence.json as the only source of facts.",
    "Run mastheadctl workbench batch apply <batch-dir> --json when outputs are ready."
  ].join("\n") + "\n";
}

async function writeApplyScript(sessionDir: string, kind: WorkbenchOutputKind, sessionId: string): Promise<void> {
  const script = [
    "#!/usr/bin/env sh",
    "set -eu",
    `mastheadctl workbench validate --kind ${kind} --session '${sessionId}' --file output.json --json`,
    `mastheadctl workbench apply --kind ${kind} --session '${sessionId}' --file output.json --json`
  ].join("\n") + "\n";
  const scriptPath = join(sessionDir, "apply.sh");
  await writeFile(scriptPath, script, "utf8");
  await chmod(scriptPath, 0o755);
}

function parseManifest(raw: string): WorkbenchBatchManifest {
  const manifest = JSON.parse(raw) as WorkbenchBatchManifest;
  if (manifest?.batchVersion !== "workbench-batch-v1" || !isWorkbenchOutputKind(manifest.kind) || !Array.isArray(manifest.sessions)) {
    throw new Error("Invalid Workbench batch manifest.");
  }
  return manifest;
}
