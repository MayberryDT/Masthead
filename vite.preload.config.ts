import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: "preload.cjs",
        entryFileNames: "preload.cjs"
      }
    },
    target: "chrome142"
  }
});
