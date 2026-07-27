import { MastheadAuthoringClient, MastheadAuthoringClientError } from "./authoringClient.ts";
import { errorResult, jsonResult, textResult, type CliResult } from "./output.ts";

export type WorkbenchCliOptions = {
  env?: NodeJS.ProcessEnv;
};

const authoringCommands = new Set(["capabilities", "status", "context", "evidence"]);
const retiredAuthoringCommands = new Set(["suggestions", "open", "submit", "finish"]);
const recoveryCommands = new Set([
  "audit-v1-generation",
  "prepare-v1-recovery",
  "invalidate-v1-generation",
  "restore-v1-recovery",
  "audit-v3-template-generation",
  "prepare-v3-template-recovery",
  "invalidate-v3-template-generation",
  "restore-v3-template-recovery",
  "audit-v5-quality-corpus",
  "prepare-v5-quality-corpus",
  "invalidate-v5-quality-corpus"
]);
const evidenceKinds = new Set(["all", "user", "assistant", "tools", "checkpoints", "files", "signals"]);

export async function runWorkbenchAuthoringCli(args: string[], options: WorkbenchCliOptions = {}): Promise<CliResult> {
  const command = args[0];
  const json = args.includes("--json");
  if (!command || command === "--help" || command === "help") return textResult(workbenchHelp());

  if (command === "wipe-published") {
    const { runWipePublishedMaintenance } = await import("./workbenchMaintenance.ts");
    return runWipePublishedMaintenance(args, options, json);
  }
  if (command === "author") {
    const { runGuidedAuthoringCli } = await import("./guidedAuthoring.ts");
    return runGuidedAuthoringCli(args.slice(1), options);
  }
  if (recoveryCommands.has(command)) {
    if (command.includes("v5-quality")) {
      const { runV5QualityCorpusMaintenance } = await import("./workbenchMaintenance.ts");
      return runV5QualityCorpusMaintenance(
        command as "audit-v5-quality-corpus" | "prepare-v5-quality-corpus" | "invalidate-v5-quality-corpus",
        args,
        options,
        json
      );
    }
    if (command.includes("v3-template")) {
      const { runFailedV3TemplateRecoveryMaintenance } = await import("./workbenchMaintenance.ts");
      return runFailedV3TemplateRecoveryMaintenance(
        command as "audit-v3-template-generation" | "prepare-v3-template-recovery" |
          "invalidate-v3-template-generation" | "restore-v3-template-recovery",
        args,
        options,
        json
      );
    }
    const { runFailedV1RecoveryMaintenance } = await import("./workbenchMaintenance.ts");
    return runFailedV1RecoveryMaintenance(
      command as "audit-v1-generation" | "prepare-v1-recovery" | "invalidate-v1-generation" | "restore-v1-recovery",
      args,
      options,
      json
    );
  }
  if (retiredAuthoringCommands.has(command)) {
    return errorResult("authoring_contract_retired", `Legacy authoring command retired: ${command}`, json);
  }
  if (!authoringCommands.has(command)) {
    return errorResult("unknown_command", `Unknown workbench command: ${command}`, json);
  }

  const client = new MastheadAuthoringClient({
    baseUrl: options.env?.MASTHEAD_DAEMON_URL,
    instanceManifest: options.env?.MASTHEAD_INSTANCE_MANIFEST
  });
  try {
    if (command === "capabilities") {
      return jsonResult({ ok: true, ...(await client.capabilities()) });
    }

    const runId = requiredOption(args, "--run", json);
    if (isCliResult(runId)) return runId;
    if (command === "status") return jsonResult(await client.status(runId));
    if (command === "context") return jsonResult(await client.context(runId));

    if (command === "evidence") {
      const sessionId = requiredOption(args, "--session", json);
      if (isCliResult(sessionId)) return sessionId;
      for (const option of ["--cursor", "--limit", "--order", "--kind", "--query"]) {
        if (optionHasMissingValue(args, option)) return missingOptionValue(option, json);
      }
      const query = new URLSearchParams({ sessionId });
      const cursor = optionValue(args, "--cursor");
      const queryText = optionValue(args, "--query");
      const kind = optionValue(args, "--kind");
      const order = optionValue(args, "--order");
      const limit = optionValue(args, "--limit");
      if (kind && !evidenceKinds.has(kind)) return errorResult("invalid_argument", `Invalid --kind: ${kind}`, json);
      if (order && order !== "asc" && order !== "desc") {
        return errorResult("invalid_argument", `Invalid --order: ${order}`, json);
      }
      if (limit && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 250)) {
        return errorResult("invalid_argument", "--limit must be between 1 and 250", json);
      }
      if (cursor) query.set("cursor", cursor);
      if (queryText) query.set("query", queryText);
      if (kind) query.set("kind", kind);
      if (order) query.set("order", order);
      if (limit) query.set("limit", limit);
      return jsonResult({ ok: true, ...(await client.evidence(runId, query)) });
    }

    throw new Error(`unreachable_workbench_authoring_command:${command}`);
  } catch (error) {
    if (error instanceof MastheadAuthoringClientError) {
      const code = error.code === "authoring_run_not_ready" ? "run_not_ready" : error.code;
      return errorResult(code, error.message, json, { body: error.body, status: error.status });
    }
    throw error;
  }
}

