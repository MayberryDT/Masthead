#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { verifyMastheadHookConfig } from "../src/core/hookAdmin.ts";

const healthUrl = process.env.MASTHEAD_HEALTH_URL || "http://127.0.0.1:17373/health";
const hookConfigPath = process.env.MASTHEAD_CODEX_HOOKS || join(homedir(), ".codex/hooks.json");
const results = [];

results.push(await checkCollector());
results.push(await checkHooks());

for (const result of results) {
  console.log(`${result.ok ? "ok" : "fail"} ${result.label}: ${result.message}`);
}
console.log("note Codex hook trust still has to be reviewed in Codex with /hooks after config changes.");

process.exitCode = results.every((result) => result.ok) ? 0 : 1;

async function checkCollector() {
  try {
    const response = await fetch(healthUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return { ok: false, label: "collector", message: `${healthUrl} returned ${response.status}` };
    }
    const body = await response.json();
    return {
      ok: true,
      label: "collector",
      message: `${body.events ?? 0} events, ${body.gitSnapshots ?? 0} git snapshots, store ${body.storePath ?? "unknown"}`
    };
  } catch (error) {
    return {
      ok: false,
      label: "collector",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkHooks() {
  try {
    const raw = await readFile(hookConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    const verified = verifyMastheadHookConfig(parsed);
    if (!verified.installed) {
      return {
        ok: false,
        label: "codex hooks",
        message: `missing ${verified.missingEvents.join(", ") || "none"}; mismatched ${verified.mismatchedEvents.join(", ") || "none"}`
      };
    }
    return {
      ok: true,
      label: "codex hooks",
      message: `installed in ${hookConfigPath}`
    };
  } catch (error) {
    return {
      ok: false,
      label: "codex hooks",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
