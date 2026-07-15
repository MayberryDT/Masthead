import type { WorkbenchQueueSessionDto } from "../../shared/workbench";

const FORBIDDEN_HANDOFF_SUBSTRINGS = [
  ["mast", "head", "ctl"].join(""),
  ["np", "m", " run"].join(""),
  ["out", "put", ".json"].join(""),
  ["sch", "ema", ".json"].join(""),
  ["app", "ly", ".sh"].join("")
] as const;

export function sanitizeWorkbenchVisibleText(value: string | undefined): string {
  return FORBIDDEN_HANDOFF_SUBSTRINGS.reduce((text, token) => {
    const pattern = new RegExp(escapeRegExp(token), "gi");
    return text.replace(pattern, "[redacted]");
  }, value ?? "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildWorkbenchHandoff(input: {
  authoringCommand: string;
  databaseId: string;
  sessionIds: string[];
  sessions: WorkbenchQueueSessionDto[];
}): string {
  const sessionIds = [...new Set(input.sessionIds)];
  const machineRequest = {
    protocol: "masthead.workbench.authoring/v1",
    bundleVersion: "workbench-authoring-v3",
    capability: "artifact_authoring",
    databaseId: input.databaseId,
    transport: "daemon_http",
    sessionIds,
    maxSessionsPerRun: 12,
    authoringTool: {
      command: input.authoringCommand,
      kind: "cli"
    }
  };

  const metadataById = new Map(input.sessions.map((session) => [session.sessionId, session]));
  const rows = sessionIds.flatMap((sessionId) => {
    const session = metadataById.get(sessionId);
    if (!session) return [];
    return [`- ${sanitizeWorkbenchVisibleText(session.title)} (${sanitizeWorkbenchVisibleText(sessionId)})`];
  });
  const partitionInstruction = sessionIds.length > 12
    ? "More than 12 sessions are selected; partition them into bounded runs of at most 12 sessions while preserving related-session groups and completing every selected session exactly once."
    : "Keep this request within one bounded run of at most 12 sessions.";

  return [
    "Complete this Masthead Workbench request for every selected session.",
    "Enrich each session before publishing its dossier. Preserve Masthead's canonical dossier structure; improve the underlying title, summary, outcome, decisions, verification, reuse guidance, and other supported enrichment from evidence.",
    "Create only the runbooks, ADRs, or incident timelines that your judgment finds genuinely reusable. Masthead may provide nonbinding suggestions; verify them against the complete canonical evidence, ignore weak suggestions, and create a different supported kind when warranted.",
    "Revise deterministic validation findings until accepted, finish publication, and report the published artifacts.",
    partitionInstruction,
    "",
    "Machine request:",
    JSON.stringify(machineRequest),
    "",
    "Selected session metadata (machine request sessionIds are authoritative):",
    ...rows
  ].join("\n");
}
