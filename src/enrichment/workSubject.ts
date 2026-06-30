export type WorkArea = "MCP" | "Logbook" | "Sources" | "Settings" | "Daemon" | "CI" | "Docs" | "UI" | "Auth" | "Tests";

export type WorkSubjectSignal = {
  area: WorkArea;
  confidence: "high" | "medium" | "low";
  label: string;
};

const AREA_PATTERNS: Array<{ area: WorkArea; patterns: RegExp[] }> = [
  { area: "MCP", patterns: [/mcp/i, /agent access/i] },
  { area: "Logbook", patterns: [/logbook/i, /history/i, /session library/i, /search/i] },
  {
    area: "Sources",
    patterns: [/source adapter/i, /source discovery/i, /sources onboarding/i, /\badapter(s)?\b/i, /\bimport (job|workflow|source|transcript|metadata)\b/i, /\btranscript import\b/i, /transcript/i]
  },
  { area: "Settings", patterns: [/settings/i, /privacy/i, /storage/i, /delete/i, /retention/i] },
  { area: "Daemon", patterns: [/daemon/i, /health/i, /protocol/i, /connector/i, /bridge/i] },
  { area: "CI", patterns: [/workflow/i, /github actions/i, /\bci\b/i, /codeql/i] },
  { area: "Docs", patterns: [/docs/i, /readme/i, /\badr\b/i, /reference/i] },
  { area: "UI", patterns: [/\bui\b/i, /tsx/i, /component/i, /panel/i, /toolbar/i] },
  { area: "Auth", patterns: [/auth/i, /oauth/i, /login/i] },
  { area: "Tests", patterns: [/test/i, /spec/i, /verify/i, /smoke/i] }
];

export function classifyWorkSubject(input: {
  texts?: string[];
  fileBasenames?: string[];
  fileDirectories?: string[];
  branch?: string;
  project?: string;
}): WorkSubjectSignal {
  const signals = [...(input.texts ?? []), ...(input.fileBasenames ?? []), ...(input.fileDirectories ?? []), input.branch ?? ""].filter(Boolean);
  const joined = signals.join(" ");
  for (const { area, patterns } of AREA_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(joined))) {
      return {
        area,
        confidence: input.texts?.some((text) => patterns.some((pattern) => pattern.test(text))) ? "high" : "medium",
        label: area
      };
    }
  }
  return { area: "UI", confidence: "low", label: input.project ?? "project" };
}

export function topicFromEvidence(value: string): string | undefined {
  const signal = classifyWorkSubject({ texts: [value] });
  if (signal.confidence === "low" && signal.label === "project") return undefined;
  return normalizeTopic(signal.area);
}

export function normalizeTopic(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .toLowerCase();
}
