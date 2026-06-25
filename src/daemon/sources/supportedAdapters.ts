import type { RuntimeKind } from "../../adapters/types.ts";

export type AdapterImplementationState = "active" | "planned";

export type SupportedAdapter = {
  runtime: RuntimeKind;
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  implementationState: AdapterImplementationState;
};

export const supportedAdapters: SupportedAdapter[] = [
  {
    runtime: "codex",
    name: "Codex",
    label: "Codex",
    description: "Local Codex CLI session metadata and transcript stores.",
    enabled: true,
    implementationState: "active"
  },
  {
    runtime: "claude_code",
    name: "Claude Code",
    label: "Claude Code",
    description: "Claude Code local sessions adapter.",
    enabled: false,
    implementationState: "planned"
  },
  { runtime: "crush", name: "Crush / OpenCode", label: "Crush / OpenCode", description: "Crush and OpenCode local session adapter.", enabled: false, implementationState: "planned" },
  { runtime: "opencode", name: "OpenCode", label: "OpenCode", description: "OpenCode local session adapter.", enabled: false, implementationState: "planned" },
  { runtime: "hermes", name: "Hermes", label: "Hermes", description: "Hermes local agent history adapter.", enabled: false, implementationState: "planned" },
  { runtime: "pi", name: "Pi", label: "Pi", description: "Pi local session adapter.", enabled: false, implementationState: "planned" },
  { runtime: "gemini_cli", name: "Gemini CLI", label: "Gemini CLI", description: "Gemini CLI local session adapter.", enabled: false, implementationState: "planned" },
  { runtime: "aider", name: "Aider", label: "Aider", description: "Aider local session adapter.", enabled: false, implementationState: "planned" },
  { runtime: "openclaw", name: "OpenClaw", label: "OpenClaw", description: "OpenClaw local session adapter.", enabled: false, implementationState: "planned" }
];

export const SUPPORTED_ADAPTERS = supportedAdapters;
