import { readFile } from "node:fs/promises";
import { resolveWorkbenchDatabasePath } from "./dbPath.ts";
import { errorResult, jsonResult, textResult, type CliResult } from "./output.ts";
import { getWorkbenchSchema, isWorkbenchOutputKind } from "../workbench/schemas.ts";
import { validateWorkbenchOutput } from "../workbench/validation.ts";
import { workbenchInstructions } from "../workbench/instructions.ts";
import { queueWorkbenchSessions } from "../workbench/queueRepository.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { applySessionEnrichment } from "../workbench/applySessionEnrichment.ts";
import { applyArtifact, publishArtifact } from "../workbench/applyArtifact.ts";
import {
  listSessionArtifacts,
  wipePublishedArtifactState,
  type SessionArtifactKind
} from "../daemon/db/sessionArtifactRepository.ts";
import { applyWorkbenchBatch, prepareWorkbenchBatch } from "../workbench/batch.ts";
import {
  claimWorkbenchSessions,
  enrollMissingWorkbenchSessions,
  listWorkbenchActivity,
  markWorkbenchQuality,
  publishWorkbenchSession,
  releaseWorkbenchClaim,
  setWorkbenchArtifactApplicability,
  type WorkbenchAutomaticKind
} from "../daemon/db/workbenchPipelineRepository.ts";
import { buildWorkbenchEvidencePacket, listProvenanceCandidateSummaries } from "../workbench/evidencePacket.ts";
import { runCaptureQualityPrecheck } from "../workbench/qualityPrecheck.ts";
import {
  checkWorkbenchTranscript,
  createWorkbenchTranscriptImport,
  previewWorkbenchTranscriptImport
} from "../workbench/transcriptWorkflow.ts";

export type WorkbenchCliOptions = {
  env?: NodeJS.ProcessEnv;
};

