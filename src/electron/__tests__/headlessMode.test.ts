import { describe, expect, test } from "vitest";
import { headlessDesktopPlan, isHeadlessElectronMode } from "../headless";
import { configureElectronRuntime } from "../runtime";

const PROVED_HEADLESS_ENV = {
  DISPLAY: ":1947",
  ELECTRON_OZONE_PLATFORM_HINT: "x11",
  GDK_BACKEND: "x11",
  MASTHEAD_HEADLESS: "1",
  MASTHEAD_PRIVATE_DISPLAY: ":1947",
  MASTHEAD_PRIVATE_DISPLAY_AUTHORITY: "/tmp/private/Xauthority",
  MASTHEAD_PRIVATE_DISPLAY_RUNTIME: "/tmp/private/runtime",
  MASTHEAD_PRIVATE_DISPLAY_TOKEN: "a".repeat(64),
  QT_QPA_PLATFORM: "xcb",
  XAUTHORITY: "/tmp/private/Xauthority",
  XDG_RUNTIME_DIR: "/tmp/private/runtime",
  XDG_SESSION_TYPE: "x11"
};

describe("Electron headless mode", () => {
  test("requires the complete private display proof before disabling presentation", () => {
    expect(isHeadlessElectronMode({})).toBe(false);
    expect(isHeadlessElectronMode(PROVED_HEADLESS_ENV)).toBe(true);
    expect(isHeadlessElectronMode({ ...PROVED_HEADLESS_ENV, DBUS_SESSION_BUS_ADDRESS: "disabled:" })).toBe(true);
    expect(() => isHeadlessElectronMode({ ...PROVED_HEADLESS_ENV, DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" })).toThrow("session bus");
    expect(() => isHeadlessElectronMode({ ...PROVED_HEADLESS_ENV, DISPLAY: ":0" })).toThrow("private display");
    expect(() => isHeadlessElectronMode({ ...PROVED_HEADLESS_ENV, WAYLAND_DISPLAY: "wayland-0" })).toThrow("Wayland");
  });

  test("boots the daemon without creating any window, tray, or presentation route", () => {
    expect(headlessDesktopPlan(PROVED_HEADLESS_ENV)).toEqual({
      createTray: false,
      createWindow: false,
      registerDesktopIpc: false,
      startConnectorInMain: true
    });
    expect(headlessDesktopPlan({})).toEqual({
      createTray: true,
      createWindow: true,
      registerDesktopIpc: true,
      startConnectorInMain: false
    });
  });

  test("forces software X11 before Electron initialization in proved headless mode", () => {
    const switches: Array<[string, string | undefined]> = [];
    configureElectronRuntime({ commandLine: { appendSwitch: (name, value) => switches.push([name, value]) } }, "linux", PROVED_HEADLESS_ENV);
    expect(switches).toEqual([
      ["disable-gpu-sandbox", undefined],
      ["disable-gpu", undefined],
      ["ozone-platform", "x11"]
    ]);
  });
});
