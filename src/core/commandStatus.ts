import type { NormalizedEvent } from "./types.ts";

const VERIFICATION_CATEGORIES = new Set(["test", "lint", "type-check", "build"]);

export function commandExitCode(event: NormalizedEvent): number | undefined {
  return typeof event.payload.exitCode === "number" ? event.payload.exitCode : undefined;
}

export function isFailedCommandEvent(event: NormalizedEvent): boolean {
  const exitCode = commandExitCode(event);
  return event.type === "command.finished" && exitCode !== undefined && exitCode !== 0;
}

export function isSuccessfulCommandEvent(event: NormalizedEvent): boolean {
  return event.type === "command.finished" && commandExitCode(event) === 0;
}

export function isVerificationCommandEvent(event: NormalizedEvent): boolean {
  return event.type === "command.finished" && VERIFICATION_CATEGORIES.has(String(event.payload.category ?? ""));
}

export function isSuccessfulVerificationCommandEvent(event: NormalizedEvent): boolean {
  return isVerificationCommandEvent(event) && isSuccessfulCommandEvent(event);
}
