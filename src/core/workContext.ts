import type { GitSnapshot, LatestFeedbackSignal, NormalizedEvent, WorkAreaContext } from "./types";

type DeriveWorkContextInput = {
  title: string;
  branchOrWorktree?: string;
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  latestFeedbackSignal?: LatestFeedbackSignal;
};

const GENERIC_TITLES = new Set(["codex session", "untitled session", "session"]);

export function deriveWorkContext(input: DeriveWorkContextInput): WorkAreaContext {
  const clusters = pathClusters(input.gitSnapshots);
  const titleMatch = labelFromTitle(input.title);
  if (titleMatch) {
    return context(titleMatch.label, "title", clusters, [`title:${titleMatch.signal}`]);
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
  if (clusters.includes("settings") && clusters.includes("ui")) return "Settings UI work";
  if (clusters.includes("auth")) return "Auth work";
  if (clusters.includes("settings")) return "Settings work";
  if (clusters.includes("ui")) return "UI work";
  if (clusters.includes("tests")) return "Test work";
  if (clusters.includes("docs")) return "Documentation work";
  return undefined;
}

function labelFromEvents(events: NormalizedEvent[]): { label: string; signal: string } | undefined {
  const summaries = events.slice(-3).map((event) => event.summary).join(" ");
  if (!summaries || !isSafeCategorizationSource(summaries)) return undefined;
  if (/test|verification/i.test(summaries)) return { label: "Test work", signal: "tests" };
  if (/auth|oauth/i.test(summaries)) return { label: "Auth work", signal: "auth" };
  if (/ui|component|screen/i.test(summaries)) return { label: "UI work", signal: "ui" };
  return undefined;
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
