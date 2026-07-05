export const mastheadMotionDisabledStorageKey = "masthead:motion-disabled";
export const mastheadSessionEndedNotificationsStorageKey = "masthead:session-ended-notifications";


export function readStoredMotionDisabled(): boolean {
  const storage = browserStorage();
  if (!storage) return false;

  try {
    return storage.getItem(mastheadMotionDisabledStorageKey) === "1";
  } catch {
    return false;
  }
}

export function writeStoredMotionDisabled(disabled: boolean): void {
  const storage = browserStorage();
  if (!storage) return;

  try {
    if (disabled) storage.setItem(mastheadMotionDisabledStorageKey, "1");
    else storage.removeItem(mastheadMotionDisabledStorageKey);
  } catch {
    // Local preferences should not break the app when storage is unavailable.
  }
}

export function prefersReducedMotion(): boolean {
  if (appMotionDisabled()) return true;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function appMotionDisabled(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.getAttribute("data-masthead-motion") === "off" ||
    document.querySelector(".masthead-shell")?.getAttribute("data-motion-mode") === "off"
  );
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}


export function readStoredSessionEndedNotificationsEnabled(): boolean {
  const storage = browserStorage();
  if (!storage) return true;
  try {
    const value = storage.getItem(mastheadSessionEndedNotificationsStorageKey);
    return value !== "0";
  } catch {
    return true;
  }
}

export function writeStoredSessionEndedNotificationsEnabled(enabled: boolean): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    if (enabled) storage.removeItem(mastheadSessionEndedNotificationsStorageKey);
    else storage.setItem(mastheadSessionEndedNotificationsStorageKey, "0");
  } catch {
    // ignore
  }
}
