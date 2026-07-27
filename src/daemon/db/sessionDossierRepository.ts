import { basename, dirname, isAbsolute, sep } from "node:path";
import { isHighRiskPath } from "../../core/risk.ts";
import type { EvidenceRef } from "../../core/types.ts";
import { SESSION_CAPSULE_PROMPT_VERSION } from "../../enrichment/sessionCompiler.ts";
import type { SessionCapsule } from "../../enrichment/types.ts";
import {
  normalizeDurableSessionEnrichment,
  type DurableSessionEnrichment
} from "../../shared/sessionEnrichment.ts";
import type {
  SessionDossierAttention,
  SessionDossierArtifact,
  SessionDossierCoverage,
  SessionDossierCoverageLevel,
  SessionDossierCoverageWarning,
  SessionDossierDto,
  SessionDossierEnrichmentState,
  SessionDossierExcerpt,
  SessionDossierFile,
  SessionDossierIdentity,
  SessionDossierNarrative,
  SessionDossierTimelineEvent,
  SessionDossierTool,
  SessionDossierUsage,
  SessionDossierVerification
} from "../../shared/sessionDossier.ts";
import { materializeDurableDossierPresentation } from "../../shared/sessionDossierMaterialization.ts";
import type { SessionTranscriptCoverage } from "../../shared/sessionTranscript.ts";
import { readCurrentSessionEnrichment, readLatestFailedSessionEnrichment } from "./enrichmentRepository.ts";
import { listSessionArtifacts } from "./sessionArtifactRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { getTranscriptCoverage } from "./sessionTranscriptRepository.ts";
import { sessionMcpAllowed } from "../../mcp/policy.ts";

type IdentityRow = {
  branch: string | null;
  endedAt: string | null;
  hostId: string;
  lastActivityAt: string;
  lifecycle: string;
  outcome: string | null;
  project: string | null;
  repoRoot: string | null;
  runtime: string;
  sessionId: string;
  sourceConfidence: SessionDossierIdentity["sourceConfidence"];
  sourceSessionId: string;
  startedAt: string | null;
  title: string | null;
  worktreePath: string | null;
  excludedFromMcpAt: string | null;
};

type MessageRow = {
  messageId: string;
  role: string;
  text: string;
  observedAt: string;
  sourceRefJson: string;
};

type ToolCallRow = {
  toolCallId: string;
  toolName: string;
  startedAt: string | null;
  sourceRefJson: string;
};

type ToolResultRow = {
  toolCallId: string;
  status: string | null;
  exitCode: number | null;
  completedAt: string | null;
  outputRedacted: string | null;
};

type FileRow = {
  fileEffectId: string;
  path: string;
  effectKind: string;
  staged: number;
  additions: number | null;
  deletions: number | null;
  observedAt: string;
  sourceRefJson: string;
};

type RuntimeSignalRow = {
  signalId: string;
  signalKind: string;
  severity: string | null;
  title: string;
  observedAt: string;
  sourceRefJson: string;
};

type CheckpointRow = {
  checkpointId: string;
  checkpointKind: string;
  summary: string;
  observedAt: string;
  sourceRefJson: string;
};

type UsageRow = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRows: number;
};

const DOSSIER_MESSAGE_LIMIT = 240;
const DOSSIER_TIMELINE_LIMIT = 260;
const DOSSIER_TOOL_LIMIT = 100;

