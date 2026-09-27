# Score Viewer React

`@viritura/score-viewer-react` wraps the [Score Viewer](/developers/score-viewer)
in React components and hooks. It works with React 18 and 19.

> [!NOTE]
> **Availability: Viritura workspace only**
>
> The React package isn't in the release archive yet. Outside the Viritura
> repository, call `mountScore` from the prebuilt `score-viewer.js` in an
> effect, as shown in [Without the React package](#without-the-react-package).

## Complete viewer

```tsx
import { ScoreViewer } from "@viritura/score-viewer-react";

export function Example({ mnx }: { mnx: string }) {
  return <ScoreViewer mnx={mnx} defaultFitMode="width" defaultViewMode="page" enableCtrlWheelZoom />;
}
```

`<ScoreViewer>` fills its parent, so give the parent a height. It includes a
control bar for view mode, zoom and fit. The first instance loads the engine,
and later instances share it.

### Controls

```tsx
<ScoreViewer
  mnx={mnx}
  availableViewModes={["page", "spread", "horizon"]}
  controls={{ score: true, viewMode: true, zoom: true, fit: true, pageSize: true, staffSize: true }}
  controlSurface="toolbar"
  scoreOptions={[
    { index: 0, label: "Full score" },
    { index: 1, label: "Flute" },
  ]}
/>
```

- `controls` is `true`, `false` or an object that turns individual controls on.
  Page size and staff size are hidden in `horizon`, which has no pages.
- `controlSurface` is `floating-status` (default), `toolbar` or `none`.
- `scoreOptions` lists MNX score definitions for the score selector. Get the
  names from `engine.info(mnx).scores`.
- `pageSizeOptions` and `staffSizeOptions` fill the page-size and staff-size
  selectors.

Every control is available controlled or uncontrolled, in the usual React
pattern: `viewMode` or `defaultViewMode` with `onViewModeChange`, and likewise
for `zoom`, `fitMode` (`none`, `width`, `page`), `scoreIndex` and `staffSize`.
`minZoom`, `maxZoom` and `zoomStep` bound the zoom buttons and Ctrl-scroll.

## Score without chrome

`<ScoreView>` renders only the pages, for hosts that bring their own controls.

```tsx
import { ScoreView } from "@viritura/score-viewer-react";

<ScoreView mnx={mnx} viewMode="spread" zoom="fit-width" pageBackground="#fff" />;
```

It accepts the viewer's layout and presentation options as props: `pageWidth`,
`pageHeight`, `pageMargins`, `spatium`, `scoreIndex`, `viewMode`, `zoom`, `gap`,
`spreadFirstPage`, `pagesPerRow`, `pageBackground`, `ink` and `assetBaseUrl`.
Pass `bare` to remove the viewport padding when embedding a cropped fragment in
a tight panel.

### Playhead

```tsx
<ScoreView mnx={mnx}>
  <ScoreView.Playhead beat={beat} partId="flute" follow style={{ color: "#e34935" }} />
</ScoreView>
```

Pass `beat` for a global quarter-note beat, or `position={{ measureIndex, beat }}`.
`follow` keeps the playhead in view. `render` replaces the default bar with your
own element and receives `{ x, y, height }`.

### Page overlays

```tsx
<ScoreView mnx={mnx} pagesPerRow={2}>
  <ScoreView.Page page={0}>
    <span style={{ position: "absolute", top: 8, right: 8 }}>Page 1</span>
  </ScoreView.Page>
</ScoreView>
```

`<ScoreView.Page>` is an absolutely positioned container over one page that
tracks zoom and arrangement. Use it for badges, comments and annotations. For
custom children, `useScoreView()` returns the engine, display list, zoom, page
positions, view mode and the underlying viewer handle.

## Loading, errors and callbacks

| Prop              | Notes                                                           |
| ----------------- | --------------------------------------------------------------- |
| `loadingFallback` | Shown while the engine loads or layout runs                     |
| `errorFallback`   | `(error) => ReactNode`, shown when loading or layout fails      |
| `onReady`         | Called with `{ engine, displayList }` after each layout         |
| `onPaint`         | Called after visible pages are painted                          |
| `onError`         | Called with an `EngineLoadError`, `ParseError` or `LayoutError` |

## Engine hook

```tsx
import { useScoreEngine } from "@viritura/score-viewer-react";

function CustomCanvas({ mnx }: { mnx: string }) {
  const { engine, displayList, loading, error } = useScoreEngine(mnx, { pageWidth: 800 });
  if (loading) return <p>Loading score</p>;
  if (error) return <p>{error.message}</p>;
  // paint with engine.paint(ctx, displayList, { page: 0 }) in your own canvas
  return null;
}
```

`useScoreEngine(mnx, layoutOptions, loadOptions)` loads the engine and lays out
the document whenever the inputs change. Use it when you paint with the
[Score Engine](/developers/score-engine) yourself. The package also
re-exports the engine's `loadEngine`, error classes and types, so one import
is enough.

## Without the React package

```tsx
import { useEffect, useRef } from "react";
import { mountScore } from "/vendor/score-engine/score-viewer.js";

export function Score({ mnx }: { mnx: string }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof mountScore> | null>(null);

  useEffect(() => {
    viewer.current = mountScore(container.current!, null, { zoom: "fit-width" });
    return () => viewer.current?.destroy();
  }, []);

  useEffect(() => viewer.current?.update(mnx), [mnx]);

  return <div ref={container} style={{ height: "80vh" }} />;
}
```

Mount once, call `update` when the document changes, and `destroy` on unmount.

## Hosts with rewritten asset URLs

Sandboxed hosts such as VS Code webviews serve files from rewritten URLs. Pass
the base URL that contains `wasm/` and `fonts/`:

```tsx
<ScoreViewer mnx={mnx} assetBaseUrl={webviewAssetBaseUrl} />
```
