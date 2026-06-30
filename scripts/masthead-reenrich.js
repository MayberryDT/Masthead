#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.MASTHEAD_URL || "http://127.0.0.1:17373";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const baseUrl = normalizeBaseUrl(options.url ?? DEFAULT_BASE_URL);
  const response = await fetch(`${baseUrl}/enrichment/rebuild`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.body)
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Re-enrichment failed with HTTP ${response.status}`);
  }
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
}

function parseArgs(args) {
  const body = { scope: "recent", limit: 100 };
  let url;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return { body, help: true, url };
    const value = args[index + 1];
    if (arg === "--url") {
      if (!value) throw new Error("Missing value for --url");
      url = value;
      index += 1;
    } else if (arg === "--recent") {
      if (!value) throw new Error("Missing value for --recent");
      body.scope = "recent";
      body.limit = parsePositiveInteger(value, "--recent");
      index += 1;
    } else if (arg === "--session") {
      if (!value) throw new Error("Missing value for --session");
      body.scope = "session";
      body.sessionId = value;
      index += 1;
    } else if (arg === "--project") {
      if (!value) throw new Error("Missing value for --project");
      body.scope = "project";
      body.project = value;
      index += 1;
    } else if (arg === "--runtime") {
      if (!value) throw new Error("Missing value for --runtime");
      body.scope = "runtime";
      body.runtime = value;
      index += 1;
    } else if (arg === "--all") {
      body.scope = "all";
    } else if (arg === "--limit") {
      if (!value) throw new Error("Missing value for --limit");
      body.limit = parsePositiveInteger(value, "--limit");
      index += 1;
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return { body, url };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/masthead-reenrich.js [options]

Options:
  --url <url>         Daemon base or projection URL (default: ${DEFAULT_BASE_URL})
  --recent <limit>    Re-enrich newest N sessions
  --session <id>      Re-enrich one canonical or source session id
  --project <label>   Re-enrich sessions for one project label
  --runtime <kind>    Re-enrich sessions for one runtime id or kind
  --all               Re-enrich newest sessions across all scopes
  --limit <number>    Limit for --all/project/runtime (default: 100)
  --help              Show this help
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
