import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import { syncMnxFixtures, syncMnxSchema, syncSharedAssets, syncSounds } from "../buildAssets";

syncSharedAssets();
syncSounds();
syncMnxSchema();
syncMnxFixtures();

const config: StorybookConfig = {
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
    // Ensure WASM files are served correctly
    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.exclude = [...(config.optimizeDeps.exclude || []), "viritura-wasm"];
    config.optimizeDeps.include = [...(config.optimizeDeps.include || []), "spessasynth_core", "spessasynth_lib"];
    return config;
  },
};

export default config;

function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
