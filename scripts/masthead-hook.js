#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveHookRuntime,
  withRuntimeOnIngestUrl
} from "./resolve-hook-runtime.js";

const DEFAULT_URL = "http://127.0.0.1:17373/ingest";
const DEFAULT_TIMEOUT_MS = 750;
const DEFAULT_MAX_BYTES = 256 * 1024;

const isMain = isMainModule();

if (isMain) {
  main().catch(() => {
    process.exit(process.env.MASTHEAD_VERIFY_CONNECTOR === "1" ? 1 : 0);
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

async function main() {
  const verifyConnector = process.env.MASTHEAD_VERIFY_CONNECTOR === "1";
  const maxBytes = Number.parseInt(process.env.MASTHEAD_HOOK_MAX_BYTES || "", 10) || DEFAULT_MAX_BYTES;
  const raw = await readStdin(maxBytes);
  if (!isValidJsonObject(raw)) {
    process.exit(0);
  }
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const resolvedRuntime = resolveHookRuntime({
    env: process.env,
    payload,
    processPath: process.execPath,
    argv: process.argv
  });
  const body = JSON.stringify(redactJsonValue(payload));
  const baseUrl = process.env.MASTHEAD_INGEST_URL || DEFAULT_URL;
  const url = withRuntimeOnIngestUrl(baseUrl, resolvedRuntime);
  const stateUrl = process.env.MASTHEAD_STATE_URL || stateUrlFromIngestUrl(url);
  const timeoutMs = Number.parseInt(process.env.MASTHEAD_HOOK_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;

  try {
    await post(url, body, timeoutMs, resolvedRuntime, verifyConnector);
  } catch (error) {
    if (verifyConnector) throw error;
    // Fail open: hook execution must never block or fail the source session.
  }
  const stateBody = stateReportBody(payload, resolvedRuntime);
  if (stateUrl && stateBody) {
    try {
      await post(stateUrl, JSON.stringify(stateBody), timeoutMs, resolvedRuntime, verifyConnector);
    } catch (error) {
      if (verifyConnector) throw error;
      // Fail open: live state is opportunistic and must not affect hook execution.
    }
  }
  process.exit(0);
}

function readStdin(maxBytes) {
  return new Promise((resolve) => {
    let data = "";
    let bytes = 0;
    let oversized = false;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        oversized = true;
        process.stdin.resume();
        return;
      }
      data += chunk;
    });
    process.stdin.on("end", () => resolve(oversized ? "" : data));
  });
}

function isValidJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function post(target, body, timeoutMs, runtime, requireSuccess = false) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target);
    const client = parsed.protocol === "https:" ? https : http;
    const headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    };
    if (runtime) headers["x-masthead-runtime"] = runtime;
    const request = client.request(
      parsed,
      {
        method: "POST",
        headers,
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if ((response.statusCode || 500) >= 300) {
            reject(new Error(`masthead connector verification returned ${response.statusCode || "unknown status"}`));
            return;
          }
          if (requireSuccess) resolve();
        });
      }
    );
    if (requireSuccess) {
      request.on("timeout", () => {
        request.destroy(new Error("masthead hook timeout"));
      });
    } else {
      request.on("finish", resolve);
    }
    request.on("error", reject);
    request.end(body);
  });
}

function stateUrlFromIngestUrl(ingestUrl) {
  try {
    const parsed = new URL(ingestUrl);
    parsed.pathname = "/live/state";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function stateReportBody(payload, resolvedRuntime) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const runtime = resolvedRuntime || stringValue(payload.runtime) || stringValue(payload.adapter);
  const state = explicitOrImpliedState(payload);
  if (!runtime || !state) return undefined;
  return {
    runtime,
    source: `masthead:${runtime}-hook`,
    sourceSessionId: firstString(payload, ["session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId"]),
    sourceEventId: firstString(payload, ["provider_event_id", "providerEventId", "event_id", "eventId", "hook_event_id", "hookEventId", "id"]),
    state,
    authority: "hook",
    observedAt: firstString(payload, ["timestamp", "occurred_at", "occurredAt", "time", "created_at", "createdAt"]),
    cwd: firstString(payload, ["cwd", "working_directory", "workingDirectory"]),
    repoRoot: firstString(payload, ["workspaceRoot", "repoRoot", "repo_root"]),
    branch: firstString(payload, ["gitBranch", "branch"])
  };
}

function explicitOrImpliedState(payload) {
  const explicit = normalizeState(firstString(payload, ["state", "status", "runtimeState", "lifecycleState"]));
  if (explicit) return explicit;
  const eventName = normalizeEventName(firstString(payload, ["event", "type", "hook_event_name", "hookEventName", "event_name", "eventName"]));
  if (["permissionrequest", "permissiondenied", "approvalrequested", "toolapprovalrequested"].includes(eventName)) return "blocked";
  if (["userpromptsubmit", "beforesubmitprompt", "input", "userinput", "pretooluse", "beforeshellexecution"].includes(eventName)) return "working";
  if (["stop", "sessionstop", "agentend", "sessioncomplete", "sessioncompleted", "sessionstopped"].includes(eventName)) return "idle";
  return undefined;
}

function normalizeState(value) {
  const normalized = normalizeToken(value);
  if (!normalized) return undefined;
  if (["working", "running", "active", "busy", "thinking", "executing"].includes(normalized)) return "working";
  if (["blocked", "waiting_for_approval", "approval_requested", "requires_approval", "permission_requested", "waiting_for_user", "needs_input", "needs_user", "question_requested"].includes(normalized)) return "blocked";
  if (["idle", "ready", "waiting", "done", "complete", "completed", "stopped", "ended"].includes(normalized)) return "idle";
  if (normalized === "unknown") return "unknown";
  return undefined;
}

function normalizeEventName(value) {
  return (value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeToken(value) {
  return (value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstString(input, keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redactText(input) {
  return input
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[SECRET:private_key]")
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [SECRET:bearer_token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [SECRET:bearer_token]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[SECRET:github_token]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[SECRET:api_key]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s'"`]+/gi, "[SECRET:database_url]")
    .replace(/Cookie:\s*[^\n\r]+/gi, "Cookie: [SECRET:cookie]")
    .replace(
      /\b(AWS|GOOGLE|OPENAI|ANTHROPIC|SUPABASE|GITHUB)?_?(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s\n\r]+/gi,
      "[SECRET:env_secret]"
    )
    .replace(
      /(?:^|[\s"'`])(?:--?(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth-token|cookie|credentials?))\b(?:\s*(?:=|\s)\s*[^\s"'`]+)?/gi,
      " [SECRET:cli_flag]"
    )
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[SECRET:credentials]@");
}

function isSensitiveKey(key) {
  const tokens = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return false;
  const sensitive = {
    password: true,
    passwd: true,
    pwd: true,
    secret: true,
    token: true,
    cookie: true,
    cookies: true,
    credential: true,
    credentials: true,
    authorization: true,
    auth: true,
    privatekey: true,
    accesskey: true,
    apikey: true,
    sessioncookie: true,
    setcookie: true
  };
  const keyModifiers = {
    api: true,
    private: true,
    access: true,
    secret: true,
    auth: true,
    session: true
  };
  const compact = tokens.join("");
  if (sensitive[compact]) return true;
  if (tokens.some((token) => sensitive[token])) return true;
  if (tokens.includes("key") && tokens.some((token) => keyModifiers[token])) return true;
  return false;
}

function redactJsonValue(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[SECRET:json_field]" : redactJsonValue(entry);
  }
  return output;
}
