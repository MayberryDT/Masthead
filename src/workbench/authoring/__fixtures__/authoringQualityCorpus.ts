/**
 * Durable regression corpus for the 2026-07-28 authoring-quality incident shapes.
 *
 * Wave-1 ISSUE-T1: pure data only. Q1–Q3 classifiers import these cases once those
 * issues land. `expectedEventualHardRejectCode` documents the planned hard-reject
 * code; it is not asserted against the live classifier here so CI stays green before
 * Q1–Q3 merge.
 *
 * Code ownership (no duplicate codes for the same string):
 * - Q1 `instruction_or_policy_title` — instruction-file / system-prompt / MCP heads
 * - Q2 `approval_or_json_payload_description` — approval JSON or pure JSON blob prose
 * - Q3 may expand `context_or_metadata_title` for other metadata heads not covered by Q1
 */

/** Planned hard-reject codes from plan Q1/Q2 (may not yet exist on base). */
export const AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES = {
  instructionOrPolicyTitle: "instruction_or_policy_title",
  approvalOrJsonPayloadDescription: "approval_or_json_payload_description"
} as const;

export type AuthoringQualityCorpusKind =
  | "instruction_title"
  | "system_reminder_title"
  | "mcp_connection_title"
  | "json_approval_description"
  | "good_session";

export type AuthoringQualityCorpusOwnerIssue = "Q1" | "Q2" | "Q3";

/** Minimal authored field surface used by V5 quality classification. */
export type AuthoringQualityCorpusFields = {
  title: string;
  description: string;
  purpose: string;
  keywords: readonly string[];
};

export type AuthoringQualityCorpusCase = {
  id: string;
  kind: AuthoringQualityCorpusKind;
  /** Owning quality issue once classifiers land; null for good (publishable) cases. */
  ownerIssue: AuthoringQualityCorpusOwnerIssue | null;
  /**
   * Expected eventual hard-reject finding code after Q1–Q3.
   * null means the case must remain publishable (not rejected solely for these shapes).
   */
  expectedEventualHardRejectCode: string | null;
  fields: AuthoringQualityCorpusFields;
  notes?: string;
};

/** Production-shaped approval JSON that flooded Logbook summaries. */
export const APPROVAL_JSON_DESCRIPTION =
  '{"risk_level":"medium","user_authorization":"approved","outcome":"allow","reason":"User confirmed the proposed shell command."}';

const GOOD_KEYWORDS = ["oauth", "callback", "validation"] as const;

// --- Bad titles: instruction-file / AGENTS heads (Q1) ---

export const AGENTS_TITLE_HASH: AuthoringQualityCorpusCase = {
  id: "title-agents-hash",
  kind: "instruction_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "# AGENTS",
    description:
      "Session captured instruction-file text as the primary title instead of the user ask.",
    purpose: "Should not publish instruction-file heads as dossier titles.",
    keywords: ["agents", "instructions", "policy"]
  },
  notes: "Exact production flood shape: title is only `# AGENTS`."
};

export const AGENTS_MD_TITLE_HASH: AuthoringQualityCorpusCase = {
  id: "title-agents-md-hash",
  kind: "instruction_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "# AGENTS.md",
    description:
      "Dossier title copied the AGENTS.md heading from the session envelope.",
    purpose: "Reject AGENTS.md markdown heads used as titles.",
    keywords: ["agents", "markdown", "heading"]
  }
};

export const AGENTS_MD_INSTRUCTIONS_TITLE: AuthoringQualityCorpusCase = {
  id: "title-agents-md-instructions-path",
  kind: "instruction_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "# AGENTS.md instructions for /home/tyler/Documents/Masthead",
    description:
      "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    purpose:
      "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    keywords: ["home", "tyler", "skills"]
  },
  notes: "Matches S7 false-green agentsContext title shape with leading #."
};

export const AGENTS_MD_BARE_INSTRUCTIONS_TITLE: AuthoringQualityCorpusCase = {
  id: "title-agents-md-bare-instructions",
  kind: "instruction_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions",
    description:
      "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    purpose:
      "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    keywords: ["home", "tyler", "skills"]
  },
  notes: "Variant without leading #; still an instruction-file head."
};

