import { afterEach, describe, expect, test, vi } from "vitest";
import { getDesktopBridge, invokeDesktopCommand, isDesktopBridgeAvailable } from "../desktopBridge";
import { notifySessionTransitionDesktop } from "../desktopNotify";
import { defaultLiveProjectionUrl } from "../liveProjectionClient";

describe("desktop bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("detects the Electron preload bridge when it is present", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    vi.stubGlobal("window", {
      mastheadDesktop: {
        platform: "darwin",
        invoke: async <T>(command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          return { ok: true } as T;
        }
      }
    });

    expect(isDesktopBridgeAvailable()).toBe(true);
    expect(getDesktopBridge()?.kind).toBe("electron");
    expect(getDesktopBridge()?.platform).toBe("darwin");
    await expect(invokeDesktopCommand("start_live_connector_command", { from: "test" })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ command: "start_live_connector_command", args: { from: "test" } }]);
  });

  test("uses the Electron preload projection URL as the default live projection", () => {
    vi.stubGlobal("window", {
      mastheadDesktop: {
        invoke: async <T>() => ({ ok: true }) as T,
        projectionUrl: "http://127.0.0.1:18444/projection"
      }
    });

    expect(defaultLiveProjectionUrl()).toBe("http://127.0.0.1:18444/projection");
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

  test("prefers the typed session transition notification bridge when available", async () => {
    const notifySessionTransition = vi.fn(async () => ({ ok: true, shown: true }) as const);
    const invoke = vi.fn();
    const input = { sessionId: "s1", transition: "idle" as const, title: "Session idle", body: "Idle" };
    vi.stubGlobal("window", {
      mastheadDesktop: { invoke, notifySessionTransition }
    });

    await expect(notifySessionTransitionDesktop(input)).resolves.toEqual({ ok: true, shown: true });
    expect(notifySessionTransition).toHaveBeenCalledWith(input);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("falls back to the generic transition command during preload cutover", async () => {
    const invoke = vi.fn(async <T>() => ({ ok: true, shown: false, reason: "unsupported" }) as T);
    const input = { sessionId: "s1", transition: "blocked" as const, title: "Approval needed" };
    vi.stubGlobal("window", {
      mastheadDesktop: { invoke }
    });

    await expect(notifySessionTransitionDesktop(input)).resolves.toEqual({ ok: true, shown: false, reason: "unsupported" });
    expect(invoke).toHaveBeenCalledWith("notify_session_transition_command", input);
  });

  test("returns bridge-unavailable notification results in a plain browser", async () => {
    vi.stubGlobal("window", {});

    expect(isDesktopBridgeAvailable()).toBe(false);
    expect(getDesktopBridge()).toBeUndefined();
    await expect(invokeDesktopCommand("start_live_connector_command")).resolves.toBeUndefined();
    await expect(
      notifySessionTransitionDesktop({ sessionId: "s1", transition: "ended", title: "Session ended" })
    ).resolves.toEqual({ ok: true, shown: false, reason: "bridge_unavailable" });
  });
});
