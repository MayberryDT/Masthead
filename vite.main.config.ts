import { defineConfig } from "vite";

export default defineConfig((env) => ({
  build: {
    lib: {
      entry: "src/electron/main.ts",
      fileName: () => "main.cjs",
      formats: ["cjs"]
    },
    target: "node24"
  }
}));
