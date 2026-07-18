import { resolveOnboardingDismissed } from "./onboardingPreference";

export type OnboardingRouteSurface = "now" | "sources";

export function resolveDatabaseOnboardingRoute(
  databaseId: string,
  resolvedDatabaseIds: Set<string>
): OnboardingRouteSurface | undefined {
  const canonicalDatabaseId = databaseId.trim();
  if (!canonicalDatabaseId || resolvedDatabaseIds.has(canonicalDatabaseId)) return undefined;
  resolvedDatabaseIds.add(canonicalDatabaseId);
  return resolveOnboardingDismissed(canonicalDatabaseId) ? "now" : "sources";
}
