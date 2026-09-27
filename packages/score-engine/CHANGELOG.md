# Changelog

All notable changes to `@viritura/score-engine` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

### Breaking

- `Engine` is now a type-only interface; `DisplayList` is an opaque handle.
  Renderer types (`RenderCommand`, `PageLayout`, `MeasureBounds`, …) and the
  `./errors`, `./timeline`, `./types` subpath exports are removed.
- `paint()` draws ink only under the caller's transform: no clearing, no white
  fill, no `zoom`/`scroll` options. Pass `background` for a fill.
- `measure()` returns `pages[]` and `parts[]` (was `pageSizes`, `partIds`).
- `beatToCanvas(dl, beat, partId)` is replaced by `positionToCanvas(dl, pos)`
  and `playhead(dl, pos)`; geometry is page-local.
- Part IDs are the source MNX part ID or `#<n>` (was a mismatched `p0`/`p1`).
- `info()` returns `{ parts, measureCount, scores }`.

### Added

- `version`, `systems()`, `measures()`, `horizonPaper()`, `toSvg()`,
  `createLayoutWorker()`, `createTileRenderer()`, `ink` colour.
- `loadEngine({ textFont: false })`; default asset base next to the prebuilt bundle.
  The default layout worker follows `assetBaseUrl`.
- Published to npm with `@viritura/score-viewer` and
  `@viritura/score-viewer-react` at one shared version, with provenance. The
  package ships `dist/` only: an ES module with Viritura's internal packages
  inlined (no runtime dependencies), declarations, the layout worker, `wasm/`
  and `fonts/`.
- Prebuilt release archive (`pnpm build:score-engine-dist`) and CI workflow.

### Fixed

- Load failures reject with the underlying cause and can be retried.
- Timeline uses real meters and honours `repeatExpansion`; no longer runs
  schema validation (drops ~1.8 MB from bundles).
- Text font no longer overrides the host page's generic `serif` family.

## [0.0.1] — Phase 3 internal release

### Added

- `loadEngine(opts?)` singleton factory.
- `Engine.layout(mnx, opts)`, `Engine.paint(ctx, dl, opts?)`,
  `Engine.measure(dl)`, `Engine.info(mnx)`.
- `EngineLoadError`, `ParseError`, `LayoutError` typed error classes.