// --- Bad titles: system-reminder / MCP (Q1 owns discrete patterns) ---

export const SYSTEM_REMINDER_TITLE: AuthoringQualityCorpusCase = {
  id: "title-system-reminder",
  kind: "system_reminder_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "<system-reminder> Always follow the developer instructions before answering.",
    description:
      "Title was taken from a harness system-reminder block instead of the user ask.",
    purpose: "Reject system-reminder prose used as a dossier title.",
    keywords: ["system", "reminder", "harness"]
  },
  notes: "Q1 lists start-with <system-reminder; Q3 must not assign a second code to this string."
};

export const SYSTEM_REMINDER_CLOSED_TAG_TITLE: AuthoringQualityCorpusCase = {
  id: "title-system-reminder-closed",
  kind: "system_reminder_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "<system-reminder>Do not mention these guidelines.</system-reminder>",
    description:
      "Closed system-reminder tag leaked into the published capsule title.",
    purpose: "Reject closed system-reminder titles.",
    keywords: ["system", "reminder", "guidelines"]
  }
};

export const MCP_SERVERS_CONNECTED_TITLE: AuthoringQualityCorpusCase = {
  id: "title-mcp-servers-connected",
  kind: "mcp_connection_title",
  ownerIssue: "Q1",
  expectedEventualHardRejectCode: AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle,
  fields: {
    title: "MCP servers connected: gbrain, linear",
    description:
      "MCP connection banner was used as the session title during authoring.",
    purpose: "Reject MCP connection banners as titles.",
    keywords: ["mcp", "servers", "connected"]
  }
};

// --- Bad descriptions: approval / pure JSON payloads (Q2) ---

export const JSON_APPROVAL_DESCRIPTION: AuthoringQualityCorpusCase = {
  id: "description-approval-json",
  kind: "json_approval_description",
  ownerIssue: "Q2",
  expectedEventualHardRejectCode:
    AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.approvalOrJsonPayloadDescription,
  fields: {
    title: "Shell command approval",
    description: APPROVAL_JSON_DESCRIPTION,
    purpose: "User approved a proposed shell command via the harness approval UI.",
    keywords: ["approval", "shell", "risk"]
  },
  notes: "Primary production flood: description is raw approval JSON with risk_level/outcome."
};

export const JSON_APPROVAL_DESCRIPTION_WITH_WHITESPACE: AuthoringQualityCorpusCase = {
  id: "description-approval-json-padded",
  kind: "json_approval_description",
  ownerIssue: "Q2",
  expectedEventualHardRejectCode:
    AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.approvalOrJsonPayloadDescription,
  fields: {
    title: "Tool use authorization",
    description: `  \n${APPROVAL_JSON_DESCRIPTION}\n  `,
    purpose: "Approval payload with leading/trailing whitespace still pure JSON.",
    keywords: ["authorization", "tool", "json"]
  }
};

export const PURE_JSON_OBJECT_DESCRIPTION: AuthoringQualityCorpusCase = {
  id: "description-pure-json-object",
  kind: "json_approval_description",
  ownerIssue: "Q2",
  expectedEventualHardRejectCode:
    AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.approvalOrJsonPayloadDescription,
  fields: {
    title: "Structured harness outcome",
    description: '{"outcome":"deny","user_authorization":"rejected","risk_level":"high"}',
    purpose: "Pure JSON blob description without surrounding prose.",
    keywords: ["outcome", "deny", "json"]
  }
};

// --- Good sessions: must not hard-reject solely for incidental words ---

export const GOOD_AGENT_HANDOFF_TITLE: AuthoringQualityCorpusCase = {
  id: "good-agent-handoff-copy",
  kind: "good_session",
  ownerIssue: null,
  expectedEventualHardRejectCode: null,
  fields: {
    title: "Agent handoff copy improvements",
    description:
      "Revised agent handoff microcopy so operators see clear next steps after pack finish without mentioning instruction files as the work product.",
    purpose: "Improve human-readable handoff wording on the Workbench finish path.",
    keywords: ["handoff", "copy", "workbench"]
  },
  notes: "Mentions 'agent' in prose; must not trip instruction_or_policy_title."
};

