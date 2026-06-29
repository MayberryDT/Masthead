import { describe, expect, test } from "vitest";
import preloadConfig from "../../../vite.preload.config";

describe("Electron Vite config", () => {
  test("emits a CommonJS preload bundle for direct Electron launches", () => {
    const output = preloadConfig.build?.rollupOptions?.output;

    expect(output).toMatchObject({
      entryFileNames: "preload.cjs",
      format: "cjs"
    });
  });
});
