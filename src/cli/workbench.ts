import type { CliResult } from "./output.ts";
import {
  runWorkbenchAuthoringCli,
  workbenchHelp,
  type WorkbenchCliOptions
} from "./workbenchAuthoring.ts";

const primaryCommands = new Set([
  "capabilities",
  "open",
  "status",
  "evidence",
  "submit",
  "finish",
  "wipe-published"
]);

export type { WorkbenchCliOptions };
export { workbenchHelp };

export async function runWorkbenchCli(
  args: string[],
  options: WorkbenchCliOptions = {}
): Promise<CliResult> {
  const command = args[0];
  if (!command || command === "--help" || command === "help" || primaryCommands.has(command)) {
    return runWorkbenchAuthoringCli(args, options);
  }

  // Compatibility-only commands remain callable but are intentionally omitted
  // from primary help. Normal authoring startup never loads their SQLite stack.
  const { runWorkbenchCli: runLegacyWorkbenchCli } = await import("./workbenchLegacy.ts");
  return runLegacyWorkbenchCli(args, options);
}