export function getSessionDossier(db: MastheadDatabase, sessionId: string): SessionDossierDto | undefined {
  const identity = getIdentity(db, sessionId);
  if (!identity) return undefined;

  const messages = getMessages(db, sessionId);
  const files = getFiles(db, sessionId);
  const tools = getTools(db, sessionId);
  const runtimeSignals = getRuntimeSignals(db, sessionId);
  const checkpoints = getCheckpoints(db, sessionId);
  const verification = verificationFromTools(tools, files.length);
  const attention = getAttention(tools, runtimeSignals, verification, files);
  const usage = getUsage(db, sessionId);
  const coverage = getDossierCoverage(db, sessionId, files, tools, runtimeSignals, attention, usage, verification);
  const durableEnrichment = getDurableEnrichment(db, sessionId);
  const enrichment = getDossierEnrichmentState(db, sessionId);
  const artifacts = getDossierArtifacts(db, sessionId);
  const dossierIdentity = durableEnrichment ? { ...identity, title: durableEnrichment.sessionTitle.text } : identity;
  const narrative = withCoverageCaveat(getNarrative(db, sessionId, dossierIdentity, messages), coverage);
  const partial = materializeDurableDossierPresentation<DossierWithoutReuse>({
    attention,
    artifacts,
    coverage,
    durableEnrichment,
    enrichment,
    excerpts: getExcerpts(messages, checkpoints, runtimeSignals),
    files,
    identity: dossierIdentity,
    narrative,
    timeline: getTimeline(messages, tools, files, checkpoints, runtimeSignals, attention),
    tools,
    usage,
    verification
  });
  const reuse: Omit<SessionDossierDto["reuse"], "copyableContext"> = {
    canonicalSessionId: dossierIdentity.sessionId,
    mcpIncluded: isMcpIncluded(db, sessionId),
    sourceConfidence: dossierIdentity.sourceConfidence,
    sourceRuntime: dossierIdentity.runtime,
    sourceSessionId: dossierIdentity.sourceSessionId
  };
  return { ...partial, reuse: { ...reuse, copyableContext: buildCopyableContext(partial, reuse.mcpIncluded) } };
}

type DossierWithoutReuse = Omit<SessionDossierDto, "reuse">;

function getDossierArtifacts(db: MastheadDatabase, sessionId: string): SessionDossierArtifact[] {
  return listSessionArtifacts(db, { sessionId })
    .filter((artifact) => artifact.status === "current")
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      artifactKind: artifact.artifactKind,
      confidence: artifactConfidence(artifact.content),
      content: artifact.content,
      createdAt: artifact.createdAt,
      evidenceRefs: artifact.evidenceRefs,
      status: artifact.status,
      title: artifact.title,
      updatedAt: artifact.updatedAt
    }));
}

function artifactConfidence(content: unknown): SessionDossierArtifact["confidence"] | undefined {
  if (!content || typeof content !== "object" || !("confidence" in content)) return undefined;
  const confidence = content.confidence;
  return confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : undefined;
}

function getIdentity(db: MastheadDatabase, sessionId: string): SessionDossierIdentity | undefined {
  const row = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.project_label AS project,
        sessions.title,
        runtimes.runtime_kind AS runtime,
        sessions.host_id AS hostId,
        sessions.branch,
        sessions.repo_root AS repoRoot,
        sessions.worktree_path AS worktreePath,
        sessions.lifecycle,
        sessions.outcome_label AS outcome,
        sessions.started_at AS startedAt,
        sessions.ended_at AS endedAt,
        sessions.last_activity_at AS lastActivityAt,
        sessions.source_confidence AS sourceConfidence,
        sessions.excluded_from_mcp_at AS excludedFromMcpAt
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id = ?
        AND sessions.deleted_at IS NULL`
    )
    .get(sessionId) as IdentityRow | undefined;
  if (!row) return undefined;
  const models = getModels(db, sessionId);
  return {
    branch: row.branch ?? undefined,
    durationMs: durationMs(row.startedAt, row.endedAt),
    endedAt: row.endedAt ?? undefined,
    hostId: row.hostId,
    lastActivityAt: row.lastActivityAt,
    lifecycle: row.lifecycle,
    model: models[0],
    models,
    outcome: row.outcome ?? undefined,
    project: row.project ?? undefined,
    repoRoot: row.repoRoot ?? undefined,
    runtime: row.runtime,
    sessionId: row.sessionId,
    sourceConfidence: row.sourceConfidence,
    sourceSessionId: row.sourceSessionId,
    startedAt: row.startedAt ?? undefined,
    title: row.title ?? row.project ?? row.sourceSessionId,
    worktreePath: row.worktreePath ?? undefined
  };
}

function getModels(db: MastheadDatabase, sessionId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT model
      FROM model_usage
      WHERE session_id = ?
        AND model IS NOT NULL
        AND trim(model) <> ''
      ORDER BY observed_at DESC`
    )
    .all(sessionId) as Array<{ model: string }>;
  return rows.map((row) => row.model);
}

