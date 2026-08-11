import { parseJSONRPCMessage, STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { afterEach, describe, expect, test } from "vitest";
import { getMcpLaunchConfig } from "../../daemon/mcpStatusService.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const EXPECTED_TOOL_NAMES = [
  "get_artifact",
  "get_corpus_stats",
  "get_evidence_excerpt",
  "get_evidence_transcript",
  "get_knowledge",
  "get_masthead_coverage",
  "get_project_history",
  "get_provenance",
  "get_session",
  "get_session_excerpt",
  "get_session_transcript",
  "list_knowledge",
  "list_project_sessions",
  "search_artifacts",
  "search_knowledge",
  "search_sessions"
];

const tempDirs: string[] = [];
const clients: StdioTestClient[] = [];

afterEach(async () => {
  const stopped = await Promise.allSettled(clients.splice(0).map((client) => client.stop()));
  const removed = await Promise.allSettled(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  const failures = [...stopped, ...removed]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "MCP test cleanup failed");
});

describe("MCP stdio protocol process", () => {
  test("stdout purity rejects JSON that is not an MCP JSON-RPC message", async () => {
    const invalidLine = JSON.stringify({ message: "not MCP" });
    const child = spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(`${invalidLine}\n`)})`], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new StdioTestClient(child, { enforceStdoutPurity: false });
    clients.push(client);

    await once(child, "close");

    expect(client.invalidStdoutLines).toEqual([invalidLine]);
  });

  test("cleanup rejects non-MCP stdout and identifies the offending line", async () => {
    const validLine = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Expected test error" } });
    const invalidLine = JSON.stringify({ message: "conditional non-MCP stdout" });
    const child = spawn(
      process.execPath,
      [
        "-e",
        `process.stdout.write(${JSON.stringify(`${validLine}\n${invalidLine}\n`)}); setInterval(() => {}, 1_000);`
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const client = new StdioTestClient(child, { enforceStdoutPurity: true });
    await once(child.stdout, "data");

    await expect(client.stop()).rejects.toThrow(`MCP child emitted non-MCP stdout:\n${invalidLine}`);
    expect(child.signalCode).toBe("SIGTERM");
  });

  test("cleanup waits for stdout to drain after child exit", async () => {
    const validLine = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Expected test error" } });
    const invalidLine = JSON.stringify({ message: "non-MCP stdout near shutdown" });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      exitCode: 0,
      kill: () => false,
      signalCode: null,
      stderr,
      stdin: new PassThrough(),
      stdout
    }) as unknown as ChildProcessWithoutNullStreams;
    const client = new StdioTestClient(child, { enforceStdoutPurity: true });
    const drained = once(stdout, "end");
    setImmediate(() => {
      stdout.end(`${validLine}\n${invalidLine}\n`);
      stderr.end();
      child.emit("close", 0, null);
    });

    try {
      await expect(client.stop()).rejects.toThrow(`MCP child emitted non-MCP stdout:\n${invalidLine}`);
    } finally {
      await drained;
    }
  });

  test("discovers modern MCP and stamps server metadata on results", async () => {
    const client = await launchMcp();

    const discovery = await client.request("server/discover", {}, modernMeta());

    expect(discovery).toMatchObject({
      result: {
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "masthead" }
        },
        capabilities: { tools: {} },
        supportedVersions: [MODERN_PROTOCOL_VERSION]
      }
    });
  });

  test("lists and calls tools with modern request and result envelopes", async () => {
    const client = await launchMcp();
    await client.request("server/discover", {}, modernMeta());

    const listed = await client.request("tools/list", {}, modernMeta());
    expect(listed.result?.tools?.map((tool: { name: string }) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
    expect(listed.result?._meta).toMatchObject({
      "io.modelcontextprotocol/serverInfo": { name: "masthead" }
    });

    const called = await client.request(
      "tools/call",
      { arguments: {}, name: "get_masthead_coverage" },
      modernMeta()
    );
    expect(called.result).toMatchObject({
      _meta: {
        "io.modelcontextprotocol/serverInfo": { name: "masthead" }
      },
      isError: false,
      structuredContent: {
        messages: 0,
        projects: 0,
        sessions: 0
      }
    });
    expect(JSON.parse(called.result?.content?.[0]?.text ?? "{}" as string)).toMatchObject({ sessions: 0 });
  });

  test("preserves parameterized artifact retrieval through the real stdio process", async () => {
    const client = await launchMcp();
    await client.request("server/discover", {}, modernMeta());

    const searched = await client.request(
      "tools/call",
      { arguments: { limit: 3, offset: 0, query: "missing artifact" }, name: "search_artifacts" },
      modernMeta()
    );
    expect(searched.result).toMatchObject({
      isError: false,
      structuredContent: { artifacts: [], total: 0 }
    });
    expect(JSON.parse(searched.result?.content?.[0]?.text ?? "{}" as string)).toEqual({ artifacts: [], total: 0 });

    const retrieved = await client.request(
      "tools/call",
      { arguments: { artifactId: "artifact:missing" }, name: "get_artifact" },
      modernMeta()
    );
    expect(retrieved.result).toMatchObject({
      isError: false,
      structuredContent: { artifact: null }
    });
    expect(JSON.parse(retrieved.result?.content?.[0]?.text ?? "{}" as string)).toEqual({ artifact: null });
  });

  test("rejects unsupported modern versions with the specified error", async () => {
    const client = await launchMcp();

    const response = await client.request("tools/list", {}, modernMeta("2099-01-01"));

    expect(response).toMatchObject({
      error: {
        code: -32022,
        data: {
          requested: "2099-01-01",
          supported: [MODERN_PROTOCOL_VERSION]
        }
      }
    });
  });

  test("retains legacy initialize, tool listing, and tool calls", async () => {
    const client = await launchMcp();

    const initialized = await client.request("initialize", {
      capabilities: {},
      clientInfo: { name: "masthead-test-legacy", version: "1.0.0" },
      protocolVersion: "2024-11-05"
    });
    expect(initialized).toMatchObject({
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "masthead" }
      }
    });

    const listed = await client.request("tools/list", {});
    expect(listed.result?.tools?.map((tool: { name: string }) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);

    const called = await client.request("tools/call", { arguments: {}, name: "get_masthead_coverage" });
    expect(JSON.parse(called.result?.content?.[0]?.text ?? "{}" as string)).toMatchObject({ sessions: 0 });
  });

  test("survives malformed input without emitting non-MCP stdout", async () => {
    const client = await launchMcp();
    const parseError = client.waitForResponse(null);
    client.writeRaw("{not-json\n");

    const response = await parseError;
    expect(response).toMatchObject({
      error: { code: -32700 },
      jsonrpc: "2.0"
    });
    expect(response).not.toHaveProperty("id");
    const discovery = await client.request("server/discover", {}, modernMeta());

    expect(discovery.result?.supportedVersions).toEqual([MODERN_PROTOCOL_VERSION]);
    expect(client.invalidStdoutLines).toEqual([]);
  });

  test("rejects structurally invalid JSON-RPC and continues", async () => {
    const client = await launchMcp();
    const invalidRequest = client.waitForResponse(null);
    client.writeRaw(`${JSON.stringify({ id: 7, jsonrpc: "2.0", params: {} })}\n`);

    const response = await invalidRequest;
    expect(response).toMatchObject({
      error: { code: -32600 },
      jsonrpc: "2.0"
    });
    expect(response).not.toHaveProperty("id");
    const discovery = await client.request("server/discover", {}, modernMeta());
    expect(discovery.result?.supportedVersions).toEqual([MODERN_PROTOCOL_VERSION]);
  });

  test("rejects a framed line larger than the 10 MiB input bound", async () => {
    const client = await launchMcp();
    client.writeRaw(`${JSON.stringify("x".repeat(STDIO_DEFAULT_MAX_BUFFER_SIZE))}\n`);

    await client.closeInput();

    expect(client.stderrText).toContain(`exceeded ${STDIO_DEFAULT_MAX_BUFFER_SIZE} bytes`);
  });

  test("applies the 10 MiB input bound to each frame in a shared write", async () => {
    const client = await launchMcp();
    const discoveryRequest = {
      id: 41,
      jsonrpc: "2.0",
      method: "server/discover",
      params: {
        _meta: {
          ...modernMeta(),
          "com.masthead/padding": ""
        }
      }
    };
    const emptyDiscoveryLine = JSON.stringify(discoveryRequest);
    discoveryRequest.params._meta["com.masthead/padding"] = "x".repeat(
      STDIO_DEFAULT_MAX_BUFFER_SIZE - Buffer.byteLength(emptyDiscoveryLine) - 64
    );
    const discoveryLine = JSON.stringify(discoveryRequest);
    const listLine = JSON.stringify({
      id: 42,
      jsonrpc: "2.0",
      method: "tools/list",
      params: { _meta: modernMeta() }
    });
    const discovery = client.waitForResponse(41, "near-limit discovery");
    const listed = client.waitForResponse(42, "tools/list after near-limit discovery");

    expect(Buffer.byteLength(discoveryLine)).toBeLessThanOrEqual(STDIO_DEFAULT_MAX_BUFFER_SIZE);
    expect(Buffer.byteLength(`${discoveryLine}\n${listLine}\n`)).toBeGreaterThan(STDIO_DEFAULT_MAX_BUFFER_SIZE);
    client.writeRaw(`${discoveryLine}\n${listLine}\n`);

    await expect(discovery).resolves.toMatchObject({ result: { supportedVersions: [MODERN_PROTOCOL_VERSION] } });
    await expect(listed).resolves.toMatchObject({ result: { tools: expect.any(Array) } });
  });

  test("shuts down cleanly when the client closes stdin", async () => {
    const client = await launchMcp();
    await client.request("server/discover", {}, modernMeta());

    await expect(client.closeInput()).resolves.toBe(0);
    expect(client.invalidStdoutLines).toEqual([]);
  });
});

function modernMeta(protocolVersion = MODERN_PROTOCOL_VERSION): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "masthead-test-modern", version: "1.0.0" },
    "io.modelcontextprotocol/protocolVersion": protocolVersion
  };
}

async function launchMcp(): Promise<StdioTestClient> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-stdio-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const db = await openMastheadDatabase(databasePath);
  migrateDatabase(db);
  db.close();

  const launch = getMcpLaunchConfig(databasePath);
  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: { ...launch.env, PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const client = new StdioTestClient(child, { enforceStdoutPurity: true });
  clients.push(client);
  return client;
}

type JsonRpcResponse = {
  id?: string | number | null;
  result?: Record<string, any>;
  error?: { code?: number; data?: Record<string, any>; message?: string };
};

class StdioTestClient {
  readonly invalidStdoutLines: string[] = [];
  private readonly closedAndDrained: Promise<void>;
  private readonly responses = new Map<string | number | null, JsonRpcResponse>();
  private readonly waiters = new Map<string | number | null, (response: JsonRpcResponse) => void>();
  private stdoutBuffer = "";
  private stderr = "";
  private nextId = 1;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: { enforceStdoutPurity: boolean }
  ) {
    const childClosed = new Promise<void>((resolve) => {
      if (this.hasExited() && child.stdout.closed && child.stderr.closed) {
        resolve();
        return;
      }
      child.once("close", () => resolve());
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
    this.closedAndDrained = Promise.all([
      childClosed,
      finished(child.stdout, { cleanup: true })
    ]).then(() => undefined);
    this.closedAndDrained.catch(() => {});
  }

  get stderrText(): string {
    return this.stderr;
  }

  request(method: string, params: Record<string, unknown>, meta?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const response = this.waitForResponse(id, method);
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: meta ? { ...params, _meta: meta } : params })}\n`);
    return response;
  }

  waitForResponse(id: string | number | null, label = String(id)): Promise<JsonRpcResponse> {
    const buffered = this.responses.get(id);
    if (buffered) {
      this.responses.delete(id);
      return Promise.resolve(buffered);
    }
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`Timed out waiting for ${label}; stderr=${this.readStderr()}`));
      }, 5_000);
      this.waiters.set(id, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
  }

  writeRaw(value: string): void {
    this.child.stdin.write(value);
  }

  async closeInput(): Promise<number | null> {
    if (!this.hasExited() && !this.child.stdin.destroyed) this.child.stdin.end();
    if (!await this.waitForCloseAndDrain(3_000)) {
      throw new Error(`MCP server did not close after stdin closed; stderr=${this.readStderr()}`);
    }
    return this.child.exitCode;
  }

  async stop(): Promise<void> {
    if (!this.hasExited()) this.child.kill("SIGTERM");
    if (!await this.waitForCloseAndDrain(1_000)) {
      if (!this.hasExited()) this.child.kill("SIGKILL");
      if (!await this.waitForCloseAndDrain(1_000)) {
        throw new Error(`MCP child did not close during cleanup; stderr=${this.readStderr()}`);
      }
    }
    if (this.options.enforceStdoutPurity && this.invalidStdoutLines.length > 0) {
      throw new Error(`MCP child emitted non-MCP stdout:\n${this.invalidStdoutLines.join("\n")}`);
    }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      newline = this.stdoutBuffer.indexOf("\n");
      if (!line) continue;
      try {
        const message = parseJSONRPCMessage(JSON.parse(line));
        if (!("id" in message) && !("error" in message)) continue;
        const response = message as JsonRpcResponse;
        const id = response.id ?? null;
        const waiter = this.waiters.get(id);
        if (waiter) {
          this.waiters.delete(id);
          waiter(response);
        } else {
          this.responses.set(id, response);
        }
      } catch {
        this.invalidStdoutLines.push(line);
      }
    }
  }

  private readStderr(): string {
    return this.stderr;
  }

  private hasExited(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }

  private waitForCloseAndDrain(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs);
      this.closedAndDrained.then(
        () => {
          clearTimeout(timeout);
          resolve(true);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
}
