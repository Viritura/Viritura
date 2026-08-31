# Changelog

All notable changes to `@viritura/score-viewer-react` are documented
here. Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — Phase 5 internal release

### Added

- `<ScoreView>` component with lazy engine loading, multi-page rendering,
  zoom, and `pagesPerRow` layout.
- `<ScoreView.Page page={n}>` overlay slot.
- `<ScoreView.Playhead beat={n} partId="p1">` auto-positioned playhead.
- `useScoreEngine(mnx, opts)` hook for advanced consumers.
- Re-exports the full `@viritura/score-engine` surface so consumers only
  need one install.
- `README.md`, `CHANGELOG.md`.
