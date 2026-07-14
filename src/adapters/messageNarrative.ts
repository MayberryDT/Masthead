import { projectCodexMessageNarrative } from "./codex/messageNarrative.ts";

export type SourceMessageNarrativeProjection = {
  controlOnly: boolean;
  text: string;
};

export function projectSourceMessageNarrative(
  runtimeKind: string | undefined,
  value: string
): SourceMessageNarrativeProjection {
  if (runtimeKind?.trim().toLowerCase() === "codex") return projectCodexMessageNarrative(value);
  return { controlOnly: false, text: value };
}
