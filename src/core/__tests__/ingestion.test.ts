import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, test } from "vitest";
import { createIngestionState, ingestCodexHookPayload } from "../ingestion";

const hookScript = new URL("../../../scripts/masthead-hook.js", import.meta.url);

const hookPayload = {
  provider_event_id: "codex-provider-duplicate",
  event: "session_started",
  session_id: "codex-session-duplicate",
  timestamp: "2026-06-23T02:12:00.000Z",
  cwd: "/workspace/masthead",
  project: "Masthead",
  title: "Hook ingestion"
};

describe("hook ingestion", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
    servers.length = 0;
  });

  test("dedupes duplicate provider events", () => {
    const state = createIngestionState();
    const first = ingestCodexHookPayload(JSON.stringify(hookPayload), state, {
      receivedAt: "2026-06-23T02:12:00.100Z"
    });
    const second = ingestCodexHookPayload(JSON.stringify(hookPayload), state, {
      receivedAt: "2026-06-23T02:12:00.200Z"
    });

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    expect(state.events).toHaveLength(1);
    expect(state.diagnostics).toHaveLength(0);
  });

  test("records malformed JSON diagnostics instead of accepting an event", () => {
    const state = createIngestionState();
    const result = ingestCodexHookPayload("{ bad json", state, {
      receivedAt: "2026-06-23T02:13:00.000Z"
    });

    expect(result.status).toBe("malformed");
    expect(state.events).toHaveLength(0);
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toMatchObject({
      code: "malformed_json",
      receivedAt: "2026-06-23T02:13:00.000Z"
    });
  });

  test("hook helper redacts stdin, posts to loopback, and exits zero", async () => {
    let received = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        received += chunk;
      });
      request.on("end", () => {
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected tcp server");

    const exitCode = await runHook(JSON.stringify({
      ...hookPayload,
      command: "curl -H 'Authorization: Bearer secret-token-value' https://example.test"
    }), {
      MASTHEAD_INGEST_URL: `http://127.0.0.1:${address.port}/ingest`,
      MASTHEAD_HOOK_TIMEOUT_MS: "500"
    });

    expect(exitCode).toBe(0);
    expect(received).toContain("[SECRET:bearer_token]");
    expect(received).not.toContain("secret-token-value");
  });

  test("hook helper exits zero when Masthead is unavailable", async () => {
    const exitCode = await runHook(JSON.stringify(hookPayload), {
      MASTHEAD_INGEST_URL: "http://127.0.0.1:9/ingest",
      MASTHEAD_HOOK_TIMEOUT_MS: "50"
    });

    expect(exitCode).toBe(0);
  });

  test("hook helper validates JSON before posting and still exits zero", async () => {
    const { posted, exitCode } = await runHookWithServer("{ bad json", {
      MASTHEAD_HOOK_TIMEOUT_MS: "500"
    });

    expect(exitCode).toBe(0);
    expect(posted()).toHaveLength(0);
  });

  test("hook helper drops oversized input before posting and still exits zero", async () => {
    const oversized = JSON.stringify({ ...hookPayload, padding: "x".repeat(128) });
    const { posted, exitCode } = await runHookWithServer(oversized, {
      MASTHEAD_HOOK_MAX_BYTES: "64",
      MASTHEAD_HOOK_TIMEOUT_MS: "500"
    });

    expect(exitCode).toBe(0);
    expect(posted()).toHaveLength(0);
  });
});

async function runHookWithServer(
  stdin: string,
  env: Record<string, string>
): Promise<{ posted: () => string[]; exitCode: number | null }> {
  const received: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push(body);
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected tcp server");

  const exitCode = await runHook(stdin, {
    ...env,
    MASTHEAD_INGEST_URL: `http://127.0.0.1:${address.port}/ingest`
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return {
    exitCode,
    posted: () => [...received]
  };
}

async function runHook(stdin: string, env: Record<string, string>): Promise<number | null> {
  const child = spawn(process.execPath, [hookScript.pathname], {
    env: {
      ...process.env,
      ...env
    },
    stdio: ["pipe", "ignore", "ignore"]
  });
  child.stdin.end(stdin);
  const [code] = (await once(child, "exit")) as [number | null];
  return code;
}
