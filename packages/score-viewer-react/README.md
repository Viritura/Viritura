# @viritura/score-viewer-react

> Embeddable React components (`<ScoreViewer>` and `<ScoreView>`) for rendering MNX music
> notation in the browser. Powered by [`@viritura/score-engine`](../score-engine).

> **Status:** internal workspace package (`0.x.0`), not currently published to
> npm. See [`@viritura/score-engine`](../score-engine) for the publishing
> prerequisite.

## Quick start

```tsx
import { ScoreViewer } from "@viritura/score-viewer-react";

function MyDocs() {
  return <ScoreViewer mnx={mnxJsonString} defaultFitMode="width" defaultViewMode="page" enableCtrlWheelZoom />;
}
```

That's it. The viewer lazy-loads the WASM engine + Bravura font on
first mount; subsequent instances share the same engine.

Use `<ScoreViewer>` when you want the complete embeddable viewer with zoom,
fit, view-mode controls, and Ctrl-scroll zoom. Use `<ScoreView>` when you want
only the score canvases and plan to provide your own chrome.

## View Modes

```tsx
<ScoreViewer
  mnx={mnxJsonString}
  availableViewModes={["page", "horizontal", "spread", "spread-horizontal"]}
  defaultViewMode="spread"
  defaultFitMode="width"
  controls={{ score: true, viewMode: true, zoom: true, fit: true }}
/>
```

If an MNX document contains multiple `scores[]` entries, hosts can provide
`scoreOptions` and handle `onScoreIndexChange` to show a score selector in the
same control surface.

For hosts that need rewritten asset URLs, such as VS Code webviews, pass a base
URL containing `wasm/` and `fonts/` folders:

```tsx
<ScoreViewer mnx={mnxJsonString} assetBaseUrl={webviewAssetBaseUrl} />
```

## With a playhead

```tsx
import { useState, useEffect } from "react";
import { ScoreView } from "@viritura/score-viewer-react";

function PlayingScore({ mnx }: { mnx: string }) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setBeat((b) => b + 0.5), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <ScoreView mnx={mnx} pageWidth={800}>
      <ScoreView.Playhead beat={beat} partId="p1" style={{ color: "red" }} />
    </ScoreView>
  );
}
```

## Per-page overlays

```tsx
<ScoreView mnx={mnx} pageWidth={800} pagesPerRow={2}>
  <ScoreView.Page page={0}>
    <div style={{ position: "absolute", top: 8, right: 8, color: "#888" }}>Page 1</div>
  </ScoreView.Page>
  <ScoreView.Page page={1}>
    <div style={{ position: "absolute", top: 8, right: 8, color: "#888" }}>Page 2</div>
  </ScoreView.Page>
</ScoreView>
```

## Hooks

For advanced consumers that need the engine + display list directly:

```tsx
import { useScoreEngine } from "@viritura/score-viewer-react";

function CustomViewer({ mnx }: { mnx: string }) {
  const { engine, displayList, loading, error } = useScoreEngine(mnx, {
    pageWidth: 800,
  });

  if (loading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!engine || !displayList) return null;

  // Roll your own paint loop, custom overlays, hit-testing, etc.
  return <CustomCanvas engine={engine} displayList={displayList} />;
}
```

## Props

| Prop              | Type                                                          | Default  | Notes                                    |
| ----------------- | ------------------------------------------------------------- | -------- | ---------------------------------------- |
| `mnx`             | `string \| object`                                            | —        | MNX JSON (string or parsed)              |
| `pageWidth`       | `number`                                                      | `800`    | Page width; use `0` for horizon layout   |
| `pageHeight`      | `number`                                                      | A4 ratio | Page height in display-list units        |
| `pageMargins`     | `{ top, right, bottom, left }`                                | 15 mm    | Margins scaled to the default A4 width   |
| `spatium`         | `number`                                                      | `7`      | Staff-space height in display-list units |
| `scoreIndex`      | `number`                                                      | `0`      | Which `scores[]` entry to render         |
| `scoreOptions`    | `{ index: number; label: string }[]`                          | `[]`     | Options for the score selector           |
| `zoom`            | `number`                                                      | `1`      | 1.0 = 1 display-list pixel = 1 CSS px    |
| `viewMode`        | `"page" \| "horizontal" \| "spread" \| "spread-horizontal"`   | `"page"` | Page arrangement                         |
| `gap`             | `number`                                                      | `16`     | CSS px between pages                     |
| `assetBaseUrl`    | `string`                                                      | —        | Base URL containing `wasm/` and `fonts/` |
| `pagesPerRow`     | `number`                                                      | `1`      | Multi-page layout                        |
| `onReady`         | `(info: { engine, displayList }) => void`                     | —        |                                          |
| `onError`         | `(err: EngineLoadError \| ParseError \| LayoutError) => void` | —        |                                          |
| `loadingFallback` | `ReactNode`                                                   | text     | Custom loading UI                        |
| `errorFallback`   | `(err: Error) => ReactNode`                                   | text     | Custom error UI                          |
| `className`       | `string`                                                      | —        |                                          |
| `style`           | `CSSProperties`                                               | —        |                                          |

`viewMode="horizontal"` arranges rendered pages horizontally; it does not
select the engine's unpaged horizon layout. Pass `pageWidth={0}` for horizon
layout, and pair it with `viewMode="horizontal"` when horizontal scrolling is
desired.

## Composition slots

- **`<ScoreView.Page page={n}>`** — overlay container positioned over
  page `n`. Useful for badges, comments, annotations.
- **`<ScoreView.Playhead beat={n} partId="p1">`** — vertical playhead
  line auto-positioned via `engine.beatToCanvas`. Pass `render={fn}`
  to customize the visual.

## License

MIT
