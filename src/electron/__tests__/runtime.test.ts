import { describe, expect, test, vi } from "vitest";
import { configureElectronRuntime } from "../runtime";

describe("Electron runtime configuration", () => {
  test("disables the GPU sandbox on Linux before app startup", () => {
    const appendSwitch = vi.fn();

    configureElectronRuntime({ commandLine: { appendSwitch } }, "linux");

    expect(appendSwitch).toHaveBeenCalledWith("disable-gpu-sandbox");
  });

  test("does not change GPU sandboxing on non-Linux platforms", () => {
    const appendSwitch = vi.fn();

    configureElectronRuntime({ commandLine: { appendSwitch } }, "darwin");

    expect(appendSwitch).not.toHaveBeenCalled();
  });
});