export async function runWorkbenchCli(args: string[], options: WorkbenchCliOptions = {}): Promise<CliResult> {
  const json = args.includes("--json");
  const command = firstPositional(args);

  if (!command || command === "--help" || command === "help") return textResult(workbenchHelp());

  if (command === "status") {
    const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
    const db = await openMastheadDatabase(databasePath);
    try {
      migrateDatabase(db);
      return jsonResult({
        ok: true,
        command: "workbench status",
        databasePath,
        queue: workbenchQueueCounts(db),
        activeClaims: activeClaimCount(db)
      });
    } finally {
      db.close();
    }
  }

  if (command === "db-path") {
    return textResult(`${resolveWorkbenchDatabasePath({ args, env: options.env })}\n`);
  }

  if (command === "schema") {
    const kind = firstPositional(args.slice(1));
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    return jsonResult(getWorkbenchSchema(kind));
  }

  if (command === "validate") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const file = optionValue(args, "--file");
    if (!file) return errorResult("missing_argument", "Missing required option: --file", json);
    const sessionId = optionValue(args, "--session");
    const provenanceSessionIds = provenanceOption(args);
    try {
      const output = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (!sessionId) {
        const result = validateWorkbenchOutput(kind, output);
        return jsonResult(result, result.ok ? 0 : 1);
      }
      const db = await openCliDatabase(args, options.env);
      try {
        const result = validateWorkbenchOutput(
          kind,
          output,
          buildWorkbenchEvidencePacket(db, { kind, provenanceSessionIds, sessionId })
        );
        return jsonResult(result, result.ok ? 0 : 1);
      } finally {
        db.close();
      }
    } catch (error) {
      if (error instanceof SyntaxError) return errorResult("invalid_json", `Invalid JSON in ${file}`, json);
      throw error;
    }
  }

  if (command === "apply") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const file = optionValue(args, "--file");
    if (!file) return errorResult("missing_argument", "Missing required option: --file", json);
    const provenanceSessionIds = provenanceOption(args);
    try {
      const output = JSON.parse(await readFile(file, "utf8")) as unknown;
      const db = await openCliDatabase(args, options.env);
      try {
        if (kind === "session_enrichment") {
          return jsonResult(applySessionEnrichment(db, { dryRun: args.includes("--dry-run"), output: output as never, sessionId }));
        }
        return jsonResult(
          applyArtifact(db, { dryRun: args.includes("--dry-run"), kind, output, provenanceSessionIds, sessionId })
        );
      } finally {
        db.close();
      }
    } catch (error) {
      if (error instanceof SyntaxError) return errorResult("invalid_json", `Invalid JSON in ${file}`, json);
      throw error;
    }
  }

  if (command === "artifacts") {
    const sessionId = optionValue(args, "--session");
    const kind = optionValue(args, "--kind");
    const artifactKind = kind ? parseArtifactKind(kind) : undefined;
    if (kind && !artifactKind) return errorResult("unknown_schema", `Unknown Workbench artifact kind: ${kind}`, json);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult({
        ok: true,
        artifacts: listSessionArtifacts(db, { artifactKind, sessionId })
      });
    } finally {
      db.close();
    }
  }

  if (command === "publish") {
    const artifactId = optionValue(args, "--artifact");
    if (artifactId) {
      const db = await openCliDatabase(args, options.env);
      try {
        return jsonResult(publishArtifact(db, artifactId));
      } finally {
        db.close();
      }
    }
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session or --artifact", json);
    const db = await openCliDatabase(args, options.env);
    try {
      const result = publishWorkbenchSession(db, {
        actor: { kind: "agent", id: "mastheadctl" },
        sessionId
      });
      return jsonResult(result, result.ok ? 0 : 1);
    } finally {
      db.close();
    }
  }

  if (command === "na" || command === "not-applicable") {
    const kind = optionValue(args, "--kind");
    const sessionId = optionValue(args, "--session");
    const reason = optionValue(args, "--reason") ?? "not_applicable";
    if (!isAutomaticKind(kind)) return errorResult("unknown_schema", `Unknown automatic kind: ${kind ?? ""}`.trim(), json);
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult(
        setWorkbenchArtifactApplicability(db, {
          actor: { kind: "agent", id: "mastheadctl" },
          artifactKind: kind,
          reason,
          sessionId,
          status: "not_applicable"
        })
      );
    } finally {
      db.close();
    }
  }

  if (command === "wipe-published") {
    if (!args.includes("--confirm")) {
      return errorResult("missing_argument", "Pass --confirm to wipe published Logbook/artifact state", json);
    }
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult({ ok: true, ...wipePublishedArtifactState(db) });
    } finally {
      db.close();
    }
  }

  if (command === "provenance-candidates") {
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const project = optionValue(args, "--project");
    const limit = numberOption(args, "--limit", 25);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult({
        ok: true,
        candidates: listProvenanceCandidateSummaries(db, { limit, project, seedSessionId: sessionId })
      });
    } finally {
      db.close();
    }
  }

  if (command === "enroll") {
    if (!args.includes("--missing")) {
      return errorResult("missing_argument", "Missing required option: --missing", json);
    }
    const actor = { kind: "agent" as const, id: optionValue(args, "--by") ?? "mastheadctl" };
    const limit = numberOption(args, "--limit", 500);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult(enrollMissingWorkbenchSessions(db, { actor, limit }));
    } finally {
      db.close();
    }
  }

  if (command === "claim") {
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const claimedBy = optionValue(args, "--by") ?? "mastheadctl";
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult(
        claimWorkbenchSessions(db, {
          claimedBy,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          sessionIds: [sessionId]
        })
      );
    } finally {
      db.close();
    }
  }

  if (command === "release") {
    const claimId = optionValue(args, "--claim");
    if (!claimId) return errorResult("missing_argument", "Missing required option: --claim", json);
    const db = await openCliDatabase(args, options.env);
    try {
      const claim = releaseWorkbenchClaim(db, { claimId, reason: optionValue(args, "--reason") ?? "released" });
      return jsonResult({ ok: Boolean(claim), claim }, claim ? 0 : 1);
    } finally {
      db.close();
    }
  }

  if (command === "activity") {
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult({
        ok: true,
        activity: listWorkbenchActivity(db, {
          limit: numberOption(args, "--limit", 50),
          sessionId: optionValue(args, "--session")
        })
      });
    } finally {
      db.close();
    }
  }

  if (command === "not-added") {
    const subCommand = firstPositional(args.slice(args.indexOf(command) + 1));
    const db = await openCliDatabase(args, options.env);
    try {
      if (subCommand === "summary") return jsonResult({ ok: true, ...notAddedSummary(db) });
      if (subCommand === "list") return jsonResult({ ok: true, sessions: notAddedList(db, numberOption(args, "--limit", 50)) });
      return errorResult("unknown_command", `Unknown workbench not-added command: ${subCommand ?? ""}`.trim(), json);
    } finally {
      db.close();
    }
  }

  if (command === "transcript") {
    const subCommand = firstPositional(args.slice(args.indexOf(command) + 1));
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const sourceId = optionValue(args, "--source");
    const db = await openCliDatabase(args, options.env);
    try {
      const actor = { kind: "agent" as const, id: "mastheadctl" };
      if (subCommand === "check") return jsonResult(checkWorkbenchTranscript(db, { actor, sessionId }));
      if (subCommand === "preview") {
        const result = previewWorkbenchTranscriptImport(db, { actor, sessionId, sourceId });
        return jsonResult(result, result.ok ? 0 : 1);
      }
      if (subCommand === "import") {
        const result = createWorkbenchTranscriptImport(db, { actor, sessionId, sourceId });
        return jsonResult(result, result.ok ? 0 : 1);
      }
      return errorResult("unknown_command", `Unknown workbench transcript command: ${subCommand ?? ""}`.trim(), json);
    } finally {
      db.close();
    }
  }

  if (command === "quality") {
    const subCommand = firstPositional(args.slice(args.indexOf(command) + 1));
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const db = await openCliDatabase(args, options.env);
    try {
      const actor = { kind: "agent" as const, id: "mastheadctl" };
      if (subCommand === "pass") {
        return jsonResult(markWorkbenchQuality(db, { actor, sessionId, status: "passed" }));
      }
      if (subCommand === "fail") {
        const reason = optionValue(args, "--reason");
        if (!reason) return errorResult("missing_argument", "Missing required option: --reason", json);
        return jsonResult(markWorkbenchQuality(db, { actor, sessionId, status: "failed", reason }));
      }
      if (subCommand === "precheck") {
        const precheck = runCaptureQualityPrecheck(db, sessionId);
        const result = markWorkbenchQuality(db, {
          actor,
          sessionId,
          status: precheck.ok ? "passed" : "failed",
          reason: precheck.reason
        });
        return jsonResult(
          {
            ok: precheck.ok,
            precheck,
            state: result.state,
            activity: result.activity
          },
          precheck.ok ? 0 : 1
        );
      }
      return errorResult("unknown_command", `Unknown workbench quality command: ${subCommand ?? ""}`.trim(), json);
    } catch (error) {
      if (isCannotFailQualityOnPublishedError(error)) {
        return errorResult("invalid_state", error.message, json);
      }
      throw error;
    } finally {
      db.close();
    }
  }

  if (command === "batch") {
    const subArgs = args.slice(args.indexOf(command) + 1);
    const batchCommand = firstPositional(subArgs);
    if (batchCommand === "prepare") {
      const kind = optionValue(args, "--kind");
      if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
      const outDir = optionValue(args, "--out");
      if (!outDir) return errorResult("missing_argument", "Missing required option: --out", json);
      const db = await openCliDatabase(args, options.env);
      try {
        return jsonResult(await prepareWorkbenchBatch(db, { kind, limit: numberOption(args, "--limit", 20), outDir, scope: optionValue(args, "--scope") ?? "missing" }));
      } catch (error) {
        if (isInvalidScopeError(error)) return errorResult("invalid_scope", error.message, json);
        throw error;
      } finally {
        db.close();
      }
    }
    if (batchCommand === "apply") {
      const batchDir = firstPositional(subArgs.slice(1));
      if (!batchDir) return errorResult("missing_argument", "Missing required batch directory", json);
      const db = await openCliDatabase(args, options.env);
      try {
        const result = await applyWorkbenchBatch(db, { batchDir, dryRun: args.includes("--dry-run") });
        return jsonResult(result, result.ok ? 0 : 1);
      } finally {
        db.close();
      }
    }
    return errorResult("unknown_command", `Unknown workbench batch command: ${batchCommand ?? ""}`.trim(), json);
  }

  if (command === "instructions") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const scope = optionValue(args, "--scope") ?? "missing";
    return textResult(`${workbenchInstructions({ kind, scope })}\n`);
  }

  if (command === "queue") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult({
        ok: true,
        sessions: queueWorkbenchSessions(db, {
          kind,
          limit: numberOption(args, "--limit", 20),
          scope: optionValue(args, "--scope") ?? "missing"
        })
      });
    } catch (error) {
      if (isInvalidScopeError(error)) return errorResult("invalid_scope", error.message, json);
      throw error;
    } finally {
      db.close();
    }
  }

  if (command === "evidence") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const sessionId = optionValue(args, "--session");
    if (!sessionId) return errorResult("missing_argument", "Missing required option: --session", json);
    const provenanceSessionIds = provenanceOption(args);
    const db = await openCliDatabase(args, options.env);
    try {
      return jsonResult(buildWorkbenchEvidencePacket(db, { kind, provenanceSessionIds, sessionId }));
    } finally {
      db.close();
    }
  }

  if (command === "next") {
    const kind = optionValue(args, "--kind");
    if (!isWorkbenchOutputKind(kind)) return errorResult("unknown_schema", `Unknown Workbench schema kind: ${kind ?? ""}`.trim(), json);
    const scope = optionValue(args, "--scope") ?? "missing";
    const db = await openCliDatabase(args, options.env);
    try {
      const [session] = queueWorkbenchSessions(db, { kind, limit: 1, scope });
      return jsonResult({
        ok: true,
        session,
        schema: getWorkbenchSchema(kind),
        instructions: workbenchInstructions({ kind, scope }),
        evidence: session ? buildWorkbenchEvidencePacket(db, { kind, sessionId: session.sessionId }) : undefined,
        applyCommand: session
          ? `mastheadctl workbench apply --kind ${kind} --session ${session.sessionId} --file output.json --json`
          : undefined
      });
    } catch (error) {
      if (isInvalidScopeError(error)) return errorResult("invalid_scope", error.message, json);
      throw error;
    } finally {
      db.close();
    }
  }

  return errorResult("unknown_command", `Unknown workbench command: ${command}`, json);
}

