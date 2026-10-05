# Score Viewer

`@viritura/score-viewer` turns a container element into a scrollable,
zoomable score. It doesn't depend on any UI framework, and it loads the engine,
WebAssembly and fonts on first use.

## Embed a score

Install it from npm, or use `score-viewer.js` from the
[release archive](/developers#release-archive) as below:

```sh
npm install @viritura/score-viewer
```

```html
<div id="score" style="height: 80vh"></div>
<script type="module">
  import { mountScore } from "./score-engine/score-viewer.js";

  const mnx = await fetch("./my-score.mnx").then((response) => response.text());
  const viewer = mountScore(document.getElementById("score"), mnx, {
    zoom: "fit-width",
    viewMode: "page",
  });
</script>
```

Give the container a height. The viewer fills it and scrolls inside it. MNX
can be a JSON string, a parsed object, or `null` for an empty viewer.

Always call `viewer.destroy()` when you remove the container. It disconnects
the resize observer, stops scheduled paints and terminates any layout worker.

## Update and reconfigure

```js
viewer.update(nextMnx); // new document, same options
viewer.setOptions({ viewMode: "spread", zoom: 1.25 });
viewer.zoomTo("fit-page");
```

`setOptions` merges with the current options. Changes to presentation, such as
zoom, page gap, colours or the playhead, only repaint. Changes that affect
engraving, such as page size, margins, staff size, score selection or switching
into or out of `horizon`, run layout again.

## Use it from a framework

The viewer manages its own DOM inside the container, so any framework can host
it: mount once, call `update` when the document changes, and `destroy` on
unmount. In React:

```tsx
import { useEffect, useRef } from "react";
import { mountScore, type ScoreViewerHandle } from "@viritura/score-viewer";

export function Score({ mnx }: { mnx: string }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<ScoreViewerHandle | null>(null);

  useEffect(() => {
    viewer.current = mountScore(container.current!, null, { zoom: "fit-width", assetBaseUrl: "/score-engine/" });
    return () => viewer.current?.destroy();
  }, []);

  useEffect(() => viewer.current?.update(mnx), [mnx]);

  return <div ref={container} style={{ height: "80vh" }} />;
}
```

Vue (`onMounted` / `onBeforeUnmount`), Svelte (`onMount`) and web components
(`connectedCallback` / `disconnectedCallback`) follow the same pattern.

For React, [Score Viewer React](/developers/score-viewer-react) does this for
you and adds components, hooks, a control bar, and playhead and page-overlay
slots.

## View modes

| `viewMode`          | Result                                                    |
| ------------------- | --------------------------------------------------------- |
| `page`              | Pages stacked vertically (default)                        |
| `horizontal`        | Pages in one row                                          |
| `spread`            | Facing pages, stacked vertically                          |
| `spread-horizontal` | Facing pages in one row                                   |
| `horizon`           | One continuous, unpaged system, painted from cached tiles |

`spreadFirstPage` controls whether the first page of a spread stands alone
(`single`, like a right-hand title page) or is paired (`paired`).
`pagesPerRow` sets a fixed number of pages per row in `page` mode.

Only visible pages get a canvas, and `horizon` paints only the visible tiles, so
very long scores stay responsive.

## Options

| Option           | Default    | Notes                                                                              |
| ---------------- | ---------- | ---------------------------------------------------------------------------------- |
| `viewMode`       | `page`     | See [View modes](#view-modes)                                                      |
| `zoom`           | `1`        | A number, `fit-width` or `fit-page`. At `1`, one layout unit is one CSS pixel      |
| `pageWidth`      | `800`      | Page width in layout units; ignored in `horizon`                                   |
| `pageHeight`     | A4 ratio   | Page height in layout units                                                        |
| `pageMargins`    | 15 mm      | `{ top, right, bottom, left }` in layout units; also applied in `horizon` when set |
| `spatium`        | `7`        | Staff-space height; this sets the staff size                                       |
| `scoreIndex`     | `0`        | Which entry of the MNX `scores` array to render                                    |
| `pageGap`        | `16`       | CSS pixels between pages                                                           |
| `pageBackground` | `#fff`     | Paper colour                                                                       |
| `contentAlign`   | `"start"`  | `"center"` centres a score smaller than the viewport; larger axes still scroll     |
| `ink`            | none       | Replaces default black ink, for dark themes; explicit colours are kept             |
| `background`     | none       | Viewport colour behind the pages                                                   |
| `playhead`       | none       | See [Playhead](#playhead)                                                          |
| `useWorker`      | `false`    | Run layout in a worker so large documents don't block the page                     |
| `engine`         | none       | Share an already loaded engine                                                     |
| `assetBaseUrl`   | module dir | Base URL containing `wasm/`, `fonts/` and `score-engine.worker.js`                 |
| `textFont`       | `true`     | `false` to skip Libertinus Serif and use the page's `serif` font                   |

### Callbacks

| Callback    | Called when                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `onLoading` | Engine loading or a layout starts                                        |
| `onReady`   | The first layout is ready: `{ engine, displayList }`                     |
| `onLayout`  | Any layout finishes: `(measurements, arrangement)`                       |
| `onPaint`   | Visible pages were painted                                               |
| `onError`   | The engine failed to load, or the document could not be read or laid out |

A failed engine load can be retried by mounting again or by calling `update`.

## Playhead

```js
viewer.setOptions({ playhead: { beat: 12.5, follow: true } });
viewer.setOptions({ playhead: { measureIndex: 4, beat: 1, partId: "wind.flutes.flute" } });
viewer.setOptions({ playhead: null }); // hide
```

A position is either a global quarter-note beat or a measure index and a beat
within that measure. `partId` picks the staff the cursor aligns to. With
`follow: true`, the viewer scrolls to keep the playhead in view.

`viewer.playheadGeometry()` returns the current cursor rectangle if you want to
draw your own. `viewer.scrollToPosition(position)` scrolls to a position
without showing a playhead.

## Handle properties

The handle returned by `mountScore` also exposes:

| Property       | Contents                                                           |
| -------------- | ------------------------------------------------------------------ |
| `engine`       | The loaded engine, or `null` while loading                         |
| `displayList`  | The current layout, for [engine](/developers/score-engine) queries |
| `measurements` | Page sizes and parts                                               |
| `arrangement`  | Where each page sits on the scrolling surface, in CSS pixels       |
| `viewport`     | The scrolling element                                              |
| `surface`      | The element that holds the pages; place your own overlays here     |
| `zoom`         | The resolved zoom factor, even when you asked for `fit-width`      |

To place an overlay, position it inside `surface`. Page positions in
`arrangement.positions` already include zoom. Engine geometry is page-local and
unzoomed, so convert it like this:

```js
const { engine, displayList, arrangement, zoom } = viewer;
for (const measure of engine.measures(displayList)) {
  const page = arrangement.positions[measure.page];
  const left = page.x + measure.x * zoom;
  const top = page.y + measure.y * zoom;
  // place an element at (left, top) inside viewer.surface
}
```

## Dark themes

```js
viewer.setOptions({ pageBackground: "#1b1f27", ink: "#e8e8e8", background: "#101318" });
```

`ink` only replaces the default black ink. Anything the document colours
explicitly keeps its colour.
