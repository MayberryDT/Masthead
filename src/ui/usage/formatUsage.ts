export function formatUsageNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompactUsage(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0
  }).format(value);
}

export function formatTokensPerMinute(value: number | undefined): string {
  if (value === undefined) return "n/a";
  return `${formatCompactUsage(Math.round(value))}/m`;
}

export function formatBucket(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
