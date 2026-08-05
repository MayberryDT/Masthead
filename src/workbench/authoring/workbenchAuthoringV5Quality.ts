import type {
  WorkbenchAuthoringV5Draft,
  WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import { WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES } from "../../shared/workbenchAuthoringV5.ts";

const HARD_FINDING_CODES = new Set<string>(WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES);

/** ≥ this many sessions in one pack with the same normalized title → hard-reject those sessions. */
export const WORKBENCH_AUTHORING_V5_PACK_DUPLICATE_TITLE_THRESHOLD = 3;

const GENERIC_TITLES = new Set([
  "codex session", "current work", "done", "masthead session", "new session", "recent activity", "selected session evidence review",
  "session", "session narrative", "session work", "untitled session", "work completed",
  // Mechanical fill-script fallbacks observed 2026-07-29 (masthead-fill-pack.mjs).
  "review the recorded implementation and approval work for the named project",
  "resolve the documented project implementation issue",
  "resolve the reported implementation issue"
]);

/** Title/phrase shapes produced by bulk regex fillers — not exact-only. */
const MECHANICAL_FILL_TITLE_PATTERNS: readonly RegExp[] = [
  /\brecorded implementation and approval work\b/i,
  /\bfor the named project\b/i,
  /\bresolve the (?:documented|reported)(?: project)? implementation issue\b/i,
  /\breview the recorded\b/i
];

const GENERIC_DESCRIPTIONS = new Set([
  "changes made", "implemented changes", "session completed", "task completed", "updated code", "work completed"
]);

const GENERIC_DESCRIPTION_TOKENS = new Set([
  "change", "changed", "changes", "code", "complete", "completed", "did", "done", "implemented", "made",
  "request", "requested", "session", "some", "task", "the", "update", "updated", "updates", "work"
]);

/** Keywords that carry almost no session specificity when they dominate the bag. */
const GENERIC_KEYWORD_BAG = new Set([
  "approval", "canonical", "dossier", "evidence", "implementation", "project", "recorded",
  "review", "session", "transcript", "verification", "work"
]);

const PURPOSE_DOMAINS = {
  authentication: ["auth", "authentication", "callback", "login", "nonce", "oauth", "redirect", "session", "token"],
  billing: ["billing", "checkout", "invoice", "payment", "stripe", "subscription"],
  database: ["backup", "database", "migration", "postgres", "postgresql", "query", "recovery", "replication", "schema", "sql", "sqlite"],
  deployment: ["container", "deploy", "deployment", "docker", "kubernetes", "release", "rollout"],
  documentation: ["article", "copy", "docs", "documentation", "guide", "prose", "readme", "writing"],
  interface: ["button", "component", "css", "interface", "layout", "react", "responsive", "ui"],
  networking: ["certificate", "dns", "http", "network", "proxy", "tls"],
  performance: ["benchmark", "latency", "memory", "performance", "profile", "slow", "throughput"],
  sourceControl: ["branch", "commit", "git", "merge", "rebase", "repository", "worktree"],
  testing: ["assertion", "coverage", "fixture", "spec", "test", "testing", "vitest"]
} as const;

export function classifyWorkbenchAuthoringV5Session(
  session: WorkbenchAuthoringV5Draft["sessions"][number]
): WorkbenchAuthoringV5SessionOutcome {
  const findings: WorkbenchAuthoringV5SessionOutcome["findings"] = [];
  if (isEmptyOrGenericTitle(session.fields.title, session.sessionId)) {
    findings.push({
      code: "empty_or_generic_title",
      message: "Title must name the session's specific user work."
    });
  }
  // Q1 owns discrete instruction/policy heads; skip Q3 metadata when Q1 matches (one code per fixture).
  if (isInstructionOrPolicyTitle(session.fields.title)) {
    findings.push({
      code: "instruction_or_policy_title",
      message: "Title must name the substantive work, not an instruction file, system reminder, or MCP connection dump."
    });
  } else if (isContextOrMetadataTitle(session.fields.title)) {
    findings.push({
      code: "context_or_metadata_title",
      message: "Title must name the substantive work, not a path, timestamp, timezone, system prompt, or session context."
    });
  }
  if (isConversationalFillerTitle(session.fields.title)) {
    findings.push({
      code: "conversational_filler_title",
      message: "Title must name the substantive work rather than conversational filler."
    });
  }
  if (isEmptyOrGenericDescription(session.fields.description)) {
    findings.push({
      code: "empty_or_generic_description",
      message: "Description must summarize the session's specific user work."
    });
  }
  if (
    isApprovalOrJsonPayload(session.fields.description) ||
    isApprovalOrJsonPayload(session.fields.title)
  ) {
    findings.push({
      code: "approval_or_json_payload_description",
      message: "Description and title must summarize the work in prose, not paste approval JSON or raw JSON objects."
    });
  }
  const proseFields = [session.fields.title, session.fields.description, session.fields.purpose];
  if (proseFields.some(isProtocolOrCompactionBoilerplate)) {
    findings.push({
      code: "protocol_or_compaction_boilerplate",
      message: "Summary and purpose must describe the user's work, not authoring protocol, compaction, or pack mechanics."
    });
  }
  if (
    [session.fields.description, session.fields.purpose, session.fields.outcome].some(isTemplatedRequestEcho) ||
    session.fields.keyWork.some(isTemplatedRequestEcho)
  ) {
    findings.push({
      code: "templated_request_echo",
      message: "Description, purpose, and outcome must synthesize the substantive request and result, not echo a fill-script template."
    });
  }
  const keywordCount = new Set(session.fields.keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)).size;
  if (keywordCount === 0) {
    findings.push({
      code: "empty_keywords",
      message: "At least three specific search keywords are required."
    });
  } else if (keywordCount < 3) {
    findings.push({
      code: "insufficient_keywords",
      message: "At least three distinct search keywords are required."
    });
  }
  if (hasMetadataOrToolDominatedKeywords(session.fields.keywords, session.fields.title)) {
    findings.push({
      code: "metadata_or_tool_keywords",
      message: "Keywords must describe the substantive work rather than paths, timestamps, tool operations, or title filler."
    });
  }
  if (isGenericKeywordBag(session.fields.keywords)) {
    findings.push({
      code: "generic_keyword_bag",
      message: "Keywords must include session-specific terms, not only generic bags like implementation/evidence/verification."
    });
  }
  if (purposeClearlyMissesUserAsk(session)) {
    findings.push({
      code: "purpose_not_user_ask",
      message: "Purpose clearly describes different work from the user's request in canonical evidence."
    });
  }
  const ungrounded = ungroundedCoreFields(session);
  if (ungrounded.length > 0) {
    findings.push({
      code: "missing_core_field_grounding",
      message: `Core fields require canonical evidence references: ${ungrounded.join(", ")}.`
    });
  }
  if (isWeakVerification(session.fields.verification)) {
    findings.push({
      code: "weak_verification",
      message: "Verification wording is weak or does not state an honest result or boundary."
    });
  }
  if (isThinKeyWork(session.fields.keyWork)) {
    findings.push({
      code: "thin_key_work",
      message: "Key work is too thin to explain the concrete change or investigation."
    });
  }
  return {
    disposition: findings.some(({ code }) => HARD_FINDING_CODES.has(code))
      ? "hard_reject"
      : findings.length > 0 ? "soft_flag" : "publishable",
    findings,
    sessionId: session.sessionId
  };
}

