export type ObservabilityDataSource = "real" | "demo";

export type SourcedValue<T> = {
  value: T;
  source: ObservabilityDataSource;
};

export type DemoModelMetric = {
  model: string;
  tokens: string;
  cost: string;
  source: "demo";
};

export type DemoResourceSeries = {
  label: "CPU" | "Memory" | "Tokens / min";
  value: string;
  maxLabel: string;
  color: "blue" | "purple" | "green";
  points: number[];
  source: "demo";
};

export type DemoRecentError = {
  time: string;
  sessionId: string;
  message: string;
  source: "demo";
};

export type DemoSourcedValue<T> = {
  value: T;
  source: "demo";
};

export type DemoSessionTelemetry = {
  model: DemoSourcedValue<string>;
  harness: DemoSourcedValue<"Codex" | "Claude Code" | "OpenClaw" | "Hermes">;
  host: DemoSourcedValue<string>;
  commands: DemoSourcedValue<{ passed: number; total: number }>;
  filesChanged: DemoSourcedValue<{
    added: number;
    removed: number;
    bars: Array<"add" | "remove" | "neutral">;
  }>;
  progress: DemoSourcedValue<number>;
  platform: DemoSourcedValue<"Docker" | "Linux" | "Kubernetes">;
};

export const observabilityDemoTelemetry = {
  tokens24h: { value: "48.7M", source: "demo" },
  avgLatency: { value: "1.42s", source: "demo" },
  errors24h: { value: "37", source: "demo" },
  totalCost24h: { value: "$123.47", source: "demo" },
  topModels: [
    { model: "gpt-5.5", tokens: "31.4M", cost: "$0.00", source: "demo" },
    { model: "gpt-5.4", tokens: "17.3M", cost: "$0.00", source: "demo" }
  ] satisfies DemoModelMetric[],
  recentErrors: [
    { time: "10:25:07", sessionId: "s-0f9c2e6d", message: "Timeout waiting for response", source: "demo" },
    { time: "10:24:51", sessionId: "s-7b2d9e4a", message: "Webhook did not respond", source: "demo" },
    { time: "10:23:14", sessionId: "s-1d4e7b2c", message: "Invalid config value", source: "demo" }
  ] satisfies DemoRecentError[],
  resourceSeries: [
    {
      label: "CPU",
      value: "42%",
      maxLabel: "100%",
      color: "blue",
      points: [64, 58, 56, 52, 51, 48, 46, 44, 38, 42, 35, 32, 36],
      source: "demo"
    },
    {
      label: "Memory",
      value: "6.1 GB",
      maxLabel: "16 GB",
      color: "purple",
      points: [62, 60, 55, 49, 45, 44, 48, 52, 56, 58, 54, 50, 43],
      source: "demo"
    },
    {
      label: "Tokens / min",
      value: "12.4K",
      maxLabel: "30K",
      color: "green",
      points: [38, 42, 40, 45, 48, 44, 51, 47, 46, 49, 52, 50, 53],
      source: "demo"
    }
  ] satisfies DemoResourceSeries[]
} as const;

const models = ["gpt-5.5", "gpt-5.4"] as const;
const harnesses = ["Codex", "Claude Code", "OpenClaw", "Hermes"] as const;
const hosts = [
  "devbox-01",
  "devbox-03",
  "devbox-05",
  "devbox-07",
  "devbox-09",
  "devbox-11",
  "devbox-12",
  "build-agent-2",
  "ci-runner-04",
  "integration-2"
] as const;
const platforms = ["Docker", "Linux", "Kubernetes"] as const;

