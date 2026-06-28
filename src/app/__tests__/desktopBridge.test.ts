import { afterEach, describe, expect, test, vi } from "vitest";
import { getDesktopBridge, invokeDesktopCommand, isDesktopBridgeAvailable } from "../desktopBridge";

describe("desktop bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("detects the Electron preload bridge when it is present", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    vi.stubGlobal("window", {
      mastheadDesktop: {
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ok: true } as T;
        }
      }
    });

    expect(isDesktopBridgeAvailable()).toBe(true);
    expect(getDesktopBridge()?.kind).toBe("electron");
    await expect(invokeDesktopCommand("start_live_connector_command", { from: "test" })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ command: "start_live_connector_command", args: { from: "test" } }]);
  });

  test("uses the Electron preload bridge for desktop commands", async () => {
    const invoke = vi.fn(async <T>() => "electron-result" as T);
    vi.stubGlobal("window", {
      mastheadDesktop: { invoke }
    });

    await expect(invokeDesktopCommand("open_data_directory_command", { path: "/tmp/masthead" })).resolves.toBe("electron-result");
    expect(invoke).toHaveBeenCalledWith("open_data_directory_command", { path: "/tmp/masthead" });
  });

  test("routes custom window chrome commands through the bridge", async () => {
    const invoke = vi.fn(async <T>() => ({ ok: true }) as T);
    vi.stubGlobal("window", {
      mastheadDesktop: { invoke }
    });

    await expect(invokeDesktopCommand("window_minimize_command")).resolves.toEqual({ ok: true });
    await expect(invokeDesktopCommand("window_maximize_command")).resolves.toEqual({ ok: true });
    await expect(invokeDesktopCommand("window_close_command")).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenNthCalledWith(1, "window_minimize_command", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "window_maximize_command", undefined);
    expect(invoke).toHaveBeenNthCalledWith(3, "window_close_command", undefined);
  });

  test("returns undefined in a plain browser", async () => {
    vi.stubGlobal("window", {});

    expect(isDesktopBridgeAvailable()).toBe(false);
    expect(getDesktopBridge()).toBeUndefined();
    await expect(invokeDesktopCommand("start_live_connector_command")).resolves.toBeUndefined();
  });
});
