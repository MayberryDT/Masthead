export function hasNegativeVerificationOutcome(value: string): boolean {
  const normalized = value
    .replace(/\b(?:0|zero)\s+(?:errors?|failures?|crashes?)\b/gi, "")
    .replace(/\b(?:errors?|failures?|crashes?)\s*[:=]\s*0\b/gi, "")
    .replace(/\b(?:no|without)\s+(?:remaining\s+)?(?:errors?|failures?|crashes?)\b/gi, "");
  return (
    /\b(?:0|zero)\s+(?:verification\s+)?(?:tests?|checks?)\s+passed\b/i.test(value) ||
    /\bno\b[^.\n]{0,35}\b(?:test|check|verification)\b[^.\n]{0,25}\bpassed\b/i.test(value) ||
    /\b(?:did not pass|not successful|unsuccessful|unconfirmed|unverified|untested|unresolved|error|failed|failing|failure)\b/i.test(
      normalized
    ) ||
    /\b(?:[1-9]\d*\s+(?:errors?|failures?)|(?:errors?|failures?)\s*[:=]\s*[1-9]\d*)\b/i.test(
      normalized
    )
  );
}

export function hasPositiveVerificationOutcome(value: string): boolean {
  if (hasNegativeVerificationOutcome(value)) return false;
  return (
    /\b(?:verification|tests?|checks?|build|health|probe)\b[^.\n]{0,100}\b(?:pass|passed|succeed|succeeded|successful|ok|green|healthy|verified|confirmed)\b/i.test(
      value
    ) ||
    /\b(?:verified|confirmed|proved|validated)\b[^.\n]{0,100}\b(?:working|healthy|restored|available|opened|delivered|passed|succeeded|correct|effective)\b/i.test(
      value
    ) ||
    /\b(?:verified|confirmed|checked)\b[^.\n]{0,80}\b(?:no|without)\b[^.\n]{0,45}\b(?:errors?|failures?|crashes?|server|processes?)\b/i.test(
      value
    ) ||
    /\b(?:restored|recovered|resolved|working|healthy|green|opened|delivered)\s+(?:successfully|correctly|again)\b/i.test(
      value
    )
  );
}

export function hasLaterNegativeVerificationOutcome(value: string, excerpt: string): boolean {
  const normalizedValue = normalizeVerificationWhitespace(value);
  const normalizedExcerpt = normalizeVerificationWhitespace(excerpt);
  if (!normalizedExcerpt) return false;
  const excerptIndex = normalizedValue.indexOf(normalizedExcerpt);
  if (excerptIndex < 0) return false;
  return hasNegativeVerificationOutcome(
    normalizedValue.slice(excerptIndex + normalizedExcerpt.length)
  );
}

export function hasStructuredVerificationReport(value: string): boolean {
  const heading = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:what i verified|verification|post-fix verification|required command verification|verified(?:\s+without[^:\n]*)?|(?:i|we)\s+(?:also\s+)?verified(?:\s+[^:\n]{0,100})?)\s*:?\s*(?:\n|$)|(?:^|\n)[^\n]{0,160}\b(?:production|service|site|application)\b[^.\n]{0,50}\bdeployed and verified\s*:/i.exec(
    value
  );
  if (!heading || heading.index === undefined) {
    return /\b(?:i|we)\s+(?:also\s+)?verified\b[^.\n]{0,100}\.\s*(?:the\s+)?(?:effective|actual|live)\b[^.\n]{0,100}\b(?:says|shows|includes|is|was)\b/i.test(
      value
    );
  }

  const report = value.slice(heading.index + heading[0].length);
  return report
    .split("\n")
    .slice(0, 80)
    .some((line) => isPositiveVerificationResultLine(line));
}

function isPositiveVerificationResultLine(value: string): boolean {
  const line = value.trim();
  if (!line || hasNegativeVerificationOutcome(line)) return false;
  return (
    /^(?:[-*]\s*)?(?:pass(?:ed)?|success(?:ful)?)\s*:/i.test(line) ||
    /\b(?:completed|authenticated?|delivered|opened|restored|returned|ran)\s+successfully\b/i.test(line) ||
    /\bstatus\s*:\s*ok\b|\bdelivered\s*:\s*true\b|\bcame back healthy\b/i.test(line) ||
    /\b(?:is|are|now|shows?|reports?|remains?)\s+(?:running(?:\s+again)?|healthy|live|working|enabled|visible|available)\b/i.test(
      line
    ) ||
    /\b(?:page|site|service|application|worker|container|process|gateway|domain)\b[^.\n]{0,80}\b(?:visible|live|healthy|working|available|running)\b/i.test(
      line
    ) ||
    /\b(?:works?|succeeded|passed|healthy|authenticates successfully)\b/i.test(line) ||
    /\br\/?w(?:\/x)?\s*=\s*true\b/i.test(line)
  );
}

function normalizeVerificationWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
