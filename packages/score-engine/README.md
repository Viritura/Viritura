# @viritura/score-engine

Framework-free music notation rendering kernel. MNX in; layout (Rust/WASM),
ink-only Canvas painting, SVG, geometry queries and a playback timeline out.

Page presentation — paper, shadows, zoom, scrolling, view modes, playhead
chrome — belongs to [`@viritura/score-viewer`](../score-viewer) (framework-free)
or [`@viritura/score-viewer-react`](../score-viewer-react).

> **Status:** `0.x`. Breaking changes are possible before `1.0.0`; pin an
> exact version. Public documentation:
> [viritura.com/developers](https://viritura.com/developers).

## Quick start

```sh
npm install @viritura/score-engine
```

```ts
import { loadEngine } from "@viritura/score-engine";

const engine = await loadEngine({ assetBaseUrl: "/score-engine/" });
const dl = engine.layout(mnx, { pageWidth: 800 });

const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#fff"; // paper is yours
ctx.fillRect(0, 0, canvas.width, canvas.height);
engine.paint(ctx, dl, { page: 0 });
```

`pageWidth: 0` selects unpaged (horizon) layout. `pageSetup` gives explicit
page height and margins in display-list units (CSS pixels at zoom 1).

## Serving the runtime files

The engine loads `wasm/`, `fonts/` and `score-engine.worker.js` at runtime
from one base URL, which defaults to the directory of the engine module. A
bundler moves the engine's code away from those files, so copy them from
`node_modules/@viritura/score-engine/dist/` into your static assets and pass
their URL as `assetBaseUrl`:

```sh
cp -r node_modules/@viritura/score-engine/dist/{wasm,fonts,score-engine.worker.js} public/score-engine/
```

See [Serving the files](https://viritura.com/developers#serving-the-files) for
the Content Security Policy and font requirements.

## Contract

- **Loading.** `loadEngine({ assetBaseUrl?, textFont? })` loads WASM and fonts
  once. Failures reject with `EngineLoadError` (`wasm` / `font`) carrying the
  real cause, and a later call retries. Bravura is always loaded: layout uses
  its metrics, so other music fonts are unsupported. The text face is
  registered under the private family `Viritura Serif`, so the host page's
  generic `serif` is untouched; `textFont: false` skips it and text falls back
  to the page's `serif`.
- **Opaque layouts.** `layout()` returns a `DisplayList` handle
  (`width`, `height`, `pageCount`, `paged`). Its internals are not API.
  `createLayoutWorker()` produces the same handles off the main thread.
- **Ink only.** `paint(ctx, dl, { page, region, ink, background })` draws under
  the caller's current transform (DPR, zoom, scroll) and never clears.
  `ink` recolours default black ink (dark themes) and keeps explicit colours.
- **Page-local geometry.** `measure`, `systems`, `measures`, `positionToCanvas`,
  `playhead` and `canvasToBeat` use page-local coordinates (`y = 0` is the top
  of that page). `horizonPaper` gives the paper rectangle for unpaged layouts.
- **Stable part IDs.** Parts are identified by the source MNX `parts[n].id`, or
  `#<n>` (0-based) when absent — the same in `info`, `measure`, geometry and
  `timeline`.
- **Timeline.** `timeline(mnx, { repeatExpansion })` is layout-independent and
  deterministic, uses real meters, and expands repeats by default.
- **SVG.** `toSvg(dl, { page, ink })` returns a standalone SVG with text and
  glyphs as outlines.
- **Large unpaged scores.** `createTileRenderer()` paints a viewport from
  cached tiles.

## Distribution

The engine is published to npm alongside `@viritura/score-viewer` and
`@viritura/score-viewer-react`, each versioned independently, and as a
standalone release archive for pages without a build step.

### npm

`pnpm build:npm-packages` (after `pnpm wasm:build`) writes each package's
`dist/`: an ES module with Viritura's internal workspace packages inlined,
declarations, and (for this package) the worker, `wasm/`, `fonts/` and
licences. `publishConfig` points the packed manifest at `dist/`, while the
workspace keeps importing `src/`. `pnpm verify:npm-packages --render` packs
all three, installs the tarballs into a fresh npm + Vite project and renders
with them in headless Chromium.

npm holds the released versions: the workspace manifests carry `0.0.0-dev`,
and the viewers depend on siblings through `workspace:^`, which packs as a
caret range. To release, run **Publish npm packages**
(`.github/workflows/npm-publish.yml`) from `main` and pick `patch`, `minor` or
`major` for each package to release. The run bumps each selected package from
its latest npm version (`pnpm score-release plan` shows the result locally),
verifies them together, and publishes in dependency order with npm trusted
publishing (no token) and provenance. Each release gets a
`<package>-v<version>` tag and GitHub Release; the engine's carries the zip
archive. A viewer released on its own is verified against the engine from npm,
and the run refuses releases whose ranges would not resolve. The default
`dry_run` does everything except upload. Keep changelog entries under
`Unreleased` and move them under the version after a release.

### Release archive

`pnpm build:score-engine-dist` (after `pnpm wasm:build`) writes
`dist/score-engine/`: ESM bundles `score-engine.js`, `score-engine.worker.js`
and `score-viewer.js` with all workspace code inlined, declarations, `wasm/`,
`fonts/`, licences and a `manifest.json` with the commit and SHA-256 of every
file. The bundles find `wasm/`, `fonts/` and the worker next to themselves.

CI (`.github/workflows/score-engine-dist.yml`) uploads this as a workflow
artifact on pushes to `main` that change the bundle's inputs (the Rust engine,
fonts, or the core/format/midi/renderer/score-engine/score-viewer packages).
Release archives are attached to engine releases by the publish workflow.
