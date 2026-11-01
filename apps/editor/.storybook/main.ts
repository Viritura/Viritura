import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import { cssBuildOptions } from "../../../scripts/cssBuild";
import { syncMnxFixtures, syncMnxSchema, syncMusxImporter, syncSharedAssets, syncSounds } from "../buildAssets";
import { containerWatchOptions } from "../../../infra/dev/viteWatch";

syncSharedAssets();
syncSounds();
syncMusxImporter();
syncMnxSchema();
syncMnxFixtures();

const config: StorybookConfig = {
  typescript: {
    reactDocgen: "react-docgen-typescript",
  },
  // App storybook: composed editor surfaces only (StartCenter, modes,
  // dialogs in context, embeddable ScoreView). Design language docs and
  // UI primitives live in the @viritura/ui storybook (port 6005).
  // MNX spec + Viritura extensions live in storybook:mnx (port 6006).
  stories: ["../src/stories/app/**/*.stories.@(ts|tsx)", "../src/stories/embeddable/**/*.stories.@(ts|tsx)"],
  addons: [getAbsolutePath("@storybook/addon-docs")],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {},
  },
  staticDirs: ["../public"],
  viteFinal: async (config) => {
    config.build = { ...config.build, ...cssBuildOptions };
    config.cacheDir = process.env.VIRITURA_VITE_CACHE_DIR;
    // Ensure WASM files are served correctly
    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.exclude = [...(config.optimizeDeps.exclude || []), "viritura-wasm", "@viritura/renderer"];
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include || []),
      "spessasynth_core",
      "spessasynth_lib",
      "comlink",
      "pdf-lib",
      "@pdf-lib/fontkit",
      "@viritura/core",
      "@viritura/format",
      "@viritura/ui",
    ];
    const containerHost = process.env.VIRITURA_CONTAINER_HOST;
    if (containerHost) {
      const hmr = config.server?.hmr;
      config.server = {
        ...config.server,
        allowedHosts: [".localhost"],
        hmr: { ...(typeof hmr === "object" ? hmr : {}), clientPort: 80, protocol: "ws" },
        watch: containerWatchOptions(containerHost),
      };
    }
    return config;
  },
};

export default config;

function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