function getMessages(db: MastheadDatabase, sessionId: string): MessageRow[] {
  return db
    .prepare(
      `WITH first_user_message AS (
        SELECT message_id AS messageId, role, text_redacted AS text, observed_at AS observedAt, source_ref_json AS sourceRefJson
        FROM messages
        WHERE session_id = ?
          AND role = 'user'
        ORDER BY observed_at ASC, message_id ASC
        LIMIT 1
      ),
      recent_messages AS (
        SELECT message_id AS messageId, role, text_redacted AS text, observed_at AS observedAt, source_ref_json AS sourceRefJson
        FROM messages
        WHERE session_id = ?
        ORDER BY observed_at DESC, message_id DESC
        LIMIT ?
      )
      SELECT messageId, role, text, observedAt, sourceRefJson
      FROM first_user_message
      UNION
      SELECT messageId, role, text, observedAt, sourceRefJson
      FROM recent_messages
      ORDER BY observedAt ASC, messageId ASC`
    )
    .all(sessionId, sessionId, DOSSIER_MESSAGE_LIMIT) as MessageRow[];
}

function getFiles(db: MastheadDatabase, sessionId: string): SessionDossierFile[] {
  const rows = db
    .prepare(
      `SELECT file_effect_id AS fileEffectId,
        path,
        effect_kind AS effectKind,
        staged,
        additions,
        deletions,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson
      FROM file_effects
      WHERE session_id = ?
      ORDER BY observed_at DESC, path
      LIMIT 200`
    )
    .all(sessionId) as FileRow[];
  return rows.map((row) => {
    const display = displayPath(row.path);
    return {
      additions: row.additions ?? undefined,
      basename: basename(display),
      deletions: row.deletions ?? undefined,
      directory: dirname(display) === "." ? undefined : dirname(display),
      displayPath: display,
      effectKind: row.effectKind,
      fileEffectId: row.fileEffectId,
      observedAt: row.observedAt,
      path: row.path,
      sourceRef: parseJson(row.sourceRefJson),
      staged: row.staged === 1
    };
  });
}

function getTools(db: MastheadDatabase, sessionId: string): SessionDossierTool[] {
  const toolCalls = db
    .prepare(
      `SELECT tool_calls.tool_call_id AS toolCallId,
        tool_calls.tool_name AS toolName,
        tool_calls.started_at AS startedAt,
        tool_calls.source_ref_json AS sourceRefJson
      FROM tool_calls
      WHERE tool_calls.session_id = ?
      ORDER BY COALESCE(tool_calls.started_at, '') DESC, tool_calls.tool_call_id DESC
      LIMIT ?`
    )
    .all(sessionId, DOSSIER_TOOL_LIMIT) as ToolCallRow[];
  const resultsByToolCallId = latestToolResultsByCallId(db, toolCalls.map((row) => row.toolCallId));
  return toolCalls.map((row) => {
    const result = resultsByToolCallId.get(row.toolCallId);
    return {
    completedAt: result?.completedAt ?? undefined,
    exitCode: result?.exitCode ?? undefined,
    outputPreview: preview(result?.outputRedacted ?? null),
    sourceRef: parseJson(row.sourceRefJson),
    startedAt: row.startedAt ?? undefined,
    status: result?.status ?? undefined,
    toolCallId: row.toolCallId,
    toolName: row.toolName
  };
  });
}

