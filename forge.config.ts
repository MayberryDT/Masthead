import type { ForgeConfig } from "@electron-forge/shared-types";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { writeForgePackagedBundleManifests } from "./scripts/packaged-bundle-manifest.js";

const config: ForgeConfig = {
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      await writeForgePackagedBundleManifests(packageResult);
    }
  },
  packagerConfig: {
    asar: true,
    executableName: "masthead",
    extraResource: [".electron-resources/daemon", "public/assets/masthead-logo-sail.png"],
    icon: "public/assets/masthead-logo-sail",
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
          icon: "public/assets/masthead-logo-sail.png",
          maintainer: "Tyler Mayberry"
        }
      }
    },
    ...(process.env.MASTHEAD_ENABLE_RPM_MAKER === "1"
      ? [
          {
            name: "@electron-forge/maker-rpm",
            config: {
              options: {
                categories: ["Development"],
                icon: "public/assets/masthead-logo-sail.png"
              }
            }
          }
        ]
      : [])
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
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
    })
  ]
};

export default config;
