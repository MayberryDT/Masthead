#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  dogfoodExitCode,
  evaluateDogfoodAcceptance,
  evaluateLiveDogfoodAcceptance,
  formatDogfoodReport
} from "../src/core/dogfood.ts";

const args = process.argv.slice(2);
const liveIndex = args.indexOf("--live");
const liveUrl = liveIndex === -1 ? undefined : args[liveIndex + 1] ?? "http://127.0.0.1:17373/projection";
const fixturePath = resolve(process.cwd(), args[0] ?? "fixtures/v0/replay-three-sessions-board.json");

const report = liveUrl ? await loadAndEvaluateLive(liveUrl) : await loadAndEvaluateFixture(fixturePath);
process.stdout.write(formatDogfoodReport(report));
process.stdout.write("\nCodex session data loop: docs/acceptance/codex-session-data-loop.md\n");
process.exitCode = dogfoodExitCode(report);

async function loadAndEvaluateFixture(path) {
  try {
    const fixture = JSON.parse(await readFile(path, "utf8"));
    return evaluateDogfoodAcceptance(fixture);
  } catch (error) {
    return failedLoadReport(path, error);
  }
}

async function loadAndEvaluateLive(url) {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`live projection returned ${response.status}`);
    return evaluateLiveDogfoodAcceptance(await response.json());
  } catch (error) {
    return failedLiveReport(url, error);
  }
}

function failedLoadReport(path, error) {
  return {
    ok: false,
    summary: {
      sessions: 0,
      attentionItems: 0,
      failedCommandEvidence: 0,
      exactFileConflicts: 0,
      unrelatedRepoHardConflicts: 0,
      degradedAttribution: false,
      privacySuppressed: false,
      maxAttentionLatencyMs: null
    },
    gates: [
      {
        id: "fixture_sessions",
        ok: false,
        label: "fixture could not be loaded",
        details: {
          fixturePath: path,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    ]
  };
}

function failedLiveReport(url, error) {
  return {
    ok: false,
    summary: {
      sessions: 0,
      attentionItems: 0,
      failedCommandEvidence: 0,
      exactFileConflicts: 0,
      unrelatedRepoHardConflicts: 0,
      degradedAttribution: false,
      privacySuppressed: false,
      maxAttentionLatencyMs: null
    },
    gates: [
      {
        id: "live_source",
        ok: false,
        label: "live projection could not be loaded",
        details: {
          liveUrl: url,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    ]
  };
}