export const GOOD_OAUTH_CALLBACK_SESSION: AuthoringQualityCorpusCase = {
  id: "good-oauth-callback-validation",
  kind: "good_session",
  ownerIssue: null,
  expectedEventualHardRejectCode: null,
  fields: {
    title: "Repair OAuth callback token validation",
    description:
      "Fixed nonce checking on the OAuth callback so expired tokens fail closed and successful logins still complete.",
    purpose: "Restore correct OAuth callback validation after a regression.",
    keywords: [...GOOD_KEYWORDS]
  }
};

export const GOOD_LOGBOOK_PAGINATION_SESSION: AuthoringQualityCorpusCase = {
  id: "good-logbook-pagination",
  kind: "good_session",
  ownerIssue: null,
  expectedEventualHardRejectCode: null,
  fields: {
    title: "Stabilize Logbook artifact search pagination",
    description:
      "Implemented stable cursor pagination for artifact search so Logbook rows do not jump when new dossiers publish mid-scroll.",
    purpose: "Deliver reliable Logbook search pagination under concurrent publish.",
    keywords: ["logbook", "pagination", "search"]
  }
};

/** All bad corpus cases (must eventually hard-reject). */
export const AUTHORING_QUALITY_BAD_CORPUS_CASES: readonly AuthoringQualityCorpusCase[] = [
  AGENTS_TITLE_HASH,
  AGENTS_MD_TITLE_HASH,
  AGENTS_MD_INSTRUCTIONS_TITLE,
  AGENTS_MD_BARE_INSTRUCTIONS_TITLE,
  SYSTEM_REMINDER_TITLE,
  SYSTEM_REMINDER_CLOSED_TAG_TITLE,
  MCP_SERVERS_CONNECTED_TITLE,
  JSON_APPROVAL_DESCRIPTION,
  JSON_APPROVAL_DESCRIPTION_WITH_WHITESPACE,
  PURE_JSON_OBJECT_DESCRIPTION
] as const;

/** All good corpus cases (must not hard-reject solely for these field shapes). */
export const AUTHORING_QUALITY_GOOD_CORPUS_CASES: readonly AuthoringQualityCorpusCase[] = [
  GOOD_AGENT_HANDOFF_TITLE,
  GOOD_OAUTH_CALLBACK_SESSION,
  GOOD_LOGBOOK_PAGINATION_SESSION
] as const;

/** Full mixed corpus for table-driven regression. */
export const AUTHORING_QUALITY_CORPUS_CASES: readonly AuthoringQualityCorpusCase[] = [
  ...AUTHORING_QUALITY_BAD_CORPUS_CASES,
  ...AUTHORING_QUALITY_GOOD_CORPUS_CASES
] as const;

/** Title-only bad cases owned by Q1 (instruction / system-reminder / MCP). */
export const AUTHORING_QUALITY_INSTRUCTION_TITLE_CASES: readonly AuthoringQualityCorpusCase[] =
  AUTHORING_QUALITY_BAD_CORPUS_CASES.filter(
    (entry) =>
      entry.kind === "instruction_title" ||
      entry.kind === "system_reminder_title" ||
      entry.kind === "mcp_connection_title"
  );

/** Description JSON/approval cases owned by Q2. */
export const AUTHORING_QUALITY_JSON_DESCRIPTION_CASES: readonly AuthoringQualityCorpusCase[] =
  AUTHORING_QUALITY_BAD_CORPUS_CASES.filter((entry) => entry.kind === "json_approval_description");

/**
 * Mutable field patch suitable for applying onto a scaffolded V5 session.
 * Keywords are copied so callers can mutate without aliasing fixture data.
 */
export function authoringQualityCorpusFieldPatch(
  entry: AuthoringQualityCorpusCase
): {
  title: string;
  description: string;
  purpose: string;
  keywords: string[];
} {
  return {
    title: entry.fields.title,
    description: entry.fields.description,
    purpose: entry.fields.purpose,
    keywords: [...entry.fields.keywords]
  };
}
