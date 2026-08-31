# Changelog

All notable changes to `@viritura/score-engine` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Engine.timeline(mnx, opts?)` returns a layout-independent `Timeline`
  with `TimedEvent[]` and `TempoSegment[]`.
- `Engine.beatToCanvas(displayList, beat, partId)` for playhead overlays.
- `Engine.canvasToBeat(displayList, page, x, y)` for click-to-seek.
- Subpath exports: `./errors`, `./timeline`, `./types`.
- `prepublishOnly` guard until workspace dependency publishing is sorted.
- `README.md`, `CHANGELOG.md`.

### Changed

- `Engine.paint()` correctly slices multi-page display lists per page.
- `Engine.measure()` derives page sizes from `DisplayList.width` (pages
  share the document width) instead of nonexistent `PageLayout.width`.

## [0.0.1] — Phase 3 internal release

### Added

- `loadEngine(opts?)` singleton factory.
- `Engine.layout(mnx, opts)`, `Engine.paint(ctx, dl, opts?)`,
  `Engine.measure(dl)`, `Engine.info(mnx)`.
- `EngineLoadError`, `ParseError`, `LayoutError` typed error classes.
