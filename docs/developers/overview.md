# Developer Overview

Viritura's notation renderer is available to other applications. You can show
[MNX](https://w3c.github.io/mnx/docs/) music notation in a web page, a
documentation site, a VS Code webview or your own editor without running the
Viritura app.

> [!NOTE]
> **Availability: pre-1.0**
>
> The packages are `0.x`, and breaking changes are possible in any release.
> Pin an exact version and read the changelog before upgrading.

## Choose a layer

The renderer is split into three layers. Pick the highest one that fits, and
drop down a layer only when you need more control.

| Package                        | Use it when                                                      | You provide                                    |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| `@viritura/score-viewer-react` | You are building a React 19.2+ app and want components and hooks | Props                                          |
| `@viritura/score-viewer`       | You want a scrollable, zoomable score in any page or framework   | A container element and the MNX document       |
| `@viritura/score-engine`       | You draw the score yourself: a custom canvas, overlays, export   | Canvas, paper, zoom, scrolling and interaction |

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

## Try it first

- The [MNX Playground](/mnx/playground) is a live `<ScoreViewer>` from
  [Score Viewer React](/developers/score-viewer-react) in `horizon` view mode.
  Edit MNX on the left and the score re-engraves as you type. It's the quickest
  way to see how the renderer handles a document before you embed it.
- The [example library](/mnx/examples/) shows rendered MNX documents
  covering the specification, Viritura extensions and engraving behaviour.
  The MNX documentation examples used in the playground are also available as
  plain `.mnx` files, for example
  [`/mnx-samples/beams.mnx`](/mnx-samples/beams.mnx), which you can use as test
  input while you build your integration.

## Get the packages

### npm

```sh
npm install @viritura/score-viewer-react   # React components, includes the two below
npm install @viritura/score-viewer         # framework-free viewer, includes the engine
npm install @viritura/score-engine         # engine only
```

Each package is versioned and released on its own, so the engine can ship
fixes without a viewer release. Each viewer depends on a caret range (`^`) of
the engine version it was tested with. Every engine change on `main` is also
published as a prerelease under the `next` tag
(`npm install @viritura/score-engine@next`); pin an exact prerelease if you
need a fix before the next stable release. They are ES modules
with TypeScript declarations, and have no dependencies beyond React (a peer
dependency of the React package) and `lucide-react` for its control icons.

`@viritura/score-engine` also contains the files the engine loads at runtime:
`dist/wasm/`, `dist/fonts/` and `dist/score-engine.worker.js`. See
[Serving the files](#serving-the-files) for how to serve them from a bundled
app.

### Release archive

Each engine release (tag `score-engine-v<version>`) has a
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

The archive suits pages without a build step and hosts that vendor their
dependencies. It doesn't include the React components, which are on npm.

### Preview builds

Every push to `main` that changes the engine or the packages it bundles
uploads the same directory as a workflow artifact named
`score-engine-<version>-<commit>`, kept for 90 days. Use these to try an
unreleased fix, and pin a release for anything you ship.

### Inside the Viritura repository

Viritura's own apps depend on the workspace packages directly and build the
WebAssembly from the same commit with `pnpm wasm:build`. They don't use the
npm packages or the release archive, so an engine change and the app change that relies on it
always ship together.

## Serving the files

- **Keep the layout.** The engine loads `wasm/`, `fonts/` and
  `score-engine.worker.js` from one base URL. By default that is the directory
  of the engine module itself, which works when the files are served as they
  are published, as with the release archive.
- **Pass `assetBaseUrl` when you use a bundler.** Vite, webpack and similar
  tools move the engine's code into their own output, away from its runtime
  files. Copy the three entries from
  `node_modules/@viritura/score-engine/dist/` into your static assets as part
  of your build, and pass their URL:

  ```sh
  mkdir -p public/score-engine
  cp -r node_modules/@viritura/score-engine/dist/{wasm,fonts,score-engine.worker.js} public/score-engine/
  ```

  ```tsx
  <ScoreViewer mnx={mnx} assetBaseUrl="/score-engine/" />
  ```

  `loadEngine()` and `mountScore()` accept the same option. Copy the files
  again whenever you upgrade the package, so they match the engine code.

- **Rewritten URLs.** If your host rewrites asset URLs, as VS Code webviews do,
  pass the rewritten base URL as `assetBaseUrl`.
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
the source commit. The archive's `manifest.json` records the same values and
the SHA-256 hash of every file. npm releases are published from GitHub Actions
with [provenance](https://docs.npmjs.com/generating-provenance-statements), so
npm shows the commit and workflow that built each version. Each package's
`CHANGELOG.md` lists breaking changes.

## Licensing

The code is MIT licensed. Bravura and Libertinus Serif are distributed under the
SIL Open Font License. The archive and the `@viritura/score-engine` package
include `LICENSE`, `THIRD_PARTY_NOTICES.md` and `LICENSES/OFL-1.1.txt`.
