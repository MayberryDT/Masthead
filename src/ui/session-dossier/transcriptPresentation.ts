const agentInstructionStart = /^\s*# AGENTS\.md instructions\b/i;
const knownRawBlockTags = ["INSTRUCTIONS", "environment_context", "project-doc", "system", "developer"];
const rawSystemPrefixes = [
  "Filesystem sandboxing defines which files can be read or written.",
  "# Codex Behavioral Guidelines",
  "Knowledge cutoff:",
  "Current date:",
  "You are Codex,",
  "You are an AI assistant"
];

export function readableTranscriptText(value?: string): string {
  if (!value) return "";

  let text = value;
  text = extractDelegatedInput(text);
  text = removeLeadingAgentInstructions(text);
  text = removeKnownRawBlocks(text);
  text = removeLooseRawBlocks(text);
  text = removeXmlTagLines(text);
  text = removeLeadingSourceId(text);
  text = removeMetadataBrackets(text);
  text = normalizeReadableWhitespace(text);
  return isRawSystemContextText(text) ? "" : text;
}

function extractDelegatedInput(value: string): string {
  return value.replace(/<codex_delegation\b[^>]*>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/gi, "$1");
}

function removeLeadingAgentInstructions(value: string): string {
  if (!agentInstructionStart.test(value)) return value;
  const environmentEnd = value.search(/<\/environment_context>/i);
  if (environmentEnd >= 0) return value.slice(environmentEnd + "</environment_context>".length);
  const delegationStart = value.search(/<codex_delegation\b/i);
  if (delegationStart >= 0) return value.slice(delegationStart);
  return "";
}

function removeKnownRawBlocks(value: string): string {
  return knownRawBlockTags.reduce((text, tag) => {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    return text.replace(pattern, " ");
  }, value);
}

function removeLooseRawBlocks(value: string): string {
  return value
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, " ")
    .replace(/<app-context>[\s\S]*?<\/app-context>/gi, " ")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, " ")
    .replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/gi, " ")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, " ")
    .replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/gi, " ");
}

function removeXmlTagLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^\s*<\/?[a-z][\w:-]*(?:\s+[^>]*)?>\s*$/i.test(line))
    .join("\n")
    .replace(/<\/?[a-z][\w:-]*(?:\s+[^>]*)?>/gi, " ");
}

function removeLeadingSourceId(value: string): string {
  return value.replace(/^\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s+/i, "");
}

function removeMetadataBrackets(value: string): string {
  return value.replace(/\[([^\[\]]*)\]/g, (match, content: string) => (isMetadataBracket(content) ? " " : match));
}

function isMetadataBracket(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return true;
  if (normalized.length > 80) return true;
  if (/[\r\n{}"`]/.test(normalized)) return true;
  if (/^[A-Z0-9_ -]+:/.test(normalized)) return true;
  return /^(system|developer|tool|context|metadata|payload|event|debug|instruction|instructions|environment|codex|secret|redacted|raw|source|session|model|cwd|approval|sandbox|workspace|current_date|timezone)\b/i.test(
    normalized
  );
}

function normalizeReadableWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRawSystemContextText(value: string): boolean {
  return rawSystemPrefixes.some((prefix) => value.startsWith(prefix));
}