const telemetryOverrides: Record<string, DemoSessionTelemetry> = {
  "session-9f3a1c7e": sessionTelemetry({
    model: "gpt-5.5",
    harness: "Codex",
    host: "devbox-07",
    commands: { passed: 12, total: 12 },
    filesChanged: { added: 18, removed: 4 },
    progress: 100,
    platform: "Docker"
  }),
  "session-7b2d9e4a": sessionTelemetry({
    model: "gpt-5.5",
    harness: "Claude Code",
    host: "devbox-03",
    commands: { passed: 28, total: 30 },
    filesChanged: { added: 42, removed: 7 },
    progress: 93,
    platform: "Linux"
  }),
  "session-3c6a8f91": sessionTelemetry({
    model: "gpt-5.4",
    harness: "OpenClaw",
    host: "devbox-12",
    commands: { passed: 8, total: 8 },
    filesChanged: { added: 6, removed: 2 },
    progress: 100,
    platform: "Docker"
  }),
  "session-1a2b3c4d": sessionTelemetry({
    model: "gpt-5.4",
    harness: "Codex",
    host: "devbox-09",
    commands: { passed: 10, total: 25 },
    filesChanged: { added: 12, removed: 3 },
    progress: 40,
    platform: "Linux"
  }),
  "session-8e2b1d3f": sessionTelemetry({
    model: "gpt-5.5",
    harness: "Hermes",
    host: "devbox-01",
    commands: { passed: 14, total: 26 },
    filesChanged: { added: 21, removed: 5 },
    progress: 55,
    platform: "Docker"
  }),
  "session-2f7e3c11": sessionTelemetry({
    model: "gpt-5.4",
    harness: "Claude Code",
    host: "devbox-05",
    commands: { passed: 8, total: 20 },
    filesChanged: { added: 17, removed: 9 },
    progress: 20,
    platform: "Linux"
  }),
  "session-0f9c2e6d": sessionTelemetry({
    model: "gpt-5.5",
    harness: "Codex",
    host: "devbox-11",
    commands: { passed: 0, total: 4 },
    filesChanged: { added: 5, removed: 8 },
    progress: 0,
    platform: "Linux"
  }),
  "session-9c1d2e33": sessionTelemetry({
    model: "gpt-5.5",
    harness: "OpenClaw",
    host: "ci-runner-04",
    commands: { passed: 0, total: 6 },
    filesChanged: { added: 4, removed: 12 },
    progress: 0,
    platform: "Kubernetes"
  }),
  "session-6d4a9e0f": sessionTelemetry({
    model: "gpt-5.4",
    harness: "Hermes",
    host: "integration-2",
    commands: { passed: 0, total: 2 },
    filesChanged: { added: 1, removed: 2 },
    progress: 0,
    platform: "Docker"
  })
};

export function sessionDemoTelemetry(sessionId: string, index: number): DemoSessionTelemetry {
  const override = telemetryOverrides[sessionId];
  if (override) return override;

  const seed = stableSeed(sessionId) + index;
  const total = 8 + (seed % 22);
  const passed = Math.max(0, total - (seed % 4));
  const added = 3 + ((seed * 7) % 40);
  const removed = seed % 12;
  const addBars = Math.min(5, Math.ceil(added / 10));
  const removeBars = Math.min(3, Math.ceil(removed / 4));
  const bars = Array.from({ length: 10 }, (_, barIndex) => {
    if (barIndex < addBars) return "add" as const;
    if (barIndex < addBars + removeBars) return "remove" as const;
    return "neutral" as const;
  });

  return {
    model: { value: models[seed % models.length], source: "demo" },
    harness: { value: harnesses[seed % harnesses.length], source: "demo" },
    host: { value: hosts[seed % hosts.length], source: "demo" },
    commands: { value: { passed, total }, source: "demo" },
    filesChanged: { value: { added, removed, bars }, source: "demo" },
    progress: { value: 20 + ((seed * 17) % 81), source: "demo" },
    platform: { value: platforms[seed % platforms.length], source: "demo" }
  };
}

export function sourceLabelForDemoValue(value: { source: ObservabilityDataSource }): string {
  return value.source === "demo" ? "Demo data" : "Live data";
}

function stableSeed(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function sessionTelemetry({
  model,
  harness,
  host,
  commands,
  filesChanged,
  progress,
  platform
}: {
  model: (typeof models)[number];
  harness: (typeof harnesses)[number];
  host: (typeof hosts)[number];
  commands: { passed: number; total: number };
  filesChanged: { added: number; removed: number };
  progress: number;
  platform: (typeof platforms)[number];
}): DemoSessionTelemetry {
  return {
    model: { value: model, source: "demo" },
    harness: { value: harness, source: "demo" },
    host: { value: host, source: "demo" },
    commands: { value: commands, source: "demo" },
    filesChanged: { value: { ...filesChanged, bars: fileBars(filesChanged) }, source: "demo" },
    progress: { value: progress, source: "demo" },
    platform: { value: platform, source: "demo" }
  };
}

function fileBars({ added, removed }: { added: number; removed: number }): Array<"add" | "remove" | "neutral"> {
  const addBars = Math.min(5, Math.ceil(added / 10));
  const removeBars = Math.min(3, Math.ceil(removed / 4));
  return Array.from({ length: 10 }, (_, index) => {
    if (index < addBars) return "add";
    if (index < addBars + removeBars) return "remove";
    return "neutral";
  });
}