export function workbenchHelp(): string {
  return [
    "Usage: mastheadctl workbench <command> [options]",
    "",
    "Commands:",
    "  mastheadctl workbench status --json",
    "  mastheadctl workbench db-path",
    "  mastheadctl workbench queue --kind <kind> --scope <scope> --json",
    "  mastheadctl workbench next --kind <kind> --scope <scope> --json",
    "  mastheadctl workbench instructions --kind <kind> --scope <scope>",
    "  mastheadctl workbench schema <kind> --json",
    "  mastheadctl workbench evidence --kind <kind> --session <id> --json",
    "  mastheadctl workbench validate --kind <kind> --session <id> --file <file> --json",
    "  mastheadctl workbench apply --kind <kind> --session <id> --file <file> --json",
    "  mastheadctl workbench publish --session <id> --json",
    "  mastheadctl workbench enroll --missing [--limit N] --json",
    "  mastheadctl workbench claim --session <id> --by <agent> --json",
    "  mastheadctl workbench release --claim <id> --json",
    "  mastheadctl workbench activity --session <id> --json",
    "  mastheadctl workbench not-added summary --json",
    "  mastheadctl workbench not-added list --json",
    "  mastheadctl workbench transcript check --session <id> --json",
    "  mastheadctl workbench transcript preview --session <id> --source <source-id> --json",
    "  mastheadctl workbench transcript import --session <id> --source <source-id> --json",
    "  mastheadctl workbench quality pass --session <id> --json",
    "  mastheadctl workbench quality fail --session <id> --reason <code> --json",
    "  mastheadctl workbench quality precheck --session <id> --json",
    "  mastheadctl workbench artifacts --session <id> --json",
    "  mastheadctl workbench batch prepare --kind <kind> --scope <scope> --limit <n> --out <dir> --json",
    "  mastheadctl workbench batch apply <dir> --json",
    "",
    "Kinds:",
    "  session_enrichment, session_dossier, runbook, adr, incident_timeline",
    "",
    "Agent loop:",
    "  Use next for a complete packet, write schema JSON, validate with --session,",
    "  apply, then publish artifacts. Multi-session kinds accept --provenance id,id.",
    "",
    "Options:",
    "  --db <path>  Use an explicit Masthead SQLite database path",
    "  --json       Print machine-readable JSON"
  ].join("\n") + "\n";
}

