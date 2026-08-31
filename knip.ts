import type { KnipConfig } from "knip";

// Extract `import ... from "..."` statements from MDX so knip can follow them.
const mdxCompiler = (text: string): string =>
  (text.match(/^\s*import\s[\s\S]+?from\s+['"][^'"]+['"];?/gm) ?? []).join("\n");

const config: KnipConfig = {
  // Generated files: the codegen produces the full schema-derived type
  // universe, but only a subset is consumed at any given time. Excluding
  // them stops ~530 "unused export" / "unused exported type" reports
  // (raw.ts: ~273 types + raw-viritura.ts; wasmTypes.ts: full draw IR;
  // wasm-bindgen output for the WASM bridge).
  ignore: [
    "packages/format/src/mnx/generated/**",
    "packages/renderer/src/wasmTypes.ts",
    "engine/viritura-wasm/pkg-browser/**",
  ],
  // `wasm-pack` is invoked from `pnpm wasm:build` (rust toolchain installs it
  // out-of-band); it isn't an npm devDependency by design.
  ignoreBinaries: [
    "wasm-pack",
    // .NET is installed by the platform/SDK rather than npm.
    "dotnet",
  ],
  ignoreDependencies: [
    // `import { Buffer } from "buffer"` in apps/editor/src/main.tsx
    // is the npm `buffer` polyfill standing in for the Node builtin so
    // isomorphic-git can find a global `Buffer` in the browser. Knip sees
    // the bare specifier and assumes Node's builtin, so it doesn't credit
    // the npm package.
    "buffer",
  ],
  workspaces: {
    ".": {
      entry: ["scripts/*.{mjs,ts}", "build-site.ts", "deploy.ts"],
      project: ["*.{mjs,ts}", "scripts/**/*.{mjs,ts}"],
    },
    "apps/editor": {
      entry: [
        "index.html",
        "buildAssets.ts",
        "src/stories/**/*.stories.@(ts|tsx)",
        ".storybook/*.@(ts|tsx)",
        // Standalone Node profiling script, run manually via `tsx` (see
        // docs/setup/wasm-flame-chart.md). Not imported anywhere by design.
        "src/__tests__/profile-rhapsody.ts",
        // Instrument-profile / FX-chain surface: the barrel is the module's
        // public API but nothing in the editor consumes it yet, so knip sees
        // every export as unused. Treating the barrel as an entry point keeps
        // the API declared while the UI that will call it is still in flight.
        "src/instrumentProfiles/index.ts",
      ],
      project: ["buildAssets.ts", "src/**/*.{ts,tsx,mdx}"],
    },
    "packages/ui": {
      entry: ["src/**/*.stories.@(ts|tsx)", "src/**/*.mdx", ".storybook/*.@(ts|tsx)"],
      project: ["src/**/*.{ts,tsx,mdx}"],
    },
    "apps/vscode-mnx-viewer": {
      // The extension host lives under src/; the webview lives under webview/
      // and is bundled by a separate Vite build.
      entry: ["src/extension.ts", "webview/viewer.tsx", "scripts/*.ts"],
      project: ["src/**/*.{ts,tsx}", "webview/**/*.{ts,tsx}"],
    },
    "apps/server-ui": {
      entry: ["src/main.tsx"],
      project: ["src/**/*.{ts,tsx}"],
    },
    "apps/website": {
      entry: ["src/main.tsx"],
      project: ["scripts/**/*.ts", "src/**/*.{ts,tsx}"],
    },
    "packages/score-viewer-react": {
      // `vite-env.d.ts` references `vite/client` types; vite itself is the
      // build tool (declared upstream) so just include the env file as entry.
      entry: ["src/index.ts", "src/vite-env.d.ts"],
      project: ["src/**/*.{ts,tsx}"],
    },
    "packages/*": {
      // Reusable package entries are auto-discovered from package.json
      // "main"/"exports"; deployable application workspaces are explicit above.
      project: ["src/**/*.{ts,tsx}"],
    },
  },
  compilers: {
    mdx: mdxCompiler,
  },
};

export default config;
