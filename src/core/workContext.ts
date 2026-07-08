import type { GitSnapshot, LatestFeedbackSignal, NormalizedEvent, WorkAreaContext } from "./types";

type DeriveWorkContextInput = {
  title: string;
  branchOrWorktree?: string;
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  latestFeedbackSignal?: LatestFeedbackSignal;
  recentTranscriptMessages?: string[];
};

const GENERIC_TITLES = new Set(["codex session", "untitled session", "session"]);

export function deriveWorkContext(input: DeriveWorkContextInput): WorkAreaContext {
  const clusters = pathClusters(input.gitSnapshots);
  const titleMatch = labelFromTitle(input.title);
  if (titleMatch) {
    return context(titleMatch.label, "title", clusters, [`title:${titleMatch.signal}`]);
  }

  const specificTranscriptMatch = labelFromSpecificText(input.recentTranscriptMessages ?? []);
  if (specificTranscriptMatch) {
    return context(specificTranscriptMatch.label, "event_summary", clusters, [`event:${specificTranscriptMatch.signal}`]);
  }

  const specificEventMatch = labelFromSpecificEvents(input.events);
  if (specificEventMatch) {
    return context(specificEventMatch.label, "event_summary", clusters, [`event:${specificEventMatch.signal}`]);
  }

  const clusterLabel = labelFromClusters(clusters);
  if (clusterLabel) {
    return context(clusterLabel, "path_cluster", clusters, clusters.map((cluster) => `path:${cluster}`));
  }

  const eventMatch = labelFromEvents(input.events);
  if (eventMatch) {
    return context(eventMatch.label, "event_summary", clusters, [`event:${eventMatch.signal}`]);
  }

  const feedbackMatch = labelFromFeedback(input.latestFeedbackSignal);
  if (feedbackMatch) {
    return context(feedbackMatch.label, "feedback_snapshot", clusters, [`feedback:${feedbackMatch.signal}`]);
  }

  return context("Session work", "generic", clusters, []);
}

function context(
  label: string,
  confidence: WorkAreaContext["confidence"],
  pathClusters: string[],
  sourceSignals: string[]
): WorkAreaContext {
  return {
    label,
    confidence,
    pathClusters,
    sourceSignals: sourceSignals.map(safeSignal).filter(Boolean).slice(0, 4)
  };
}

function labelFromTitle(title: string): { label: string; signal: string } | undefined {
  const normalized = title.trim();
  if (!normalized || GENERIC_TITLES.has(normalized.toLowerCase()) || !isSafeCategorizationSource(normalized)) {
    return undefined;
  }
  if (/oauth/i.test(normalized) && /callback/i.test(normalized)) return { label: "OAuth callback work", signal: "oauth_callback" };
  if (/auth/i.test(normalized) && /middleware/i.test(normalized)) return { label: "Auth middleware work", signal: "auth_middleware" };
  if (/settings/i.test(normalized) && /ui|screen|panel|profile|account/i.test(normalized)) {
    return { label: "Settings UI work", signal: "settings_ui" };
  }
  if (/test|spec|verification/i.test(normalized)) return { label: "Test repair work", signal: "tests" };
  if (/docs|documentation/i.test(normalized)) return { label: "Documentation work", signal: "docs" };
  return undefined;
}

function labelFromClusters(clusters: string[]): string | undefined {
  // Settings+UI only when those are the only area signals. Broader Masthead work often
  // touches settings paths plus any .tsx (ui), docs, and tests — that must not collapse
  // every session to "Settings UI work".
  const unique = [...new Set(clusters)];
  if (unique.includes("settings") && unique.includes("ui") && unique.every((c) => c === "settings" || c === "ui")) {
    return "Settings UI work";
  }
  if (unique.length >= 3) return undefined;
  if (unique.includes("auth")) return "Auth work";
  if (unique.includes("settings") && !unique.includes("docs") && !unique.includes("tests")) return "Settings work";
  if (unique.includes("ui") && unique.length === 1) return "UI work";
  if (unique.includes("tests") && unique.length === 1) return "Test work";
  if (unique.includes("docs") && unique.length === 1) return "Documentation work";
  return undefined;
}

function labelFromEvents(events: NormalizedEvent[]): { label: string; signal: string } | undefined {
  const summaries = recentEventSummaries(events);
  if (!summaries || !isSafeCategorizationSource(summaries)) return undefined;
  if (/test|verification/i.test(summaries)) return { label: "Test work", signal: "tests" };
  if (/auth|oauth/i.test(summaries)) return { label: "Auth work", signal: "auth" };
  if (/ui|component|screen/i.test(summaries)) return { label: "UI work", signal: "ui" };
  return undefined;
}

function labelFromSpecificEvents(events: NormalizedEvent[]): { label: string; signal: string } | undefined {
  return labelFromSpecificText([recentEventSummaries(events)]);
}

function labelFromSpecificText(values: string[]): { label: string; signal: string } | undefined {
  const summaries = values.map((value) => value.trim()).filter(Boolean).slice(-3).join(" ");
  if (!summaries || !isSafeCategorizationSource(summaries)) return undefined;
  if (/\bheadline/i.test(summaries) && /\b(board|session card|card)\b/i.test(summaries)) {
    return { label: "Board headline work", signal: "headline" };
  }
  return undefined;
}

function recentEventSummaries(events: NormalizedEvent[]): string {
  return events.slice(-3).map((event) => event.summary).join(" ");
}

function labelFromFeedback(signal: LatestFeedbackSignal | undefined): { label: string; signal: string } | undefined {
  if (!signal) return undefined;
  if (signal.claims.includes("mentions_tests") || signal.claims.includes("mentions_error")) {
    return { label: "Verification follow-up", signal: "verification" };
  }
  if (signal.claims.includes("mentions_files")) return { label: "Changed-file review", signal: "files" };
  return undefined;
}

function pathClusters(gitSnapshots: GitSnapshot[]): string[] {
  const clusters = new Set<string>();
  for (const snapshot of gitSnapshots) {
    for (const changed of snapshot.changedPaths) {
      const path = changed.path.toLowerCase();
      if (path.includes("auth") || path.includes("oauth")) clusters.add("auth");
      if (path.includes("settings")) clusters.add("settings");
      if (path.includes("test") || path.includes("spec")) clusters.add("tests");
      if (path.includes("docs") || path.endsWith(".md")) clusters.add("docs");
      if (path.includes("/ui/") || path.endsWith(".tsx") || path.endsWith(".jsx") || path.endsWith(".css")) clusters.add("ui");
    }
  }
  return [...clusters].toSorted();
}

function isSafeCategorizationSource(value: string): boolean {
  return !(
    /\bhttps?:\/\//i.test(value) ||
    /(?:~|\.{1,2})?\/(?:[\w.@-]+\/)+[\w.@-]+/.test(value) ||
    /\b(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+\b/i.test(value) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /@/.test(value)
  );
}

function safeSignal(value: string): string {
  if (!isSafeCategorizationSource(value)) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}