function latestToolResultsByCallId(db: MastheadDatabase, toolCallIds: string[]): Map<string, ToolResultRow> {
  if (toolCallIds.length === 0) return new Map();
  const placeholders = toolCallIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT tool_call_id AS toolCallId,
        status,
        exit_code AS exitCode,
        completed_at AS completedAt,
        output_redacted AS outputRedacted
      FROM tool_results
      WHERE tool_call_id IN (${placeholders})
      ORDER BY COALESCE(completed_at, '') DESC, tool_result_id DESC`
    )
    .all(...toolCallIds) as ToolResultRow[];
  const results = new Map<string, ToolResultRow>();
  for (const row of rows) {
    if (!results.has(row.toolCallId)) results.set(row.toolCallId, row);
  }
  return results;
}

function getRuntimeSignals(db: MastheadDatabase, sessionId: string): RuntimeSignalRow[] {
  return db
    .prepare(
      `SELECT signal_id AS signalId,
        signal_kind AS signalKind,
        severity,
        title,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson
      FROM runtime_signals
      WHERE session_id = ?
      ORDER BY observed_at DESC
      LIMIT 100`
    )
    .all(sessionId) as RuntimeSignalRow[];
}

function getCheckpoints(db: MastheadDatabase, sessionId: string): CheckpointRow[] {
  return db
    .prepare(
      `SELECT checkpoint_id AS checkpointId,
        checkpoint_kind AS checkpointKind,
        summary,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson
      FROM checkpoints
      WHERE session_id = ?
      ORDER BY observed_at DESC
      LIMIT 100`
    )
    .all(sessionId) as CheckpointRow[];
}

function getUsage(db: MastheadDatabase, sessionId: string): SessionDossierUsage {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS inputTokens,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS outputTokens,
        COALESCE(SUM(COALESCE(total_tokens, COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))), 0) AS totalTokens,
        COUNT(*) AS usageRows
      FROM model_usage
      WHERE session_id = ?
        AND (
          total_tokens IS NOT NULL
          OR input_tokens IS NOT NULL
          OR output_tokens IS NOT NULL
        )`
    )
    .get(sessionId) as UsageRow;
  return {
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    totalTokens: Number(row.totalTokens) || 0,
    usageRows: Number(row.usageRows) || 0
  };
}

function getDossierCoverage(
  db: MastheadDatabase,
  sessionId: string,
  files: SessionDossierFile[],
  tools: SessionDossierTool[],
  runtimeSignals: RuntimeSignalRow[],
  attention: SessionDossierAttention[],
  usage: SessionDossierUsage,
  verification: SessionDossierVerification
): SessionDossierCoverage {
  const transcript = getTranscriptCoverage(db, sessionId);
  const level = coverageLevel({
    attentionCount: attention.length,
    fileCount: files.length,
    runtimeSignals: runtimeSignals.length,
    tools,
    transcript
  });
  return {
    level,
    transcript,
    warnings: coverageWarnings({ files, level, tools, transcript, usage, verification })
  };
}

function coverageLevel(input: {
  attentionCount: number;
  fileCount: number;
  runtimeSignals: number;
  tools: SessionDossierTool[];
  transcript: SessionTranscriptCoverage;
}): SessionDossierCoverageLevel {
  if (input.transcript.hasUsableTranscript && input.fileCount > 0 && input.tools.length > 0) return "complete";
  if (input.transcript.hasUsableTranscript || input.fileCount > 0 || input.tools.length > 0) return "partial";
  if (input.runtimeSignals > 0 || input.transcript.toolCalls > 0 || input.attentionCount > 0) return "hook_only";
  return "metadata_only";
}

