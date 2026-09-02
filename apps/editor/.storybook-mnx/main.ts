import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import { syncMnxFixtures, syncMnxSchema, syncSharedAssets, syncSounds } from "../buildAssets";

syncSharedAssets();
syncSounds();
syncMnxSchema();
syncMnxFixtures();

const isPublicSite = process.env.VIRITURA_SITE === "true";
const publicTitle = "MNX Examples and Engraving Library | Viritura";
const publicDescription =
  "Browse rendered MNX notation examples covering the open specification, Viritura extensions, and engraving behavior.";

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
  managerHead: isPublicSite
    ? (head) => `${head}
<meta name="description" content="${publicDescription}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://viritura.com/mnx/examples/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Viritura">
<meta property="og:title" content="${publicTitle}">
<meta property="og:description" content="${publicDescription}">
<meta property="og:url" content="https://viritura.com/mnx/examples/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${publicTitle}">
<meta name="twitter:description" content="${publicDescription}">`
    : undefined,
  previewHead: isPublicSite ? (head) => `${head}\n<meta name="robots" content="noindex, nofollow">` : undefined,
  viteFinal: async (config) => {
    // When building for the unified site, serve under /mnx/examples/.
    if (isPublicSite) {
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
