/**
 * esbuild settings shared by the release archive and the npm packages.
 *
 * Both define `__SCORE_ENGINE_BUNDLE__` so the engine looks for `wasm/`,
 * `fonts/` and its worker next to the bundle instead of relying on Vite's
 * `BASE_URL`, which only exists inside Viritura's own apps.
 */

import type { BuildOptions, Plugin } from "esbuild";

export interface ScoreBundleOptions {
  readonly commit: string | null;
  /** Minify identifiers and whitespace. The npm build leaves this off so consumers can read stack traces. */
  readonly minify: boolean;
}

export function scoreBundleOptions({ commit, minify }: ScoreBundleOptions): BuildOptions {
  return {
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify,
    // Folds the bundle flag so Viritura-only branches (Vite worker URLs) never reach consumers' bundlers.
    minifySyntax: true,
    sourcemap: "linked",
    legalComments: "eof",
    logLevel: "warning",
    metafile: true,
    define: {
      __SCORE_ENGINE_BUNDLE__: "true",
      __SCORE_ENGINE_COMMIT__: JSON.stringify(commit ?? ""),
      __VIRITURA_WASM_ASSET_HASH__: '""',
      "import.meta.env": "{}",
    },
  };
}

/**
 * Keep the given packages (and their subpaths, such as `react/jsx-runtime`)
 * as imports; inline everything else, including Viritura's internal
 * workspace packages.
 */
export function externalPackages(names: readonly string[]): Plugin {
  const isExternal = (spec: string): boolean => names.some((name) => spec === name || spec.startsWith(`${name}/`));
  return {
    name: "score-package-externals",
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (args) => (isExternal(args.path) ? { path: args.path, external: true } : null));
    },
  };
}