function coverageWarnings(input: {
  files: SessionDossierFile[];
  level: SessionDossierCoverageLevel;
  tools: SessionDossierTool[];
  transcript: SessionTranscriptCoverage;
  usage: SessionDossierUsage;
  verification: SessionDossierVerification;
}): SessionDossierCoverageWarning[] {
  const warnings: SessionDossierCoverageWarning[] = [];
  if (!input.transcript.hasUsableTranscript) {
    warnings.push({
      action: { label: "Open Workbench", target: "workbench" },
      code: "transcript_missing",
      message: "Full transcript messages are not available for this session."
    });
  }
  if (input.files.length === 0) {
    warnings.push({
      code: "file_effects_missing",
      message: "File changes were not captured for this session."
    });
  }
  if (hasPartialToolDetails(input.tools, input.transcript)) {
    warnings.push({
      code: "tool_details_partial",
      message: "Tool activity was captured, but command or output details are incomplete."
    });
  }
  if (input.usage.usageRows === 0) {
    warnings.push({
      code: "tokens_missing",
      message: "Token usage was not captured for this session."
    });
  }
  if (input.verification.status === "missing" || input.verification.status === "unknown") {
    warnings.push({
      code: "verification_missing",
      message: "Verification evidence was not captured."
    });
  }
  if (input.transcript.lowValueItems >= 3 || input.level === "hook_only") {
    warnings.push({
      code: "low_value_hook_summaries",
      message: "Several captured rows are low-value hook summaries rather than conversation content."
    });
  }
  return warnings;
}

function hasPartialToolDetails(tools: SessionDossierTool[], transcript: SessionTranscriptCoverage): boolean {
  if (transcript.toolCalls === 0) return false;
  if (tools.length === 0) return true;
  const weakTools = tools.filter((tool) => isWeakToolName(tool.toolName) || !tool.outputPreview).length;
  return weakTools > 0 && weakTools >= Math.ceil(tools.length / 2);
}

function isWeakToolName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "shell" || normalized === "unknown" || normalized === "tool call";
}

function getNarrative(
  db: MastheadDatabase,
  sessionId: string,
  identity: SessionDossierIdentity,
  messages: MessageRow[]
): SessionDossierNarrative {
  const enrichment = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  const latestFailure = readLatestFailedSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  const capsule = enrichment?.content as SessionCapsule | undefined;
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  return {
    finalAssistantMessage: assistantMessages.at(-1)?.text,
    firstUserPrompt: userMessages[0]?.text,
    latestUserPrompt: userMessages.at(-1)?.text,
    liveSummary: capsule?.liveSummary,
    narrativeDebug: enrichment
      ? {
          model: enrichment.model,
          promptVersion: enrichment.promptVersion,
          provider: enrichment.provider,
          providerStatus: capsule?.providerStatus ?? enrichment.status,
          confidence: capsule?.confidence,
          missingEvidence: capsule?.missingEvidence,
          failureCode: latestFailure?.failureCode,
          failureMessage: latestFailure?.failureMessage,
          latestFailedAttemptAt: latestFailure?.generatedAt,
          sourceRefs: enrichment.sourceRefs,
          subjectConfidence: capsule?.subject?.confidence,
          subjectSource: capsule?.subject?.source,
          titleSource: capsule?.titleSource,
          validationWarnings: capsule?.validationWarnings
        }
      : latestFailure
        ? {
            failureCode: latestFailure.failureCode,
            failureMessage: latestFailure.failureMessage,
            latestFailedAttemptAt: latestFailure.generatedAt,
            model: latestFailure.model,
            promptVersion: latestFailure.promptVersion,
            provider: latestFailure.provider,
            providerStatus: latestFailure.failureCode ?? latestFailure.status,
            sourceRefs: latestFailure.sourceRefs
          }
        : undefined,
    objective: capsule?.objective ?? getSessionObjective(db, sessionId),
    outcome: capsule?.outcome ?? identity.outcome,
    technologies: capsule?.technologies ?? [],
    topics: capsule?.topics ?? getSessionTopics(db, sessionId),
    unresolved: capsule?.unresolved?.map((claim) => claim.text).filter(Boolean) ?? []
  };
}