function isProtocolOrCompactionBoilerplate(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /^<recommended_plugins\b/.test(normalized) ||
    /<\/?compaction(?:_summary)?>/.test(normalized) ||
    /\b(?:context|conversation|transcript) (?:was )?compacted\b/.test(normalized) ||
    /\bcompaction (?:banner|checkpoint|summary)\b/.test(normalized) ||
    /\bcanonical evidence (?:records|shows|was reviewed)\b/.test(normalized) ||
    /\b(?:follow|followed|following) (?:the )?(?:guided )?authoring protocol\b/.test(normalized) ||
    /\b(?:current|next) authoring pack\b/.test(normalized) ||
    /\bworkbench author (?:bootstrap|inspect|scaffold|save|finish)\b/.test(normalized) ||
    /\b(?:scheduled )?cron (?:job|run|task) (?:completed|queued|ran|started|triggered)\b/.test(normalized)
  );
}

function purposeClearlyMissesUserAsk(session: WorkbenchAuthoringV5Draft["sessions"][number]): boolean {
  const userAsk = session.evidenceCatalog
    .filter(({ role }) => role === "user")
    .map(({ text }) => text)
    .join(" ");
  const purposeDomains = domainsForText(session.fields.purpose);
  const userAskDomains = domainsForText(userAsk);
  return purposeDomains.size > 0 && userAskDomains.size > 0 &&
    [...purposeDomains].every((domain) => !userAskDomains.has(domain));
}

function domainsForText(value: string): Set<keyof typeof PURPOSE_DOMAINS> {
  const tokens = new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return new Set((Object.entries(PURPOSE_DOMAINS) as Array<[
    keyof typeof PURPOSE_DOMAINS,
    readonly string[]
  ]>).flatMap(([domain, domainTokens]) => domainTokens.some((token) => tokens.has(token)) ? [domain] : []));
}

