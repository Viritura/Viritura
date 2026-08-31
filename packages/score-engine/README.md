# @viritura/score-engine

> Embeddable music notation engine. Computes layouts, paints to Canvas
> 2D, and produces playback timelines from MNX documents.

> **Status:** internal workspace package (`0.x.0`), not currently published to
> npm. API surface is stable but the publishing pipeline still inlines
> workspace dependencies. Track
> [score-engine-api.md](../../docs/packages/score-engine-api.md) for the
> commitment we plan to lock at `1.0.0`.

## Quick start

```ts
import { loadEngine } from "@viritura/score-engine";

const engine = await loadEngine();
const canvas = document.querySelector("canvas")!;
const ctx = canvas.getContext("2d")!;

const mnx = await fetch("/score.mnx").then((r) => r.text());

const displayList = engine.layout(mnx, { pageWidth: 800 });
engine.paint(ctx, displayList);
```

Pass `pageWidth: 0` for unpaged horizon layout. Paged consumers can provide
explicit geometry in the same display-list units:

```ts
engine.layout(mnx, {
  pageWidth: 800,
  spatium: 8,
  pageSetup: {
    height: 800 * (297 / 210),
    margins: { top: 57, right: 57, bottom: 57, left: 57 },
  },
});
```

## What you get

- **`loadEngine(opts?)`** — boots the WASM module + Bravura font once.
  Singleton: subsequent calls return the same engine.
- **`engine.layout(mnx, opts)`** — produces a deterministic `DisplayList`
  from MNX. Throws `ParseError` for invalid MNX, `LayoutError` for
  engine bugs.
- **`engine.paint(ctx, displayList, opts?)`** — renders one page (or
  the whole document) onto a `CanvasRenderingContext2D`.
- **`engine.measure(displayList)`** — `{ pageCount, pageSizes,
totalHeight, maxPageWidth, partIds }` for sizing UI before paint.
- **`engine.info(mnx)`** — score metadata (`title`, `composer`, `parts`,
  `measureCount`, …) without computing a layout.
- **`engine.timeline(mnx, opts?)`** — layout-independent playback
  timeline with note + tempo events. Audio engines consume this.
- **`engine.beatToCanvas(displayList, beat, partId)`** — playhead
  positioning.
- **`engine.canvasToBeat(displayList, page, x, y)`** — click-to-seek.

## Errors

Every public method throws one of:

| Error             | Code(s)                             | When                           |
| ----------------- | ----------------------------------- | ------------------------------ |
| `EngineLoadError` | `wasm` \| `font` \| `unknown`       | `loadEngine()` failed          |
| `ParseError`      | `json` \| `schema` \| `unsupported` | MNX rejected by parser         |
| `LayoutError`     | `wasm` \| `oom` \| `unknown`        | Layout engine internal failure |

Each carries a `cause` (the original thrown value) for debugging.

## Subpath imports

Tree-shakable subpaths for consumers that only need parts of the API:

```ts
import { ParseError } from "@viritura/score-engine/errors";
import type { Timeline } from "@viritura/score-engine/timeline";
import type { DisplayList } from "@viritura/score-engine/types";
```

## Determinism guarantee

Same `mnx` + same `opts` always produces an identical `DisplayList`
and an identical `Timeline`. This is what makes server-side rendering,
visual diffing, and snapshot tests safe.

## Versioning

Semver. `0.x.y` indicates the API may still change between minors;
`1.0.0` will lock the surface defined in
[score-engine-api.md](../../docs/packages/score-engine-api.md).

## Currently blocked from publishing

The package depends on `@viritura/core`, `@viritura/format`,
`@viritura/midi`, and `@viritura/renderer` via workspace links. Real
publishing requires either:

1. **Inline** these into a single bundle (rollup with workspace deps
   marked as bundled), or
2. **Publish** the workspace deps first as their own scoped packages.

Option 1 is simpler for a single rendering kernel; option 2 keeps the
monorepo's modular surface. The `prepublishOnly` script aborts the
publish until this is decided.

## License

MIT
