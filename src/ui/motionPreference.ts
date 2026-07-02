export const mastheadMotionDisabledStorageKey = "masthead:motion-disabled";

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
