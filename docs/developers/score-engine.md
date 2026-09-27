# Score Engine

`@viritura/score-engine` is the rendering kernel. It takes MNX in and gives
you layout, ink-only Canvas painting, SVG, geometry queries and a playback
timeline. Use it directly when the [Score Viewer](/developers/score-viewer)
doesn't fit, for example when you manage your own canvas, overlays, scrolling
or export pipeline.

## Load the engine

```sh
npm install @viritura/score-engine
```

```js
import { loadEngine } from "@viritura/score-engine";

const engine = await loadEngine({ assetBaseUrl: "/score-engine/" });
```

Without a bundler, import `score-engine.js` from the
[release archive](/developers#release-archive) by URL instead, and omit
`assetBaseUrl`.

`loadEngine` fetches the WebAssembly and fonts once. Concurrent calls share the
same load, and every later call returns the same engine.

| Option         | Default                    | Notes                                                              |
| -------------- | -------------------------- | ------------------------------------------------------------------ |
| `assetBaseUrl` | the module's own directory | Base URL containing `wasm/`, `fonts/` and `score-engine.worker.js` |
| `textFont`     | `true`                     | `false` to skip Libertinus Serif and use the page's `serif` font   |

If loading fails, the promise rejects with `EngineLoadError`. Its `code` is
`wasm` or `font`, and `cause` holds the underlying error. Calling
`loadEngine` again retries.

## Lay out and paint

```js
const displayList = engine.layout(mnx, { pageWidth: 800 });
const page = engine.measure(displayList).pages[0];

const canvas = document.querySelector("canvas");
const dpr = window.devicePixelRatio || 1;
canvas.width = page.width * dpr;
canvas.height = page.height * dpr;
canvas.style.width = `${page.width}px`;
canvas.style.height = `${page.height}px`;

const ctx = canvas.getContext("2d");
ctx.scale(dpr, dpr);
ctx.fillStyle = "#fff"; // the paper is yours
ctx.fillRect(0, 0, page.width, page.height);
engine.paint(ctx, displayList, { page: 0 });
```

`layout` returns a `DisplayList`, an opaque handle with `width`, `height`,
`pageCount` and `paged`. Its internals aren't part of the API; pass it back to
the engine to paint or query it. Layout units are CSS pixels at zoom 1.

`paint` draws one page's ink under whatever transform the context already has,
so you control device-pixel scaling, zoom and scrolling with `ctx.scale` and
`ctx.translate`. It never clears the canvas and never paints paper.

### Layout options

Changing any of these reflows the music, so they need a new `layout` call.

| Option       | Default                 | Notes                                                  |
| ------------ | ----------------------- | ------------------------------------------------------ |
| `pageWidth`  | required                | Page width in layout units. `0` selects unpaged layout |
| `spatium`    | `7`                     | Staff-space height, which sets the staff size          |
| `scoreIndex` | `0`                     | Which entry of the MNX `scores` array to render        |
| `pageSetup`  | engine page proportions | `{ height, margins: { top, right, bottom, left } }`    |

With `pageWidth: 0` the whole document is one continuous system on a single
page. `engine.horizonPaper(displayList)` returns the paper rectangle around the
music, plus the height a viewport needs to centre it.

### Paint options

| Option       | Default | Notes                                                                  |
| ------------ | ------- | ---------------------------------------------------------------------- |
| `page`       | `0`     | Zero-based page                                                        |
| `region`     | none    | Page-local rectangle; anything entirely outside it is skipped          |
| `ink`        | none    | Replaces default black ink, for dark themes. Explicit colours are kept |
| `background` | none    | Fill painted under the ink, for when you don't draw paper yourself     |

Use `region` to repaint only the visible part of a tall page.

## Errors

| Error             | Thrown by                    | Meaning                                 |
| ----------------- | ---------------------------- | --------------------------------------- |
| `EngineLoadError` | `loadEngine`                 | The WebAssembly or fonts failed to load |
| `ParseError`      | `layout`, `info`, `timeline` | The input isn't a readable MNX document |
| `LayoutError`     | `layout`                     | The engine failed while laying out      |

Each error has a `code` with the specific reason and a `cause` with the
underlying error, so you can use `instanceof` and `code` instead of matching
messages.

## Score information

```js
const info = engine.info(mnx);
// { parts: [{ id: "flute", index: 0, name: "Flute" }], measureCount: 32, scores: [{ index: 0, name: "Full score" }] }
```

`info` reads the document without running layout. Use `scores` to offer a
choice of MNX score definitions, then pass the chosen `index` as `scoreIndex`.
Part identifiers follow the
[stable part identifier](/developers#stable-part-identifiers) rule.

## Geometry

All geometry is in layout units and **page-local**: `y = 0` is the top of that
geometry's page.

| Method                                    | Returns                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `measure(displayList)`                    | Page sizes, page offsets, total height, widest page and parts                                       |
| `systems(displayList)`                    | Each system's page and rectangle, in reading order                                                  |
| `measures(displayList)`                   | Each measure on each staff: part, staff, system, page, rectangle, content start and length in beats |
| `positionToCanvas(displayList, position)` | Where a musical position lands on its part's top staff                                              |
| `playhead(displayList, position)`         | A cursor spanning the whole system at a musical position                                            |
| `canvasToBeat(displayList, page, x, y)`   | The musical position under a page-local point                                                       |

A position is either `{ beat }`, a global quarter-note beat, or
`{ measureIndex, beat }`, a beat within a measure. Add `partId` to pick the
staff it refers to.

```js
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const hit = engine.canvasToBeat(displayList, 0, event.clientX - rect.left, event.clientY - rect.top);
  if (hit) console.log(`measure ${hit.measureIndex + 1}, beat ${hit.beat}, part ${hit.partId}`);
});
```

This example assumes zoom 1 and no scrolling. Divide by your zoom and add your
scroll offset first if you use them.

## Playback timeline

```js
const timeline = engine.timeline(mnx);
// { totalBeats, totalSeconds, partIds, events, tempoMap }
```

The timeline says what plays when. It is deterministic and independent of
layout, so the same music always produces the same timeline whatever the page
size, and it can be computed on a server. Repeats and jumps are expanded by
default; pass `{ repeatExpansion: "ignore" }` for one pass in written order.

Each event has a `partId`, `beat`, `durationBeats`, `timeSeconds`, MIDI pitch,
an explicit dynamic when one is marked, and the MNX event `id` when the
document has one. `tempoMap` lists every tempo change in beats and seconds.

The engine doesn't play audio. Feed the timeline to Web Audio, a MIDI output or
your own synthesiser, and pass the current beat to `playhead` to draw a cursor.

## SVG export

```js
const svg = await engine.toSvg(displayList, { page: 0, ink: "#000" });
```

Returns a standalone SVG for one page. Text and glyphs are converted to
outlines, so the file displays the same without Viritura's fonts installed.

## Large documents

- **Off the main thread.** `engine.createLayoutWorker()` runs layout in a
  module worker. Its `layout(mnx, options)` has the same contract as
  `engine.layout` but returns a promise. Call `dispose()` when finished; pending
  layouts then reject.
- **Very long unpaged scores.** `engine.createTileRenderer()` paints the
  visible part of an unpaged layout from cached tiles. Call
  `paint(canvas, displayList, { scrollX, scrollY, zoom, background, ink })` on
  every scroll or frame; it returns `true` while tiles are still pending, so
  request another frame. Call `invalidate()` after a theme change.

## Version

```js
engine.version; // { engine: "0.1.0", package: "0.1.0", commit: "9e3ce8f1…" }
```

`engine` is the WebAssembly layout engine version, `package` is the
`@viritura/score-engine` version, and `commit` is the source commit of a
prebuilt bundle.
