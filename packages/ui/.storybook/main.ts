import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // UI storybook: design language docs + every primitive in @viritura/ui.
  // No app surfaces, no MNX content, no WASM engine — fast startup,
  // clean focus for design-system reviewers.
  stories: ["../src/docs/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: [
    {
      // remark-gfm enables GitHub-flavored markdown (pipe tables,
      // strikethrough, autolinks, task lists) in MDX docs. MDX 3 defaults
      // to CommonMark which silently breaks pipe tables.
      name: getAbsolutePath("@storybook/addon-docs"),
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [(await import("remark-gfm")).default],
          },
        },
      },
    },
  ],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {},
  },
  // Serve the shared font assets at `/fonts/*` so the UI Storybook
  // can use Bravura (SMuFL music font) for `useBravura` Button /
  // PaletteButton previews. Without this, `font-family: Bravura, serif`
  // silently falls back to the platform serif and music glyphs render
  // wrong. The @font-face declaration lives in preview-head.html.
  staticDirs: [{ from: "../../../assets/fonts", to: "/fonts" }],
};

export default config;

function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
