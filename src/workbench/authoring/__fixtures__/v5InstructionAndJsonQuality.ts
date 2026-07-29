/**
 * Corpus fixtures for authoring-quality hard rejects (plan QB: Q1–Q4).
 * Each bad fixture maps to exactly one primary finding code under coordination rules.
 */

export const INSTRUCTION_OR_POLICY_TITLE_BAD = [
  { title: "# AGENTS", code: "instruction_or_policy_title" as const },
  { title: "# AGENTS.md", code: "instruction_or_policy_title" as const },
  { title: "AGENTS.md", code: "instruction_or_policy_title" as const },
  {
    title: "AGENTS.md instructions for the local worktree sandbox",
    code: "instruction_or_policy_title" as const
  },
  {
    title: "<system-reminder>Do not mention these guidelines</system-reminder>",
    code: "instruction_or_policy_title" as const
  },
  {
    title: "MCP servers connected: grok-build, t3-code",
    code: "instruction_or_policy_title" as const
  },
  {
    title: "MCP server connected",
    code: "instruction_or_policy_title" as const
  }
] as const;

export const INSTRUCTION_OR_POLICY_TITLE_GOOD = [
  "Improve agent handoff UX",
  "Agent handoff copy improvements",
  "Repair OAuth callback token validation"
] as const;

export const APPROVAL_OR_JSON_DESCRIPTION_BAD = [
  {
    description: '{"risk_level":"low","user_authorization":"required","outcome":"allow"}',
    code: "approval_or_json_payload_description" as const
  },
  {
    description: '{"risk_level":"high","outcome":"deny","reason":"destructive"}',
    code: "approval_or_json_payload_description" as const
  },
  {
    description: '  {"foo":1,"bar":"baz"}  ',
    code: "approval_or_json_payload_description" as const
  },
  {
    title: '{"risk_level":"low","outcome":"allow"}',
    description: "Repaired the OAuth callback and verified redirect state binding.",
    code: "approval_or_json_payload_description" as const
  }
] as const;

export const APPROVAL_OR_JSON_DESCRIPTION_GOOD = [
  "Repaired OAuth callback validation and added unit tests for the redirect path.",
  "Investigated intermittent timeout in the payment webhook and documented the root cause."
] as const;

/** Expanded context/metadata heads — primary code is context_or_metadata_title (not Q1). */
export const CONTEXT_OR_METADATA_TITLE_BAD = [
  {
    title: "system-reminder: follow the developer sandbox policy",
    code: "context_or_metadata_title" as const
  },
  {
    title: "Permissions instructions for the current sandbox session",
    code: "context_or_metadata_title" as const
  },
  {
    title: "You are Codex, a coding agent operating inside Masthead.",
    code: "context_or_metadata_title" as const
  },
  {
    title: "You are reviewing a pull request for security issues.",
    code: "context_or_metadata_title" as const
  },
  {
    title: "Home/tyler bash 2026-04-17 Asia/Tokyo",
    code: "context_or_metadata_title" as const
  },
  {
    title: "/home/tyler/Documents/Masthead worktree context",
    code: "context_or_metadata_title" as const
  }
] as const;

export const CONTEXT_OR_METADATA_TITLE_GOOD = [
  "Harden Workbench package-path clearance after hard reject",
  "Document Grok session-start suppress rules",
  "Fix Logbook artifact inspector layout on narrow screens"
] as const;
