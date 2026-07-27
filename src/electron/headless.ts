export type HeadlessDesktopPlan = {
  createTray: boolean;
  createWindow: boolean;
  registerDesktopIpc: boolean;
  startConnectorInMain: boolean;
};

const PRIVATE_MARKERS = [
  "MASTHEAD_PRIVATE_DISPLAY",
  "MASTHEAD_PRIVATE_DISPLAY_AUTHORITY",
  "MASTHEAD_PRIVATE_DISPLAY_RUNTIME",
  "MASTHEAD_PRIVATE_DISPLAY_TOKEN"
] as const;

export function isHeadlessElectronMode(environment: NodeJS.ProcessEnv = process.env): boolean {
  const requested = environment.MASTHEAD_HEADLESS === "1";
  if (!requested) {
    if (PRIVATE_MARKERS.some((key) => environment[key])) {
      throw new Error("Electron received a partial private display environment without headless authority.");
    }
    return false;
  }
  if (
    !/^:[1-9]\d*$/u.test(environment.DISPLAY || "") ||
    environment.DISPLAY !== environment.MASTHEAD_PRIVATE_DISPLAY
  ) throw new Error("Electron headless DISPLAY does not match the attested private display.");
  if (
    !environment.XAUTHORITY?.startsWith("/") ||
    environment.XAUTHORITY !== environment.MASTHEAD_PRIVATE_DISPLAY_AUTHORITY
  ) throw new Error("Electron headless authority does not match the private display.");
  if (
    !environment.XDG_RUNTIME_DIR?.startsWith("/") ||
    environment.XDG_RUNTIME_DIR !== environment.MASTHEAD_PRIVATE_DISPLAY_RUNTIME
  ) throw new Error("Electron headless runtime does not match the private display.");
  if (!environment.MASTHEAD_PRIVATE_DISPLAY_TOKEN || environment.MASTHEAD_PRIVATE_DISPLAY_TOKEN.length < 32) {
    throw new Error("Electron headless private display token is missing or invalid.");
  }
  if (environment.WAYLAND_DISPLAY) throw new Error("Electron headless mode must not retain a Wayland display.");
  if (
    (environment.DBUS_SESSION_BUS_ADDRESS && environment.DBUS_SESSION_BUS_ADDRESS !== "disabled:") ||
    environment.SESSION_MANAGER
  ) {
    throw new Error("Electron headless mode must not retain the real desktop session bus.");
  }
  if (
    environment.XDG_SESSION_TYPE !== "x11" || environment.GDK_BACKEND !== "x11" ||
    environment.QT_QPA_PLATFORM !== "xcb" || environment.ELECTRON_OZONE_PLATFORM_HINT !== "x11"
  ) throw new Error("Electron headless mode must force the private X11 backend.");
  return true;
}

export function headlessDesktopPlan(environment: NodeJS.ProcessEnv = process.env): HeadlessDesktopPlan {
  const headless = isHeadlessElectronMode(environment);
  return {
    createTray: !headless,
    createWindow: !headless,
    registerDesktopIpc: !headless,
    startConnectorInMain: headless
  };
}
