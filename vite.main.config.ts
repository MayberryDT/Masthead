import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const external = ["electron", "electron/main", "electron/common", ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`])];

export default defineConfig((env) => ({
  build: {
    lib: {
      entry: "src/electron/main.ts",
      fileName: () => "main.cjs",
      formats: ["cjs"]
    },
    rollupOptions: {
      external
    },
    target: "node24"
  },
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"]
  }
}));
