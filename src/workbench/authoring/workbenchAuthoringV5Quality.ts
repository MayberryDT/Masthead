import type {
  WorkbenchAuthoringV5Draft,
  WorkbenchAuthoringV5SessionOutcome
} from "../../shared/workbenchAuthoringV5.ts";
import { WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES } from "../../shared/workbenchAuthoringV5.ts";

const HARD_FINDING_CODES = new Set<string>(WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES);

const GENERIC_TITLES = new Set([
  "codex session", "current work", "done", "masthead session", "new session", "recent activity", "selected session evidence review",
  "session", "session narrative", "session work", "untitled session", "work completed"
]);

const PURPOSE_DOMAINS = {
  authentication: ["auth", "authentication", "callback", "login", "nonce", "oauth", "redirect", "session", "token"],
  billing: ["billing", "checkout", "invoice", "payment", "stripe", "subscription"],
  database: ["backup", "database", "migration", "postgres", "postgresql", "query", "recovery", "replication", "schema", "sql", "sqlite"],
  deployment: ["container", "deploy", "deployment", "docker", "kubernetes", "release", "rollout"],
  interface: ["button", "component", "css", "interface", "layout", "react", "responsive", "ui"],
  networking: ["certificate", "dns", "http", "network", "proxy", "tls"]
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
  const proseFields = [session.fields.title, session.fields.description, session.fields.purpose];
  if (proseFields.some(isProtocolOrCompactionBoilerplate)) {
    findings.push({
      code: "protocol_or_compaction_boilerplate",
      message: "Summary and purpose must describe the user's work, not authoring protocol, compaction, or pack mechanics."
    });
  }
  if (!session.fields.keywords.some((keyword) => keyword.trim())) {
    findings.push({
      code: "empty_keywords",
      message: "At least one specific search keyword is required."
    });
  }
  if (purposeClearlyMissesUserAsk(session)) {
    findings.push({
      code: "purpose_not_user_ask",
      message: "Purpose clearly describes different work from the user's request in canonical evidence."
    });
  }
  const ungrounded = ungroundedCoreFields(session.fields.evidenceRefs);
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
  const purposeDomains = domainsForText(session.fields.purpose);
  const userAskDomains = domainsForText(session.evidenceCatalog
    .filter(({ role }) => role === "user")
    .map(({ text }) => text)
    .join(" "));
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
  refs: WorkbenchAuthoringV5Draft["sessions"][number]["fields"]["evidenceRefs"]
): string[] {
  return (Object.entries(refs) as Array<[keyof typeof refs, string[]]>)
    .filter(([, evidenceRefs]) => evidenceRefs.length === 0)
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
    /^(?:codex|claude|cursor|masthead)?\s*(?:work\s*)?session\s*\d*$/i.test(normalized);
}
