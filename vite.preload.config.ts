import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron", "electron/renderer"],
      input: "src/electron/preload.ts",
      output: {
        chunkFileNames: "preload.cjs",
        entryFileNames: "preload.cjs",
        format: "cjs"
      }
    },
    target: "chrome142"
  }
});
