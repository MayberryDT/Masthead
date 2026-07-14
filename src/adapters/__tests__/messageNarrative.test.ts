import { describe, expect, test } from "vitest";
import { projectSourceMessageNarrative } from "../messageNarrative.ts";

describe("source message narrative projection", () => {
  test.each([
    ["ordinary prompt", "Please repair the release.", false, "Please repair the release."],
    ["unclosed skill", "\n<skill>Internal instructions", true, ""],
    ["attributed skill", "<skill name=\"qa\">Internal</skill>", true, ""],
    [
      "chained controls",
      "<skill>Internal</skill>\n<environment_context><cwd>/tmp</cwd></environment_context>",
      true,
      ""
    ],
    [
      "control followed by prompt",
      "<skill>Internal</skill>\nRepair the release and run the focused test.",
      false,
      "Repair the release and run the focused test."
    ],
    [
      "AGENTS environment followed by prompt",
      "# AGENTS.md instructions for /tmp\n<INSTRUCTIONS>Internal</INSTRUCTIONS>\n<environment_context><cwd>/tmp</cwd></environment_context>\nKeep the migration local-first.",
      false,
      "Keep the migration local-first."
    ],
    [
      "prefixed production controls",
      "<recommended_plugins>Internal</recommended_plugins>\n<permissions instructions>Internal</permissions instructions>\n<app-context>Internal</app-context>\n<skills_instructions>Internal</skills_instructions>\n<apps_instructions>Internal</apps_instructions>\n<plugins_instructions>Internal</plugins_instructions>\n# AGENTS.md instructions for /tmp\n<environment_context><cwd>/tmp</cwd></environment_context>\nContinue the approved recovery.",
      false,
      "Continue the approved recovery."
    ],
    [
      "AGENTS followed only by another control",
      "# AGENTS.md instructions for /tmp\n<environment_context><cwd>/tmp</cwd></environment_context>\n<skill>Internal</skill>",
      true,
      ""
    ],
    [
      "delegated input",
      "<codex_delegation><input>Review the candidate evidence.</input></codex_delegation>",
      false,
      "Review the candidate evidence."
    ],
    ["empty delegation", "<codex_delegation><input></input></codex_delegation>", true, ""],
    ["malformed delegation", "<codex_delegation><input>Internal", true, ""],
    ["unclosed abort", "<turn_aborted>Internal", true, ""],
    ["multi-agent mode", "<multi_agent_mode>Internal delegation policy</multi_agent_mode>", true, ""],
    ["collaboration mode", "<collaboration_mode>Internal collaboration policy</collaboration_mode>", true, ""],
    ["standalone instructions", "<INSTRUCTIONS>Internal repository policy</INSTRUCTIONS>", true, ""],
    [
      "current control chain followed by prompt",
      "<multi_agent_mode>Internal</multi_agent_mode>\n<collaboration_mode>Internal</collaboration_mode>\n<INSTRUCTIONS>Internal</INSTRUCTIONS>\nDiagnose the actual session failure.",
      false,
      "Diagnose the actual session failure."
    ],
    [
      "attributed notification",
      "<subagent_notification status=\"done\">Internal</subagent_notification>",
      true,
      ""
    ]
  ])("projects Codex %s", (_label, source, controlOnly, text) => {
    expect(projectSourceMessageNarrative("codex", source)).toEqual({ controlOnly, text });
  });

  test("does not interpret another runtime through Codex syntax", () => {
    const source = "<skill>Meaningful text for another runtime</skill>";
    expect(projectSourceMessageNarrative("opencode", source)).toEqual({
      controlOnly: false,
      text: source
    });
  });
});