function firstPositional(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--db") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    return arg;
  }
  return undefined;
}

function optionValue(args: string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) return args[index + 1];
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1);
  }
  return undefined;
}

function workbenchQueueCounts(db: Awaited<ReturnType<typeof openMastheadDatabase>>) {
  const rows = db
    .prepare(
      `SELECT publication_status AS status, COUNT(*) AS count
      FROM workbench_session_state
      GROUP BY publication_status`
    )
    .all() as Array<{ status: string; count: number }>;
  const countFor = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
  return {
    publishPath: countFor("publish_path"),
    notAdded: countFor("not_added_to_logbook"),
    published: countFor("published")
  };
}

function activeClaimCount(db: Awaited<ReturnType<typeof openMastheadDatabase>>): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM workbench_claims WHERE released_at IS NULL AND expires_at > ?")
    .get(new Date().toISOString()) as { count: number };
  return row.count;
}

function notAddedSummary(db: Awaited<ReturnType<typeof openMastheadDatabase>>) {
  const rows = db
    .prepare(
      `SELECT non_publication_reason AS reason, COUNT(*) AS count
      FROM workbench_session_state
      WHERE publication_status = 'not_added_to_logbook'
      GROUP BY non_publication_reason
      ORDER BY count DESC, lower(COALESCE(non_publication_reason, 'unknown'))`
    )
    .all() as Array<{ reason: string | null; count: number }>;
  return {
    total: rows.reduce((total, row) => total + row.count, 0),
    reasons: rows.map((row) => ({ count: row.count, reason: row.reason ?? "unknown" }))
  };
}

