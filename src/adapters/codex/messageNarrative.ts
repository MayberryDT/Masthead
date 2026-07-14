export type CodexMessageNarrativeProjection = {
  controlOnly: boolean;
  text: string;
};

const controlTags = [
  "permissions instructions",
  "app-context",
  "skills_instructions",
  "apps_instructions",
  "plugins_instructions",
  "multi_agent_mode",
  "collaboration_mode",
  "recommended_plugins",
  "codex_delegation",
  "skill",
  "environment_context",
  "turn_aborted",
  "subagent_notification",
  "project-doc",
  "instructions",
  "system",
  "developer"
] as const;

/**
 * Codex can prepend repository/runtime envelopes to a user message. Preserve
 * the original canonical message elsewhere; this projection isolates any real
 * prompt that follows those Codex-specific envelopes.
 */
export function projectCodexMessageNarrative(value: string): CodexMessageNarrativeProjection {
  let text = value.trimStart();
  let recognizedControl = false;
  while (text) {
    if (/^# AGENTS\.md instructions\b/i.test(text)) {
      recognizedControl = true;
      const delegated = text.match(
        /<codex_delegation\b[^>]*>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i
      );
      if (delegated) {
        const narrative = delegated[1]?.trim() ?? "";
        return { controlOnly: narrative.length === 0, text: narrative };
      }
      const environmentEnd = text.toLowerCase().lastIndexOf("</environment_context>");
      if (environmentEnd < 0) return { controlOnly: true, text: "" };
      text = text.slice(environmentEnd + "</environment_context>".length).trimStart();
      continue;
    }
    const directDelegation = text.match(
      /^<codex_delegation\b[^>]*>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*?<\/codex_delegation>/i
    );
    if (directDelegation) {
      const narrative = directDelegation[1]?.trim() ?? "";
      return { controlOnly: narrative.length === 0, text: narrative };
    }
    const tag = controlTags.find((candidate) =>
      new RegExp(`^<${candidate}(?:\\s[^>]*)?>`, "i").test(text)
    );
    if (!tag) break;
    recognizedControl = true;
    const closingTag = `</${tag}>`;
    const end = text.toLowerCase().indexOf(closingTag);
    if (end < 0) return { controlOnly: true, text: "" };
    text = text.slice(end + closingTag.length).trimStart();
  }

  if (!recognizedControl) return { controlOnly: false, text: value };
  const narrative = text.trim();
  return { controlOnly: narrative.length === 0, text: narrative };
}