function ungroundedCoreFields(
  session: WorkbenchAuthoringV5Draft["sessions"][number]
): string[] {
  const refs = session.fields.evidenceRefs;
  return (Object.entries(refs) as Array<[keyof typeof refs, string[]]>)
    .filter(([field, evidenceRefs]) => evidenceRefs.length === 0 &&
      !(field === "keyWork" && session.fields.keyWork.length === 0) &&
      !(field === "verification" && !session.fields.verification.summary.trim() &&
        (session.fields.verification.status === "missing" || session.fields.verification.status === "unknown")))
    .map(([field]) => field);
}

function isWeakVerification(verification: WorkbenchAuthoringV5Draft["sessions"][number]["fields"]["verification"]): boolean {
  const summary = verification.summary.replace(/\s+/g, " ").trim();
  if (!summary || /\b(?:looks|seems|appears) (?:okay|ok|good|fine)\b/i.test(summary)) return true;
  const statesHonestBoundary = /\b(?:not run|not verified|no (?:tests?|verification)|static (?:analysis|review)|unable to verify|verification (?:was )?unavailable|status was not available)\b/i.test(summary);
  if (verification.status === "missing" || verification.status === "unknown") return !statesHonestBoundary;
  return verification.status === "passed" && statesHonestBoundary;
}

function isThinKeyWork(keyWork: string[]): boolean {
  return keyWork.length === 0 || keyWork.every((item) => {
    const normalized = item.replace(/\s+/g, " ").trim();
    return normalized.length < 20 || /^(?:updated|changed|fixed|worked on|handled)(?: it| code| files?)?\.?$/i.test(normalized);
  });
}

function isEmptyOrGenericTitle(value: string, sessionId: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/g, "");
  return !/[a-z0-9]/i.test(normalized) || normalized === sessionId.toLowerCase() || GENERIC_TITLES.has(normalized) ||
    /^(?:codex|claude|cursor|masthead)?\s*(?:work\s*)?session\s*\d*$/i.test(normalized) ||
    MECHANICAL_FILL_TITLE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Q1: instruction-file / system-policy / MCP connection titles.
 * Requires `# AGENTS` / `AGENTS.md` shape (or exact `AGENTS`) so prose like
 * "Improve agent handoff UX" is not rejected.
 */
function isInstructionOrPolicyTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/^<system-reminder\b/i.test(normalized)) return true;
  if (/^mcp servers? connected\b/i.test(normalized)) return true;
  // `# AGENTS`, `## AGENTS.md`, exact `AGENTS` — not bare "Agent …" product prose
  if (/^(?:#+\s*)agents(?:\.md)?\b/i.test(normalized)) return true;
  if (/^agents\.md\b/i.test(normalized)) return true;
  if (/^agents$/i.test(normalized)) return true;
  return false;
}

/**
 * Q2: approval JSON or pure JSON object payloads in description/title.
 * Pure parseable object starting with `{` is hard-rejected; truncated approval
 * shapes with risk_level + outcome allow|deny are also rejected.
 */
function isApprovalOrJsonPayload(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return (
      /"risk_level"\s*:/.test(trimmed) &&
      /"outcome"\s*:\s*"(?:allow|deny)"/i.test(trimmed)
    ) || (
      /"user_authorization"\s*:/.test(trimmed) &&
      /"outcome"\s*:\s*"(?:allow|deny)"/i.test(trimmed)
    );
  }
}

function isContextOrMetadataTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  // Q3 expanded heads (system-reminder without angle brackets owned by Q1)
  if (/^system-reminder\b/i.test(normalized)) return true;
  if (/^permissions?\s+instructions?\b/i.test(normalized)) return true;
  if (/^you are codex\b/i.test(normalized)) return true;
  if (/^you are reviewing\b/i.test(normalized)) return true;
  const tokens = normalized.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const metadataTokens = tokens.filter((token) => (
    ["home", "asia", "tokyo", "utc", "timezone"].includes(token) ||
    /^\d{4}$/.test(token) || /^\d{1,2}$/.test(token)
  ));
  return /(?:^|\s)[/~]|\b\w+\/\w+\b/.test(normalized) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(normalized) ||
    /\b(?:utc|gmt|asia\/[a-z_]+)\b/i.test(normalized) ||
    (tokens.length > 0 && metadataTokens.length / tokens.length >= 0.5);
}

function isConversationalFillerTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (
    /^(?:this is )?(?:pretty |really )?(?:good|nice)(?:,? but (?:i )?(?:think|feel) we can make (?:it )?better)?[.!?]*$/i.test(normalized) ||
    /^(?:okay|ok|sure),? (?:that|this|it) (?:sounds|looks|feels) (?:better|good|great|right)[.!?]*$/i.test(normalized) ||
    /^(?:(?:okay|ok|sure),? )?(?:please )?(?:go ahead and )?(?:implement|apply|make|do|complete|finish)(?: (?:it|this|that|the (?:change|changes|implementation|plan|request|requested changes)))?[.!?]*$/i.test(normalized)
  );
}

function isTemplatedRequestEcho(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (
    /^(?:(?:worked on|complete) (?:the )?(?:user'?s )?request to|addressed the recorded request\b)/i.test(normalized) ||
    // Mechanical fill-script templates observed 2026-07-29.
    /^recorded work\s*:/i.test(normalized) ||
    /^documented work\s*:/i.test(normalized) ||
    /^address the substantive request captured in the session\b/i.test(normalized) ||
    /^address the substantive request to\b/i.test(normalized) ||
    /\bthe session retained the implementation or review outcome\b/i.test(normalized) ||
    /\bin its canonical transcript\b/i.test(normalized)
  );
}

function isGenericKeywordBag(keywords: string[]): boolean {
  const terms = [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))];
  if (terms.length < 3) return false;
  return terms.every((term) => GENERIC_KEYWORD_BAG.has(term));
}

/**
 * Pack-level diversity gate: when ≥ threshold sessions share the same normalized title,
 * hard-reject each of those sessions with `duplicate_pack_title` so bulk fill factories cannot publish.
 */
export function applyWorkbenchAuthoringV5PackTitleDiversity(
  outcomes: WorkbenchAuthoringV5SessionOutcome[],
  sessions: WorkbenchAuthoringV5Draft["sessions"]
): WorkbenchAuthoringV5SessionOutcome[] {
  const titleBySession = new Map(
    sessions.map((session) => [
      session.sessionId,
      session.fields.title.replace(/\s+/g, " ").trim().toLowerCase()
    ] as const)
  );
  const counts = new Map<string, number>();
  for (const title of titleBySession.values()) {
    if (!title) continue;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const duplicated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= WORKBENCH_AUTHORING_V5_PACK_DUPLICATE_TITLE_THRESHOLD)
      .map(([title]) => title)
  );
  if (duplicated.size === 0) return outcomes;

  return outcomes.map((outcome) => {
    const title = titleBySession.get(outcome.sessionId) ?? "";
    if (!duplicated.has(title)) return outcome;
    if (outcome.findings.some(({ code }) => code === "duplicate_pack_title")) return outcome;
    const findings = [
      ...outcome.findings,
      {
        code: "duplicate_pack_title" as const,
        message:
          `Title is reused across ${counts.get(title)} sessions in this pack; each session needs a distinct, evidence-specific title.`
      }
    ];
    return {
      ...outcome,
      disposition: findings.some(({ code }) => HARD_FINDING_CODES.has(code)) ? "hard_reject" : outcome.disposition,
      findings
    };
  });
}

function hasMetadataOrToolDominatedKeywords(keywords: string[], title: string): boolean {
  const titleTokens = new Set(title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const titleFillerTokens = new Set(["better", "good", "nice", "pretty", "really", "think", "this"]);
  const metadataTitle = isContextOrMetadataTitle(title) || /\bagents\.md\b|\bskills?\b/i.test(title);
  const noise = keywords.filter((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    const tokens = normalized.match(/[a-z0-9]+/g) ?? [];
    return /(?:^|\s)[/~]|\b\d{4}-\d{2}-\d{2}\b|\b(?:utc|gmt|asia\/|tokyo)\b/.test(normalized) ||
      /^(?:home|asia|shell investigation|update plan|write stdin)$/i.test(normalized) ||
      (metadataTitle && tokens.length > 0 && tokens.every((token) => titleTokens.has(token))) ||
      (tokens.length > 0 && tokens.every((token) => titleTokens.has(token) && titleFillerTokens.has(token)));
  });
  return keywords.length > 0 && noise.length / keywords.length >= 0.5;
}

function isEmptyOrGenericDescription(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!/[a-z0-9]/i.test(normalized) || GENERIC_DESCRIPTIONS.has(normalized)) return true;
  const specificTokens = (normalized.match(/[a-z0-9]+/g) ?? [])
    .filter((token) => !GENERIC_DESCRIPTION_TOKENS.has(token) && !/^\d+$/.test(token));
  return new Set(specificTokens).size < 2;
}
