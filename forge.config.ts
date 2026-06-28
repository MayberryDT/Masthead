import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    executableName: "masthead",
    extraResource: [".electron-resources/daemon", "src-tauri/icons/icon.png"],
    icon: "src-tauri/icons/icon",
    name: "Masthead"
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      config: {}
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          categories: ["Development"],
          icon: "src-tauri/icons/icon.png",
          maintainer: "Tyler Mayberry"
        }
      }
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          categories: ["Development"],
          icon: "src-tauri/icons/icon.png"
        }
      }
    }
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          {
            entry: "src/electron/main.ts",
            config: "vite.main.config.ts"
          },
          {
            entry: "src/electron/preload.ts",
            config: "vite.preload.config.ts",
            target: "preload"
          }
        ],
        renderer: [
          {
            name: "main_window",
            config: "vite.renderer.config.ts"
          }
        ]
      }
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false
    })
  ]
};

export default config;
