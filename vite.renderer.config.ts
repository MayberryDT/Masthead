import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/**", "**/dist/**", "**/out/**", "**/.electron-resources/**"]
    }
  }
});
