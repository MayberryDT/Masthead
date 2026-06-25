#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const statePath = resolve(".masthead/smoke-import-state.json");
let id = 0;
let databasePath = process.env.MASTHEAD_DB_PATH;

if (!databasePath) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (typeof state.databasePath === "string" && state.databasePath.trim()) databasePath = state.databasePath;
  } catch (error) {
    throw new Error(`MCP smoke requires ${statePath}. Run npm run smoke:import first or set MASTHEAD_DB_PATH.`, { cause: error });
  }
}

if (!databasePath) {
  throw new Error(`MCP smoke requires a smoke database path. Run npm run smoke:import first or set MASTHEAD_DB_PATH.`);
}

const mcp = spawn(process.execPath, ["dist/daemon/src/mcp/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
  stdio: ["pipe", "pipe", "pipe"]
});

try {
  const initialized = await rpc(mcp, "initialize", {});
  assert(initialized.result?.serverInfo?.name === "masthead", "initialize failed");
  const tools = await rpc(mcp, "tools/list", {});
  const toolNames = new Set(tools.result.tools.map((tool) => tool.name));
  assert(toolNames.has("search_sessions"), "search_sessions missing");
  assert(toolNames.has("get_session"), "get_session missing");
  assert(toolNames.has("get_session_excerpt"), "get_session_excerpt missing");

  const search = await callTool(mcp, "search_sessions", { query: "Logbook", limit: 5 });
  assert(search.sessions.length > 0, "MCP search returned no sessions");
  assert(search.sessions[0].sourceRefs?.length > 0, "MCP search missing source refs");
  const sessionId = search.sessions[0].sessionId;
  const session = await callTool(mcp, "get_session", { sessionId, maxBytes: 4_000 });
  assert(session.sourceRefs?.length > 0, "MCP session missing source refs");
  const excerpt = await callTool(mcp, "get_session_excerpt", { sessionId, query: "Logbook", maxBytes: 512 });
  assert(excerpt.sourceRefs?.length > 0, "MCP excerpt missing source refs");
  assert(Buffer.byteLength(excerpt.text, "utf8") <= 512 + 128, "MCP excerpt exceeded response bound");
  console.log(`Masthead MCP smoke passed. DB: ${databasePath}`);
} finally {
  await stopProcess(mcp);
}

function rpc(process, method, params) {
  return sendLine(process, { jsonrpc: "2.0", id: nextId(), method, params });
}

async function callTool(process, name, args) {
  const response = await rpc(process, "tools/call", { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  assert(typeof text === "string", `${name} returned no text content`);
  return JSON.parse(text);
}

function nextId() {
  id += 1;
  return id;
}

function sendLine(process, payload) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`MCP timeout waiting for ${payload.method}`)), 8_000);
    const onData = (chunk) => {
      output += chunk.toString();
      const lines = output.split("\n").filter(Boolean);
      if (lines.length === 0) return;
      cleanup();
      resolve(JSON.parse(lines[0]));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      process.stdout.off("data", onData);
      process.off("error", onError);
    };
    process.stdout.on("data", onData);
    process.on("error", onError);
    process.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
