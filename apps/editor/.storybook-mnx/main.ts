import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import { syncMnxFixtures, syncMnxSchema, syncSharedAssets, syncSounds } from "../buildAssets";

syncSharedAssets();
syncSounds();
syncMnxSchema();
syncMnxFixtures();

const config: StorybookConfig = {
  stories: [
    // MNX storybook: spec conformance, Viritura vendor extensions, and engraving behavior.
    // UI primitives + design language live in the @viritura/ui storybook (6005).
    // Composed app surfaces live in the App storybook (6007).
    "../src/stories/mnx-spec/**/*.stories.@(ts|tsx)",
    "../src/stories/viritura-extensions/**/*.stories.@(ts|tsx)",
    "../src/stories/engraving-behavior/**/*.stories.@(ts|tsx)",
  ],
  addons: [getAbsolutePath("@storybook/addon-docs")],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {},
  },
  staticDirs: ["../public"],
  viteFinal: async (config) => {
    // When building for the unified site, serve under /mnx/examples/.
    if (process.env.VIRITURA_SITE === "true") {
      config.base = "/mnx/examples/";
    }
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