function notAddedList(db: Awaited<ReturnType<typeof openMastheadDatabase>>, limit: number) {
  return db
    .prepare(
      `SELECT
        workbench_session_state.session_id AS sessionId,
        workbench_session_state.non_publication_reason AS reason
      FROM workbench_session_state
      JOIN sessions ON sessions.session_id = workbench_session_state.session_id
      WHERE workbench_session_state.publication_status = 'not_added_to_logbook'
        AND sessions.deleted_at IS NULL
      ORDER BY COALESCE(workbench_session_state.last_activity_at, sessions.last_activity_at, workbench_session_state.updated_at) DESC
      LIMIT ?`
    )
    .all(Math.max(1, Math.min(limit, 100)));
}

function numberOption(args: string[], option: string, fallback: number): number {
  const value = optionValue(args, option);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function openCliDatabase(args: string[], env: NodeJS.ProcessEnv | undefined) {
  const db = await openMastheadDatabase(resolveWorkbenchDatabasePath({ args, env }));
  migrateDatabase(db);
  return db;
}

function isInvalidScopeError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("invalid_scope:");
}

function isCannotFailQualityOnPublishedError(error: unknown): error is Error {
  return error instanceof Error && error.message === "cannot_fail_quality_on_published_session";
}

function isArtifactKind(value: string): value is SessionArtifactKind {
  return value === "session_dossier" || value === "runbook" || value === "adr" || value === "incident_timeline";
}

function parseArtifactKind(value: string): SessionArtifactKind | undefined {
  return isArtifactKind(value) ? value : undefined;
}

function isAutomaticKind(value: string | undefined): value is WorkbenchAutomaticKind {
  return value === "runbook" || value === "adr" || value === "incident_timeline";
}

function provenanceOption(args: string[]): string[] | undefined {
  const raw = optionValue(args, "--provenance");
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}