export function workbenchHelp(): string {
  return [
    "Usage: mastheadctl workbench <command> [options]",
    "",
    "Guided artifact authoring:",
    "  mastheadctl workbench author bootstrap --request <request-id> --json",
    "  mastheadctl workbench author start --request <request-id> --json",
    "  mastheadctl workbench author inspect --pack <pack-id> --json",
    "  mastheadctl workbench author scaffold --pack <pack-id> --file <draft.json> --json",
    "  mastheadctl workbench author save --pack <pack-id> --file <draft.json> --json",
    "  mastheadctl workbench author finish --pack <pack-id> --json",
    "  mastheadctl workbench author status --request <request-id> --json",
    "  mastheadctl workbench author receipt --request <request-id> --json",
    "  mastheadctl workbench capabilities --json",
    "",
    "Audit-only legacy reads:",
    "  mastheadctl workbench status --run <run-id> --json",
    "  mastheadctl workbench context --run <run-id> --json",
    "  mastheadctl workbench evidence --run <run-id> --session <id> [--cursor <cursor>] [--limit 100] [--order asc|desc] [--kind all|user|assistant|tools|checkpoints|files|signals] [--query <text>] --json",
    "",
    "Maintenance:",
    "  mastheadctl workbench audit-v1-generation --db <path> --json",
    "  mastheadctl workbench prepare-v1-recovery --db <path> --json",
    "  mastheadctl workbench invalidate-v1-generation --db <path> --audit-hash <sha256> --confirm --json",
    "  mastheadctl workbench restore-v1-recovery --db <active> --backup <sibling masthead.sqlite.backup-current> --audit-hash <sha256> --confirm --json",
    "  mastheadctl workbench audit-v3-template-generation --db <path> --incident-contract <path> --json",
    "  mastheadctl workbench prepare-v3-template-recovery --db <path> --incident-contract <path> --receipt <path> --json",
    "  mastheadctl workbench invalidate-v3-template-generation --db <path> --prepared-receipt <path> --confirm --json",
    "  mastheadctl workbench restore-v3-template-recovery --db <path> --prepared-receipt <path> --confirm --json",
    "  mastheadctl workbench audit-v5-quality-corpus --db <path> --retain-created-by <actor> [--retain-created-by <actor> ...] --json",
    "  mastheadctl workbench prepare-v5-quality-corpus --db <path> --retain-created-by <actor> [--retain-created-by <actor> ...] --receipt <path> --json",
    "  mastheadctl workbench invalidate-v5-quality-corpus --db <path> --prepared-receipt <path> --audit-hash <sha256> --confirm --json",
    "  mastheadctl workbench wipe-published --db <path> --confirm --json",
    "",
    "The daemon owns pack membership, evidence, validation, publication, receipts, and identity checks."
  ].join("\n") + "\n";
}

function requiredOption(args: string[], option: string, json: boolean): string | CliResult {
  if (optionHasMissingValue(args, option)) return missingOptionValue(option, json);
  return optionValue(args, option) ?? missingArgument(option, json);
}

function missingArgument(option: string, json: boolean): CliResult {
  return errorResult("missing_argument", `Missing required option: ${option}`, json);
}

function missingOptionValue(option: string, json: boolean): CliResult {
  return errorResult("missing_argument", `Missing value for option: ${option}`, json);
}

function optionValue(args: string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      return candidate && !candidate.startsWith("--") ? candidate.trim() || undefined : undefined;
    }
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1).trim() || undefined;
  }
  return undefined;
}

function optionHasMissingValue(args: string[], option: string): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const candidate = args[index + 1];
      if (!candidate || candidate.startsWith("--") || !candidate.trim()) return true;
    } else if (arg.startsWith(`${option}=`) && !arg.slice(option.length + 1).trim()) {
      return true;
    }
  }
  return false;
}

function isCliResult(value: string | CliResult): value is CliResult {
  return typeof value !== "string";
}
