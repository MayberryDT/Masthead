export const mastheadOnboardingDismissedStorageKey = "masthead:onboarding:dismissed:v1";
const mastheadDatabaseOnboardingDismissedStorageKey = "masthead:onboarding:dismissed:v2";
const mastheadOnboardingLastSeenDatabaseStorageKey = "masthead:onboarding:last-seen-database:v2";

export function readOnboardingDismissed(databaseId?: string): boolean {
  try {
    return window.localStorage.getItem(onboardingDismissedStorageKey(databaseId)) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(dismissed: boolean, databaseId?: string): void {
  try {
    const storageKey = onboardingDismissedStorageKey(databaseId);
    if (dismissed) {
      window.localStorage.setItem(storageKey, "1");
    } else {
      window.localStorage.removeItem(storageKey);
    }
    const canonicalDatabaseId = databaseId?.trim();
    if (canonicalDatabaseId) {
      window.localStorage.setItem(mastheadOnboardingLastSeenDatabaseStorageKey, canonicalDatabaseId);
    }
  } catch {
    // Local preference storage should not block app startup.
  }
}

/**
 * Resolves dismissal when canonical database identity first becomes available.
 *
 * The profile-wide v1 preference migrates only to the first database observed by
 * this v2 client. Later database identities must have their own scoped dismissal.
 */
export function resolveOnboardingDismissed(databaseId: string): boolean {
  const canonicalDatabaseId = databaseId.trim();
  if (!canonicalDatabaseId) return readOnboardingDismissed();

  try {
    const lastSeenDatabaseId = window.localStorage.getItem(mastheadOnboardingLastSeenDatabaseStorageKey);
    const scopedDismissal = readOnboardingDismissed(canonicalDatabaseId);
    if (!lastSeenDatabaseId) {
      const migratedDismissal = scopedDismissal || readOnboardingDismissed();
      if (migratedDismissal && !scopedDismissal) {
        window.localStorage.setItem(onboardingDismissedStorageKey(canonicalDatabaseId), "1");
      }
      window.localStorage.setItem(mastheadOnboardingLastSeenDatabaseStorageKey, canonicalDatabaseId);
      return migratedDismissal;
    }

    if (lastSeenDatabaseId !== canonicalDatabaseId) {
      window.localStorage.setItem(mastheadOnboardingLastSeenDatabaseStorageKey, canonicalDatabaseId);
    }
    return scopedDismissal;
  } catch {
    return false;
  }
}

function onboardingDismissedStorageKey(databaseId?: string): string {
  const canonicalDatabaseId = databaseId?.trim();
  if (!canonicalDatabaseId) return mastheadOnboardingDismissedStorageKey;
  return `${mastheadDatabaseOnboardingDismissedStorageKey}:${encodeURIComponent(canonicalDatabaseId)}`;
}