function getDurableEnrichment(db: MastheadDatabase, sessionId: string): DurableSessionEnrichment | undefined {
  const enrichment = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  const capsule = enrichment?.content as SessionCapsule | undefined;
  if (!enrichment || !capsule) return undefined;
  if (capsule.durableEnrichment) return normalizeDurableSessionEnrichment(capsule.durableEnrichment);
  if (capsule.sessionTitle && capsule.sessionSummary && capsule.sessionDossier) {
    return {
      generatedAt: enrichment.generatedAt,
      keywords: [],
      model: enrichment.model,
      promptVersion: enrichment.promptVersion,
      sessionDossier: capsule.sessionDossier,
      sessionSummary: capsule.sessionSummary,
      sessionTitle: capsule.sessionTitle,
      source: enrichment.provider === "deterministic" ? "deterministic" : "remote_model",
      version: "session-capsule-v4"
    };
  }
  return undefined;
}

function getDossierEnrichmentState(db: MastheadDatabase, sessionId: string): SessionDossierEnrichmentState {
  const current = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  if (current) {
    return {
      generatedAt: current.generatedAt,
      model: current.model,
      provider: current.provider,
      status: "current"
    };
  }

  const latestFailed = readLatestFailedSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
  if (latestFailed) {
    return {
      failureCode: latestFailed.failureCode,
      failureMessage: latestFailed.failureMessage,
      generatedAt: latestFailed.generatedAt,
      model: latestFailed.model,
      provider: latestFailed.provider,
      status: "failed"
    };
  }

  return { status: "not_enriched" };
}

function withCoverageCaveat(narrative: SessionDossierNarrative, coverage: SessionDossierCoverage): SessionDossierNarrative {
  if (coverage.level !== "hook_only" && coverage.level !== "metadata_only") return narrative;
  const caveat =
    coverage.level === "hook_only"
      ? "Only live hook metadata is available for this session."
      : "Only sparse metadata is available for this session.";
  return {
    ...narrative,
    liveSummary: narrative.liveSummary && !isWeakSummary(narrative.liveSummary) ? `${caveat} ${narrative.liveSummary}` : caveat,
    objective: isWeakSummary(narrative.objective) ? undefined : narrative.objective,
    outcome: isWeakSummary(narrative.outcome) ? undefined : narrative.outcome
  };
}

function getSessionObjective(db: MastheadDatabase, sessionId: string): string | undefined {
  const row = db.prepare("SELECT objective FROM sessions WHERE session_id = ?").get(sessionId) as { objective: string | null } | undefined;
  return row?.objective ?? undefined;
}

function getSessionTopics(db: MastheadDatabase, sessionId: string): string[] {
  const rows = db.prepare("SELECT topic FROM session_topics WHERE session_id = ? ORDER BY topic").all(sessionId) as Array<{ topic: string }>;
  return rows.map((row) => row.topic);
}

function verificationFromTools(tools: SessionDossierTool[], fileCount: number): SessionDossierVerification {
  const commands = tools.filter((tool) => isVerificationTool(tool));
  const passed = commands.filter((tool) => tool.status === "succeeded" || tool.exitCode === 0);
  const failed = commands.filter((tool) => tool.status === "failed" || (tool.exitCode !== undefined && tool.exitCode !== 0));
  const status =
    failed.length > 0 && passed.length === 0
      ? "failed"
      : failed.length > 0 && passed.length > 0
        ? "mixed"
        : passed.length > 0
          ? "passed"
          : fileCount > 0
            ? "missing"
            : "unknown";
  const summary =
    status === "passed"
      ? "Verification commands passed."
      : status === "failed"
        ? "Verification commands failed."
        : status === "mixed"
          ? "Verification has mixed results."
          : status === "missing"
            ? "Changed files are present but no verification command was captured."
            : "No verification signal captured.";
  return { commands, status, summary };
}

function isVerificationTool(tool: SessionDossierTool): boolean {
  const haystack = `${tool.toolName} ${tool.outputPreview ?? ""}`.toLowerCase();
  return /\b(test|spec|verify|smoke|build)\b|cargo test|npm test|npm run verify/.test(haystack);
}

