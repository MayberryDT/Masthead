import type { EventType } from "../../core/types.ts";
import type { RuntimeKind } from "../types.ts";

export type LiveRuntimeProfile = {
  runtime: RuntimeKind;
  label: string;
  surface: "hook" | "plugin";
  sourceName: string;
  includeRuntimePayloadMetadata?: boolean;
  sessionIdKeys: string[];
  eventNameKeys: string[];
  timestampKeys: string[];
  workspaceKeys: {
    cwd: string[];
    repoRoot: string[];
    branch: string[];
  };
  eventMap: Record<string, EventType>;
  runtimeStateKeys?: string[];
  runtimeStateMap?: Record<string, "running" | "idle" | "blocked">;
};

const DEFAULT_RUNTIME_STATE_KEYS = ["state", "status", "runtimeState", "lifecycleState"];
const DEFAULT_RUNTIME_STATE_MAP = {
  active: "running",
  working: "running",
  running: "running",
  busy: "running",
  thinking: "running",
  executing: "running",
  idle: "idle",
  logged: "idle",
  ready: "idle",
  waiting: "idle",
  blocked: "blocked",
  done: "idle",
  completed: "idle",
  complete: "idle",
  stopped: "idle",
  ended: "idle"
} satisfies NonNullable<LiveRuntimeProfile["runtimeStateMap"]>;

export const LIVE_RUNTIME_PROFILES: Partial<Record<RuntimeKind, LiveRuntimeProfile>> = {
  codex: {
    runtime: "codex",
    label: "Codex",
    surface: "hook",
    sourceName: "codex.hook",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"],
    eventNameKeys: ["event", "type", "hook_event_name", "hookEventName", "event_name", "eventName"],
    timestampKeys: ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd", "working_directory", "workingDirectory"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["gitBranch", "branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.response",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissionrequest: "approval.requested",
      permissiondenied: "approval.requested",
      stop: "turn.completed",
      sessionend: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  cursor: {
    runtime: "cursor",
    label: "Cursor",
    surface: "hook",
    sourceName: "cursor.hook",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id", "chatId", "chat_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd", "workspace"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      beforesubmitprompt: "user.response",
      beforeshellexecution: "command.started",
      aftershellexecution: "command.finished",
      afterfileedit: "file.changed",
      afteragentresponse: "session.started",
      stop: "turn.completed",
      sessionend: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  claude_code: {
    runtime: "claude_code",
    label: "Claude Code",
    surface: "hook",
    sourceName: "claude_code.hook",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["gitBranch", "branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.response",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "turn.completed",
      sessionend: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  opencode: {
    runtime: "opencode",
    label: "OpenCode",
    surface: "plugin",
    sourceName: "opencode.plugin",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionID", "sessionId", "session_id"],
    eventNameKeys: ["type", "event", "name"],
    timestampKeys: ["time", "timestamp", "createdAt"],
    workspaceKeys: {
      cwd: ["directory", "cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessioncreated: "session.started",
      sessionstatus: "session.started",
      sessionidle: "session.started",
      messageupdated: "session.started",
      chatmessage: "session.started",
      sessionmessage: "session.started",
      permissionasked: "approval.requested",
      toolexecutebefore: "command.started",
      toolexecuteafter: "command.finished",
      sessioncomplete: "turn.completed",
      sessioncompleted: "turn.completed",
      sessionstopped: "turn.completed",
      sessionended: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  grok: {
    runtime: "grok",
    label: "Grok Build",
    surface: "hook",
    sourceName: "grok.hook",
    includeRuntimePayloadMetadata: true,
    // Prefer stable conversation ids; Grok may also emit sessionId on every hook.
    sessionIdKeys: ["sessionId", "session_id", "conversation_id", "conversationId", "thread_id", "threadId"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt", "created_at", "occurred_at", "occurredAt"],
    workspaceKeys: {
      cwd: ["cwd", "working_directory", "workingDirectory"],
      repoRoot: ["workspaceRoot", "repoRoot", "git_root_dir", "gitRootDir"],
      branch: ["branch", "gitBranch", "head_branch", "headBranch"]
    },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.response",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "turn.completed",
      stopfailure: "turn.completed",
      sessionend: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  hermes: {
    runtime: "hermes",
    label: "Hermes",
    surface: "plugin",
    sourceName: "hermes.plugin",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id", "sessionID", "id"],
    eventNameKeys: ["type", "event", "name", "hookEventName", "hook_event_name", "state", "status"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["directory", "cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      sessioncreated: "session.started",
      agentstart: "session.started",
      input: "user.response",
      userinput: "user.response",
      message: "user.response",
      approvalrequested: "approval.requested",
      approvalresolved: "approval.resolved",
      permissionrequested: "approval.requested",
      toolstart: "command.started",
      toolstarted: "command.started",
      toolexecutionstart: "command.started",
      toolfinish: "command.finished",
      toolfinished: "command.finished",
      toolexecutionend: "command.finished",
      sessionstop: "turn.completed",
      sessioncompleted: "turn.completed",
      sessionend: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  pi: {
    runtime: "pi",
    label: "Pi",
    surface: "plugin",
    sourceName: "pi.extension",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id", "sessionID", "id"],
    eventNameKeys: ["type", "event", "hookEventName", "hook_event_name", "state", "status"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      agentstart: "session.started",
      input: "user.response",
      beforeagentstart: "turn.started",
      toolapprovalrequested: "approval.requested",
      toolapprovalresolved: "approval.resolved",
      approvalrequested: "approval.requested",
      approvalresolved: "approval.resolved",
      toolcall: "command.started",
      toolexecutionstart: "command.started",
      toolresult: "command.finished",
      toolexecutionend: "command.finished",
      sessionstop: "turn.completed",
      agentend: "turn.completed",
      sessionshutdown: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  },
  omp: {
    runtime: "omp",
    label: "Oh My Pi",
    surface: "plugin",
    sourceName: "omp.extension",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id", "sessionID"],
    eventNameKeys: ["type", "event", "hookEventName", "hook_event_name"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      agentstart: "session.started",
      input: "user.response",
      beforeagentstart: "turn.started",
      toolapprovalrequested: "approval.requested",
      toolapprovalresolved: "approval.resolved",
      toolcall: "command.started",
      toolexecutionstart: "command.started",
      toolresult: "command.finished",
      toolexecutionend: "command.finished",
      sessionstop: "turn.completed",
      agentend: "turn.completed",
      sessionshutdown: "session.closed"
    },
    runtimeStateKeys: DEFAULT_RUNTIME_STATE_KEYS,
    runtimeStateMap: DEFAULT_RUNTIME_STATE_MAP
  }
};
