export const mastheadOnboardingDismissedStorageKey = "masthead:onboarding:dismissed:v1";

export function readOnboardingDismissed(): boolean {
  try {
    return window.localStorage.getItem(mastheadOnboardingDismissedStorageKey) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      window.localStorage.setItem(mastheadOnboardingDismissedStorageKey, "1");
    } else {
      window.localStorage.removeItem(mastheadOnboardingDismissedStorageKey);
    }
  } catch {
    // Local preference storage should not block app startup.
  }
}
