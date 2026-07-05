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
};

export const LIVE_RUNTIME_PROFILES: Partial<Record<RuntimeKind, LiveRuntimeProfile>> = {
  codex: {
    runtime: "codex",
    label: "Codex",
    surface: "hook",
    sourceName: "codex.hook",
    sessionIdKeys: ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"],
    eventNameKeys: ["event", "type", "hook_event_name", "hookEventName", "event_name", "eventName"],
    timestampKeys: ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd", "working_directory", "workingDirectory"],
      repoRoot: ["repo_root", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {}
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
      userpromptsubmit: "user.question",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "session.completed",
      sessionend: "session.completed"
    }
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
      beforesubmitprompt: "user.question",
      beforeshellexecution: "command.started",
      aftershellexecution: "command.finished",
      afterfileedit: "file.changed",
      afteragentresponse: "session.started",
      stop: "session.completed",
      sessionend: "session.completed"
    }
  },
  grok: {
    runtime: "grok",
    label: "Grok Build",
    surface: "hook",
    sourceName: "grok.hook",
    includeRuntimePayloadMetadata: true,
    sessionIdKeys: ["sessionId", "session_id"],
    eventNameKeys: ["hookEventName", "hook_event_name", "event", "type"],
    timestampKeys: ["timestamp", "time", "createdAt"],
    workspaceKeys: {
      cwd: ["cwd"],
      repoRoot: ["workspaceRoot", "repoRoot"],
      branch: ["branch"]
    },
    eventMap: {
      sessionstart: "session.started",
      userpromptsubmit: "user.question",
      pretooluse: "command.started",
      posttooluse: "command.finished",
      posttoolusefailure: "command.finished",
      permissiondenied: "approval.requested",
      stop: "session.completed",
      stopfailure: "session.completed",
      sessionend: "session.completed"
    }
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
      sessionidle: "session.completed",
      messageupdated: "session.started",
      chatmessage: "session.started",
      sessionmessage: "session.started",
      permissionasked: "approval.requested",
      toolexecutebefore: "command.started",
      toolexecuteafter: "command.finished"
    }
  }
};