function getAttention(
  tools: SessionDossierTool[],
  runtimeSignals: RuntimeSignalRow[],
  verification: SessionDossierVerification,
  files: SessionDossierFile[]
): SessionDossierAttention[] {
  const failedTools: SessionDossierAttention[] = tools
    .filter((tool) => tool.status === "failed" || (tool.exitCode !== undefined && tool.exitCode !== 0))
    .map((tool) => ({
      detail: tool.outputPreview,
      kind: "command_failure",
      observedAt: tool.completedAt ?? tool.startedAt,
      severity: "P2",
      sourceRefs: [],
      title: `${tool.toolName} failed`
    }));
  const signals: SessionDossierAttention[] = runtimeSignals
    .filter((signal) => signal.severity === "warning" || signal.severity === "error")
    .map((signal) => ({
      kind: signal.severity === "error" ? "blocked" : "stalled",
      observedAt: signal.observedAt,
      severity: signal.severity === "error" ? "P1" : "P3",
      sourceRefs: [],
      title: signal.title
    }));
  const missing: SessionDossierAttention[] =
    verification.status === "missing"
      ? [
          {
            kind: "missing_verification",
            severity: "P2",
            sourceRefs: [],
            title: "Verification not captured"
          }
        ]
      : [];
  const highRiskFiles = files.filter((file) => isHighRiskPath(file.path));
  const highRisk: SessionDossierAttention[] =
    highRiskFiles.length > 0
      ? [
          {
            detail: highRiskFiles.slice(0, 5).map((file) => file.displayPath).join(", "),
            kind: "high_risk_change",
            observedAt: highRiskFiles[0]?.observedAt,
            severity: "P2",
            sourceRefs: [],
            title: "High-risk change"
          }
        ]
      : [];
  return [...failedTools, ...signals, ...missing, ...highRisk];
}

function getExcerpts(
  messages: MessageRow[],
  checkpoints: CheckpointRow[],
  runtimeSignals: RuntimeSignalRow[]
): SessionDossierExcerpt[] {
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  return [
    userMessages[0] ? messageExcerpt(userMessages[0]) : undefined,
    userMessages.at(-1) && userMessages.at(-1) !== userMessages[0] ? messageExcerpt(userMessages.at(-1)!) : undefined,
    assistantMessages.at(-1) ? messageExcerpt(assistantMessages.at(-1)!) : undefined,
    checkpoints[0]
      ? {
          excerptId: checkpoints[0].checkpointId,
          kind: "checkpoint" as const,
          observedAt: checkpoints[0].observedAt,
          sourceRef: parseJson(checkpoints[0].sourceRefJson),
          text: checkpoints[0].summary
        }
      : undefined,
    runtimeSignals[0]
      ? {
          excerptId: runtimeSignals[0].signalId,
          kind: "runtime_signal" as const,
          observedAt: runtimeSignals[0].observedAt,
          sourceRef: parseJson(runtimeSignals[0].sourceRefJson),
          text: runtimeSignals[0].title
        }
      : undefined
  ].filter((excerpt): excerpt is SessionDossierExcerpt => Boolean(excerpt)).slice(0, 12);
}

function messageExcerpt(message: MessageRow): SessionDossierExcerpt {
  return {
    excerptId: message.messageId,
    kind: "message",
    observedAt: message.observedAt,
    role: message.role,
    sourceRef: parseJson(message.sourceRefJson),
    text: message.text
  };
}

