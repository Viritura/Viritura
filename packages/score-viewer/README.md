# @viritura/score-viewer

Framework-free DOM presentation for `@viritura/score-engine` (no React or renderer dependency).
This package is private while the standalone distribution is prepared.

```ts
import { mountScore } from "@viritura/score-viewer";

const viewer = mountScore(element, mnxJson, { zoom: "fit-width", viewMode: "page" });
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

Options include `engine` (or lazy `loadEngine` with `assetBaseUrl` and `fonts`),
`viewMode` (`page`, `horizontal`, `spread`, `spread-horizontal`, `horizon`),
`pageWidth`, `pageHeight`, `pageMargins`, `spatium`, `scoreIndex`,
`zoom` (number, `fit-width`, `fit-page`), `pageGap`, `pagesPerRow`,
`spreadFirstPage`, `pageBackground`, `ink`, `background`, `playhead`,
`useWorker`, `onLoading`, `onReady`, `onLayout`, `onError`, and `onPaint`.
Pass `useWorker: true` to offload layouts; always call `destroy()` on unmount.

See [the plain HTML example](examples/vanilla.html) for both the viewer
and the presentation-free engine API.
