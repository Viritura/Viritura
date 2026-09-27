# @viritura/score-engine

Framework-free music notation rendering kernel. MNX in; layout (Rust/WASM),
ink-only Canvas painting, SVG, geometry queries and a playback timeline out.

Page presentation — paper, shadows, zoom, scrolling, view modes, playhead
chrome — belongs to [`@viritura/score-viewer`](../score-viewer) (framework-free)
or [`@viritura/score-viewer-react`](../score-viewer-react).

> **Status:** `0.x`, not published to npm. Embedders outside the monorepo use
> the prebuilt distribution (see [Distribution](#distribution)). Breaking
> changes are possible before `1.0.0`. Public documentation:
> [viritura.com/developers](https://viritura.com/developers).

## Quick start

```ts
import { loadEngine } from "@viritura/score-engine";

const engine = await loadEngine();
const dl = engine.layout(mnx, { pageWidth: 800 });

const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#fff"; // paper is yours
ctx.fillRect(0, 0, canvas.width, canvas.height);
engine.paint(ctx, dl, { page: 0 });
```

`pageWidth: 0` selects unpaged (horizon) layout. `pageSetup` gives explicit
page height and margins in display-list units (CSS pixels at zoom 1).

## Contract

- **Loading.** `loadEngine({ assetBaseUrl?, fonts? })` loads WASM and fonts
  once. Failures reject with `EngineLoadError` (`wasm` / `font`) carrying the
  real cause, and a later call retries. `fonts: false` skips font loading when
  the host registers `Bravura` and `Viritura Serif` itself. The text face is
  registered under the private family `Viritura Serif`, so the host page's
  generic `serif` is untouched.
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

`pnpm build:score-engine-dist` (after `pnpm wasm:build`) writes
`dist/score-engine/`: ESM bundles `score-engine.js`, `score-engine.worker.js`
and `score-viewer.js` with all workspace code inlined, declarations, `wasm/`,
`fonts/`, licences and a `manifest.json` with the commit and SHA-256 of every
file. The bundles find `wasm/`, `fonts/` and the worker next to themselves.

CI (`.github/workflows/score-engine-dist.yml`) uploads this as a workflow
artifact on pushes to `main` that change the bundle's inputs (the Rust engine,
fonts, or the core/format/midi/renderer/score-engine/score-viewer packages), and
publishes a GitHub Release zip for tags `score-engine-v<version>` (the tag must
match `package.json`).