function getTimeline(
  messages: MessageRow[],
  tools: SessionDossierTool[],
  files: SessionDossierFile[],
  checkpoints: CheckpointRow[],
  runtimeSignals: RuntimeSignalRow[],
  attention: SessionDossierAttention[]
): SessionDossierTimelineEvent[] {
  const events: SessionDossierTimelineEvent[] = [
    ...messages.map((message) => ({
      eventId: message.messageId,
      kind: message.role === "assistant" ? ("assistant" as const) : message.role === "user" ? ("user" as const) : ("session" as const),
      label: message.role,
      observedAt: message.observedAt,
      sourceRef: parseJson(message.sourceRefJson),
      summary: message.text
    })),
    ...tools.map((tool) => ({
      eventId: tool.toolCallId,
      kind: "tool" as const,
      label: tool.status ?? "tool",
      observedAt: tool.startedAt ?? tool.completedAt ?? "",
      sourceRef: tool.sourceRef,
      summary: tool.toolName
    })),
    ...files.map((file) => ({
      eventId: file.fileEffectId,
      kind: "file" as const,
      label: file.effectKind,
      observedAt: file.observedAt,
      sourceRef: file.sourceRef,
      summary: file.displayPath
    })),
    ...checkpoints.map((checkpoint) => ({
      eventId: checkpoint.checkpointId,
      kind: "checkpoint" as const,
      label: checkpoint.checkpointKind,
      observedAt: checkpoint.observedAt,
      sourceRef: parseJson(checkpoint.sourceRefJson),
      summary: checkpoint.summary
    })),
    ...runtimeSignals.map((signal) => ({
      eventId: signal.signalId,
      kind: "runtime_signal" as const,
      label: signal.signalKind,
      observedAt: signal.observedAt,
      sourceRef: parseJson(signal.sourceRefJson),
      summary: signal.title
    })),
    ...attention.map((item, index) => ({
      eventId: `attention:${index}:${item.title}`,
      kind: "attention" as const,
      label: item.severity,
      observedAt: item.observedAt ?? "",
      summary: item.title
    }))
  ];
  return events
    .filter((event) => event.observedAt)
    .toSorted((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(-DOSSIER_TIMELINE_LIMIT);
}

function isMcpIncluded(db: MastheadDatabase, sessionId: string): boolean {
  return sessionMcpAllowed(db, sessionId);
}

function buildCopyableContext(dossier: DossierWithoutReuse, mcpIncluded: boolean): string {
  const summary = contextSummary(dossier);
  const lines = [
    "# Masthead Session Context",
    "",
    `Title: ${dossier.identity.title}`,
    `Project: ${dossier.identity.project ?? "Unknown"}`,
    `Runtime: ${dossier.identity.runtime}`,
    `Model: ${dossier.identity.model ?? "Not captured"}`,
    `Lifecycle: ${dossier.identity.lifecycle}`,
    `Source session: ${dossier.identity.sourceSessionId}`,
    `Canonical session: ${dossier.identity.sessionId}`,
    "",
    summary ? `Summary: ${summary}` : undefined,
    dossier.narrative.latestUserPrompt ? `Latest prompt: ${dossier.narrative.latestUserPrompt}` : undefined,
    "",
    "Files:",
    ...(dossier.files.length > 0 ? dossier.files.slice(0, 12).map((file) => `- ${file.displayPath}`) : ["- None captured"]),
    "",
    "Tools:",
    ...(dossier.tools.length > 0 ? dossier.tools.slice(0, 12).map((tool) => `- ${tool.toolName}: ${tool.status ?? "unknown"}`) : ["- None captured"]),
    "",
    `Verification: ${dossier.verification.status}`,
    `Agent retrieval: ${mcpIncluded ? "included" : "excluded"}`
  ];
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

function contextSummary(dossier: DossierWithoutReuse): string | undefined {
  return (
    dossier.durableEnrichment?.sessionSummary.text ??
    dossier.narrative.finalAssistantMessage ??
    dossier.narrative.liveSummary ??
    dossier.narrative.outcome ??
    dossier.narrative.objective ??
    dossier.identity.title
  );
}

function displayPath(path: string): string {
  if (!isAbsolute(path)) return path;
  const parts = path.split(sep).filter(Boolean);
  return parts.slice(-3).join("/");
}

function durationMs(startedAt: string | null, endedAt: string | null): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const duration = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function preview(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function isWeakSummary(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "codex hook event" || normalized === "runtime signal" || normalized === "tool call" || normalized === "unknown";
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
