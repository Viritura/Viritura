# Developer Overview

Viritura's notation renderer is available to other applications. You can show
[MNX](https://w3c.github.io/mnx/docs/) music notation in a web page, a
documentation site, a VS Code webview or your own editor without running the
Viritura app.

> [!NOTE]
> **Availability: pre-1.0, not on npm**
>
> The packages are `0.x`, and breaking changes are possible in any release.
> They are distributed as a prebuilt archive attached to GitHub Releases rather
> than through a package registry. Pin a specific release and read its
> changelog before upgrading.

## Choose a layer

The renderer is split into three layers. Pick the highest one that fits, and
drop down a layer only when you need more control.

| Package                        | Use it when                                                         | You provide                                    |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| `@viritura/score-viewer-react` | You are building a React 18 or 19 app and want components and hooks | Props                                          |
| `@viritura/score-viewer`       | You want a scrollable, zoomable score in any page or framework      | A container element and the MNX document       |
| `@viritura/score-engine`       | You draw the score yourself: a custom canvas, overlays, export      | Canvas, paper, zoom, scrolling and interaction |

The React package wraps the viewer and adds an optional control bar.

The viewer adds page presentation on top of the engine: paper, page
arrangements, zoom, scrolling, virtualised canvases, loading and error states,
and a playhead that can follow playback.

The engine lays out the music in WebAssembly and draws **ink only**: staves,
notes, symbols and text. It never paints paper, page shadows, backgrounds or
controls.

- [Score Viewer React](/developers/score-viewer-react): `<ScoreViewer>`, `<ScoreView>` and
  `useScoreEngine`.
- [Score Viewer](/developers/score-viewer): embed a score with one call.
- [Score Engine](/developers/score-engine): layout, painting, geometry,
  SVG export and the playback timeline.

## Get the packages

### Release archive

Tags named `score-engine-v<version>` publish a
[GitHub Release](https://github.com/Viritura/Viritura/releases) with a zip and
its SHA-256 checksum. The archive contains:

| File                     | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `score-engine.js`        | The engine as a single ES module                                  |
| `score-engine.worker.js` | Module worker for off-main-thread layout                          |
| `score-viewer.js`        | The framework-free viewer; it imports `./score-engine.js`         |
| `*.d.ts`, `types/`       | TypeScript declarations                                           |
| `wasm/`, `fonts/`        | The engine binary, plus the Bravura and Libertinus Serif fonts    |
| `manifest.json`          | Package and engine versions, source commit, file sizes and hashes |
| `examples/`              | A runnable page showing both the viewer and the engine            |

Copy the unzipped directory into your static assets, or vendor it into your
repository, and import the modules by URL:

```js
import { mountScore } from "/vendor/score-engine/score-viewer.js";
```

The React components are not in the archive yet. React apps can
[use the viewer directly](/developers/score-viewer#use-it-from-a-framework), or
depend on `@viritura/score-viewer-react` from the Viritura workspace.

### Preview builds

Every push to `main` that changes the engine or the packages it bundles
uploads the same directory as a workflow artifact named
`score-engine-<version>-<commit>`, kept for 90 days. Use these to try an
unreleased fix, and pin a release for anything you ship.

### Inside the Viritura repository

Viritura's own apps depend on the workspace packages directly and build the
WebAssembly from the same commit with `pnpm wasm:build`. They don't use the
release archive, so an engine change and the app change that relies on it
always ship together.

## Serving the files

- **Keep the layout.** The modules find `wasm/`, `fonts/` and
  `score-engine.worker.js` next to themselves. If your host rewrites asset URLs,
  as VS Code webviews and some CDNs do, pass the rewritten base URL as
  `assetBaseUrl`. It must contain `wasm/` and `fonts/`.
- **Use HTTP.** ES modules and `fetch` don't work from `file://`. Serve the
  directory with any static file server.
- **Allow WebAssembly in your Content Security Policy.** Compiling the engine
  needs `script-src 'wasm-unsafe-eval'`. Off-main-thread layout also needs the
  worker script to be allowed, and `font-src` must allow the `fonts/`
  directory.
- **Bravura is required.** The engine always loads and registers the Bravura
  music font under the family name `Bravura`. The layout is measured with
  Bravura's metrics, so other music fonts are not supported and can't be
  substituted.
- **The text font is replaceable.** Text such as titles, lyrics and
  expressions uses Libertinus Serif, registered under the family name
  `Viritura Serif` so your page's own `serif` font is untouched. Pass
  `textFont: false` to skip it. Text then uses your page's `serif` font, or a
  `Viritura Serif` face you register yourself. The engine estimates text widths
  from typical serif proportions rather than one font's metrics, so any
  ordinary serif face lays out acceptably.

## Stable part identifiers

Parts are identified by the `id` of the MNX part in the document. When a part
has no `id`, the engine uses a positional fallback, `#0`, `#1` and so on,
counted from zero in document order. The same identifier appears in score
information, geometry, hit-testing and the playback timeline, so you can join
them without matching part names.

## Versioning

`engine.version` reports the WebAssembly engine version, the package version and
the source commit. `manifest.json` records the same values and the SHA-256 hash
of every file. Each package's `CHANGELOG.md` lists breaking changes.

## Licensing

The code is MIT licensed. Bravura and Libertinus Serif are distributed under the
SIL Open Font License. The archive includes `LICENSE`, `THIRD_PARTY_NOTICES.md`
and `LICENSES/OFL-1.1.txt`.
