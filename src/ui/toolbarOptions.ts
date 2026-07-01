export type HarnessFilter = "all" | "codex";
export type LifecycleFilter = "all" | "running" | "idle" | "blocked";
export type SortMode = "operational_priority" | "recent_activity" | "recently_started";
export type ActivityWindow = "1h" | "12h" | "24h" | "48h" | "3d" | "7d";
export type CardDensity = "comfortable" | "compact";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
};

export const HARNESS_OPTIONS = [
  { value: "all", label: "All Harnesses" },
  { value: "codex", label: "Codex" }
] satisfies SelectOption<HarnessFilter>[];

export const LIFECYCLE_OPTIONS = [
  { value: "all", label: "All Lifecycles" },
  { value: "running", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "blocked", label: "Blocked" }
] satisfies SelectOption<LifecycleFilter>[];

export const SORT_OPTIONS = [
  { value: "operational_priority", label: "Priority" },
  { value: "recent_activity", label: "Recent Activity" },
  { value: "recently_started", label: "Recently Started" }
] satisfies SelectOption<SortMode>[];

export const ACTIVITY_WINDOW_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "12h", label: "Last 12 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "48h", label: "Last 48 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last week" }
] satisfies SelectOption<ActivityWindow>[];

export const REFRESH_RATE_OPTIONS = [
  { value: 5_000, label: "5s" },
  { value: 10_000, label: "10s" },
  { value: 15_000, label: "15s" },
  { value: 20_000, label: "20s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "1m" }
] satisfies SelectOption<number>[];

export function activityWindowMs(window: ActivityWindow): number {
  switch (window) {
    case "1h":
      return 60 * 60_000;
    case "12h":
      return 12 * 60 * 60_000;
    case "24h":
      return 24 * 60 * 60_000;
    case "48h":
      return 48 * 60 * 60_000;
    case "3d":
      return 3 * 24 * 60 * 60_000;
    case "7d":
      return 7 * 24 * 60 * 60_000;
  }
}
