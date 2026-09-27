# @viritura/score-viewer

Framework-free DOM presentation for `@viritura/score-engine` (no framework dependency).

```sh
npm install @viritura/score-viewer
```

```ts
import { mountScore } from "@viritura/score-viewer";

const viewer = mountScore(element, mnxJson, { zoom: "fit-width", viewMode: "page", assetBaseUrl: "/score-engine/" });
viewer.setOptions({ viewMode: "spread", pageBackground: "#171c25", ink: "#f5f5f5" });
viewer.update(nextMnx);
viewer.destroy();
```

`mountScore(element, mnx, options)` returns a `ScoreViewerHandle`: `update`,
`setOptions`, `zoomTo`, `scrollToPosition`, `playheadGeometry`, `destroy`, and
read-only `engine`, `displayList`, `measurements`, `arrangement`, `viewport`,
`surface`, and resolved `zoom`. MNX can be a JSON string, object, or null.
The viewer owns its viewport, page paper and shadows, high-DPI visible page
canvases, horizon tiles, loading/error states, resize/scroll handling, and
playhead follow. Only the currently visible pages have canvases.

Options include `engine` (or lazy `loadEngine` with `assetBaseUrl` and `textFont`),
`viewMode` (`page`, `horizontal`, `spread`, `spread-horizontal`, `horizon`),
`pageWidth`, `pageHeight`, `pageMargins`, `spatium`, `scoreIndex`,
`zoom` (number, `fit-width`, `fit-page`), `pageGap`, `pagesPerRow`,
`spreadFirstPage`, `pageBackground`, `ink`, `background`, `playhead`,
`useWorker`, `onLoading`, `onReady`, `onLayout`, `onError`, and `onPaint`.
Pass `useWorker: true` to offload layouts; always call `destroy()` on unmount.

In a bundled app, copy the engine's runtime files into your static assets and
pass their URL as `assetBaseUrl`; see the
[`@viritura/score-engine` README](../score-engine#serving-the-runtime-files).

See [the plain HTML example](examples/vanilla.html) for both the viewer
and the presentation-free engine API, using the release archive.

Public documentation: [viritura.com/developers/score-viewer](https://viritura.com/developers/score-viewer).
