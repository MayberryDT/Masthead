#!/usr/bin/env node
import http from "node:http";
import https from "node:https";

const DEFAULT_URL = "http://127.0.0.1:17373/ingest";
const DEFAULT_TIMEOUT_MS = 750;
const DEFAULT_MAX_BYTES = 256 * 1024;

main().catch(() => {
  process.exit(0);
});

async function main() {
  const maxBytes = Number.parseInt(process.env.MASTHEAD_HOOK_MAX_BYTES || "", 10) || DEFAULT_MAX_BYTES;
  const raw = await readStdin(maxBytes);
  if (!isValidJsonObject(raw)) {
    process.exit(0);
  }
  const body = redactText(raw);
  const url = process.env.MASTHEAD_INGEST_URL || DEFAULT_URL;
  const timeoutMs = Number.parseInt(process.env.MASTHEAD_HOOK_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;

  try {
    await post(url, body, timeoutMs);
  } catch {
    // Fail open: Codex hook execution must never block or fail the source session.
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

function post(target, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error("masthead hook timeout"));
    });
    request.on("error", reject);
    request.end(body);
  });
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
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[SECRET:credentials]@");
}
